const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const conversationManager = require('./conversationManager');
const locationService = require('./locationService');
const prompts = require('../config/prompts');
const { detectLanguage, extractDetectionText, cleanThinkingPatterns } = require('../utils/agentHelpers');
const { planMultiStepExecution } = require('./multiStepPlanner');
const { getStaticFileUrl } = require('../utils/urlUtils');

const execAsync = promisify(exec);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Import utility functions from refactored modules
const { formatProviderName, normalizeProviderKey, applyProviderToMessage } = require('./agent/utils/providerUtils');
// promptUtils removed - using LLM-first approach only
const { getServices } = require('./agent/utils/serviceLoader');
const { getAudioDuration } = require('./agent/utils/audioUtils');
const { TOOL_ACK_MESSAGES, VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('./agent/config/constants');
const { getUserFacingTools } = require('../config/tools-list');

// Import modular agent tools
const { allTools: agentTools, getToolDeclarations } = require('./agent/tools');

// ═══════════════════ AGENT CONTEXT MEMORY (Persistent in DB) ═══════════════════
// Agent context is now stored persistently in PostgreSQL database
// No more in-memory cache or TTL - context persists indefinitely like ChatGPT
// Access via conversationManager.saveAgentContext/getAgentContext/clearAgentContext
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 * 
 * NOTE: Tool definitions are now in /services/agent/tools/ (modular structure)
 * Meta-tools (advanced composite tools) moved to /services/agent/tools/metaTools.js (Phase 4)
 */

async function sendToolAckMessage(chatId, functionCalls) {
  if (!chatId || !functionCalls || functionCalls.length === 0) return;
  
  try {
    let ackMessage = '';
    
    // Helper to build Ack message for a single tool
    const buildSingleAck = (call) => {
      const toolName = call.name;
      if (toolName === 'send_location') {
        return '';
      }
      // CRITICAL: Never expose tool names to user - use generic message if undefined
      let baseMessage = TOOL_ACK_MESSAGES[toolName] || 'מבצע פעולה... ⚙️';
      
      // Check if this tool uses a provider (direct or nested)
      const providerRaw = call.args?.provider || call.args?.service;
      let provider = normalizeProviderKey(providerRaw);
      
      // Default providers for creation/edit tools if not specified
      if (!provider) {
        if (toolName === 'create_image' || toolName === 'edit_image') {
          provider = 'gemini';
        } else if (toolName === 'create_video' || toolName === 'edit_video') {
          provider = 'grok'; // kling is the default for video
        } else if (toolName === 'image_to_video') {
          provider = 'grok'; // kling
        }
      }
      
      if (!provider && toolName === 'smart_execute_with_fallback') {
        const providersTriedRaw = [];
        if (Array.isArray(call.args?.providers_tried)) {
          providersTriedRaw.push(...call.args.providers_tried);
        }
        if (call.args?.provider_tried) {
          providersTriedRaw.push(call.args.provider_tried);
        }
        const providersTried = providersTriedRaw.map(normalizeProviderKey).filter(Boolean);
        const availableProviders = VIDEO_PROVIDER_FALLBACK_ORDER.filter(p => !providersTried.includes(p));
        provider = availableProviders[0] || null;
      }
      
      // SKIP: retry_with_different_provider handles its own Acks internally
      // Sending Ack here would duplicate the Acks sent by the tool itself
      if (toolName === 'retry_with_different_provider') {
        return ''; // Don't send any Ack - let the tool handle it
      }
      
      let providerDisplayKey = providerRaw || provider;
      const isVideoTask = call.args?.task_type === 'video_creation' 
                       || call.args?.task_type === 'video'
                       || toolName === 'create_video'
                       || toolName === 'retry_with_different_provider' && call.args?.task_type === 'video';
      if (isVideoTask) {
        const normalizedKey = normalizeProviderKey(providerDisplayKey);
        if (normalizedKey && VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey];
        } else if (!providerRaw && provider && VIDEO_PROVIDER_DISPLAY_MAP[provider]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[provider];
        }
      }
      
      const providerName = providerDisplayKey ? formatProviderName(providerDisplayKey) : null;
      baseMessage = applyProviderToMessage(baseMessage, providerName);
      
      return baseMessage;
    };
    
    if (functionCalls.length === 1) {
      const singleAck = buildSingleAck(functionCalls[0]);
      if (!singleAck || !singleAck.trim()) {
        return;
      }
      ackMessage = singleAck;
    } else if (functionCalls.length === 2) {
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע:\n• ${acks.join('\n• ')}`;
    } else {
      // Multiple tools - generic message
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע ${acks.length} פעולות... ⚙️`;
    }
    
    if (!ackMessage || !ackMessage.trim()) {
      return;
    }
    
    console.log(`📢 [ACK] Sending acknowledgment: "${ackMessage}"`);
    const { greenApiService } = getServices();
    await greenApiService.sendTextMessage(chatId, ackMessage);
  } catch (error) {
    console.error('❌ [ACK] Failed to send acknowledgment:', error.message);
    // Don't throw - Ack failure shouldn't break the agent
  }
}

// ✅ detectLanguage and getLanguageInstruction moved to /utils/agentHelpers.js and /config/prompts.js

/**
 * Get language instruction for system prompt (wrapper for prompts config)
 */
function getLanguageInstruction(langCode) {
  return prompts.languageInstructions[langCode] || prompts.languageInstructions['he'];
}

/**
 * Execute a single step in a multi-step workflow
 * @param {string} stepPrompt - Prompt for this specific step
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Step execution result
 */
async function executeSingleStep(stepPrompt, chatId, options = {}) {
  const {
    maxIterations = 5,
    languageInstruction,
    agentConfig,
    functionDeclarations,
    systemInstruction,
    expectedTool = null  // In multi-step, restrict execution to this tool only
  } = options;
  
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Shorter system instruction for single steps
  const stepSystemInstructionText = systemInstruction || prompts.singleStepInstruction(languageInstruction);
  
  // NO HISTORY for single steps - each step is isolated and focused on its specific task only
  const chat = model.startChat({
    history: [], // Empty history to prevent confusion between steps
    tools: [{ functionDeclarations }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: stepSystemInstructionText }]
    }
  });
  
  let iterations = 0;
  let currentPrompt = stepPrompt;
  const toolsUsed = [];
  let textResponse = '';
  const assets = {
    imageUrl: null,
    imageCaption: '',
    videoUrl: null,
    audioUrl: null,
    poll: null,
    latitude: null,
    longitude: null,
    locationInfo: null
  };
  
  // Agent execution loop
  while (iterations < maxIterations) {
    iterations++;
    
    try {
      const result = await chat.sendMessage(currentPrompt);
      const response = result.response;
      
      // Check for function calls
      const functionCalls = response.functionCalls();
      
      if (!functionCalls || functionCalls.length === 0) {
        // No more tool calls - get text response and finish
        textResponse = response.text();
        break;
      }
      
      // Execute function calls FIRST (don't send Ack yet - wait until step completes)
      const functionResponses = [];
      let targetToolExecuted = false;
      
      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args;
        
        // CRITICAL: In multi-step execution, only execute the target tool for this step
        // Prevent calling additional tools like get_chat_history that are not in the plan
        if (expectedTool && toolName !== expectedTool) {
          console.log(`⚠️ [Multi-step] Blocking unexpected tool call: ${toolName} (expected: ${expectedTool})`);
          functionResponses.push({
            name: toolName,
            response: { 
              error: `This tool is not part of the current step. Please execute only: ${expectedTool}`,
              blocked: true
            }
          });
          continue;
        }
        
        // If we already executed the target tool, stop (prevent multiple calls)
        if (expectedTool && targetToolExecuted && toolName === expectedTool) {
          console.log(`⚠️ [Multi-step] Target tool ${expectedTool} already executed, stopping`);
          break;
        }
        
        toolsUsed.push(toolName);
        
        // Execute the tool
        const toolFunction = agentTools[toolName];
        if (!toolFunction || !toolFunction.execute) {
          functionResponses.push({
            name: toolName,
            response: { error: `Tool ${toolName} not found or not executable` }
          });
          continue;
        }
        
        // Execute with proper context (chatId needed for some tools)
        const toolResult = await toolFunction.execute(toolArgs, { chatId });
        functionResponses.push({
          name: toolName,
          response: toolResult
        });
        
        // Mark target tool as executed
        if (expectedTool && toolName === expectedTool) {
          targetToolExecuted = true;
        }
        
        // Extract assets from tool result
        if (toolResult.imageUrl) {
          assets.imageUrl = toolResult.imageUrl;
          assets.imageCaption = toolResult.caption || toolResult.imageCaption || '';
        }
        if (toolResult.videoUrl) assets.videoUrl = toolResult.videoUrl;
        if (toolResult.audioUrl) assets.audioUrl = toolResult.audioUrl;
        if (toolResult.poll) assets.poll = toolResult.poll;
        if (toolResult.latitude) assets.latitude = toolResult.latitude;
        if (toolResult.longitude) assets.longitude = toolResult.longitude;
        if (toolResult.locationInfo) assets.locationInfo = toolResult.locationInfo;
        
        // If tool failed and returned error, save it for return
        if (toolResult.error && !toolResult.success) {
          assets.error = toolResult.error;
        }
      }
      
      // If target tool executed, get final text response and stop (don't continue with more tools)
      if (expectedTool && targetToolExecuted) {
        // Send function results back to get final text response
        const functionResponseParts = functionResponses
          .filter(fr => !fr.response.blocked)
          .map(fr => ({
            functionResponse: {
              name: fr.name,
              response: fr.response
            }
          }));
        
        if (functionResponseParts.length > 0) {
          const finalResult = await chat.sendMessage(functionResponseParts);
          textResponse = finalResult.response.text() || textResponse;
        }
        break; // Stop here - target tool executed, no need for more iterations
      }
      
      // Send function results back to the model (for non-multi-step or when no expected tool)
      const functionResponseParts = functionResponses
        .filter(fr => !fr.response.blocked)
        .map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response
          }
        }));
      
      if (functionResponseParts.length === 0) {
        // All tools were blocked, stop
        break;
      }
      
      const continueResult = await chat.sendMessage(functionResponseParts);
      textResponse = continueResult.response.text();
      
      // Check if model wants to continue with more tools
      if (!continueResult.response.functionCalls() || continueResult.response.functionCalls().length === 0) {
        break;
      }
      
    } catch (error) {
      console.error(`  ❌ [Step Error]:`, error.message);
      return {
        success: false,
        error: error.message,
        iterations,
        toolsUsed
      };
    }
  }
  
  // Clean up text response
  if (textResponse) {
    textResponse = cleanThinkingPatterns(textResponse);
  }
  
  // Check if any tool failed
  const hasError = assets.error !== undefined;
  
  return {
    success: !hasError,
    text: textResponse,
    ...assets,
    toolsUsed,
    iterations
  };
}

/**
 * Execute an agent query with autonomous tool usage
 * @param {string} prompt - User's question/request
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Additional options
 * @returns {Object} - Response with text and tool usage info
 */
async function executeAgentQuery(prompt, chatId, options = {}) {
  // Detect user's language
  const userLanguage = detectLanguage(prompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // ⚙️ Configuration: Load from env or use defaults
  const agentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8, // Increased from 5 to 8 for multi-step tasks
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000, // 4 minutes for complex multi-step tasks (increased from 3)
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  };
  
  // 📎 Extract media URLs from options (for planner context)
  const input = options.input || {};
  const imageUrl = input.imageUrl || null;
  const videoUrl = input.videoUrl || null;
  const audioUrl = input.audioUrl || null;
  
  // 🔍 Extract clean user text for multi-step detection (remove metadata)
  const detectionText = extractDetectionText(prompt);
  
  // 📎 Add media context for planner (so it knows about attached images/videos)
  let plannerContext = detectionText;
  if (imageUrl) {
    plannerContext = `[תמונה מצורפת]\n${detectionText}`;
  } else if (videoUrl) {
    plannerContext = `[וידאו מצורף]\n${detectionText}`;
  } else if (audioUrl) {
    plannerContext = `[אודיו מצורף]\n${detectionText}`;
  }
  
  // 🧠 Use LLM-based planner to intelligently detect and plan multi-step execution
  let plan = await planMultiStepExecution(plannerContext);
  
  console.log(`🔍 [Planner] Plan result:`, JSON.stringify({
    isMultiStep: plan.isMultiStep,
    stepsLength: plan.steps?.length,
    fallback: plan.fallback,
    steps: plan.steps?.map(s => ({ stepNumber: s.stepNumber, tool: s.tool, action: s.action?.substring(0, 50) }))
  }, null, 2));
  
  // If planner failed, treat as single-step (no heuristic fallback - rely on LLM only)
  if (plan.fallback) {
    console.log(`⚠️ [Planner] Planner failed, treating as single-step`);
    plan = { isMultiStep: false };
  }
  
  // 🔄 Multi-step execution - execute each step sequentially
  if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
    console.log(`✅ [Planner] Entering multi-step execution with ${plan.steps.length} steps`);
    agentConfig.maxIterations = Math.max(agentConfig.maxIterations, 15); // More iterations for multi-step
    agentConfig.timeoutMs = Math.max(agentConfig.timeoutMs, 360000); // 6 minutes for multi-step
    
    // Prepare tools for steps
    const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
    const systemInstruction = prompts.agentSystemInstruction(languageInstruction);
    
    // 🔄 Execute each step sequentially
    const stepResults = [];
    let accumulatedText = '';
    let finalAssets = {
      imageUrl: null,
      imageCaption: '',
      videoUrl: null,
      audioUrl: null,
      poll: null,
      latitude: null,
      longitude: null,
      locationInfo: null
    };
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Extract tool and parameters from plan (provided by planner)
      const toolName = step.tool || null;
      const toolParams = step.parameters || {};
      
      // 📢 CRITICAL: Send Ack BEFORE executing the step
      // For first step: Send Ack immediately
      // For subsequent steps: Previous step's results were already sent in previous iteration (all awaits completed)
      // So we can safely send Ack for current step
      if (toolName) {
        console.log(`📢 [Multi-step] Sending Ack for Step ${step.stepNumber}/${plan.steps.length} (${toolName}) BEFORE execution`);
        await sendToolAckMessage(chatId, [{ name: toolName, args: toolParams }]);
      }
      
      // Build focused prompt for this step - use action from plan
      let stepPrompt = step.action;
      
      // CRITICAL: ALWAYS add context from previous steps (not just when keywords detected)
      // Each step needs to know what happened before to maintain continuity
      if (stepResults.length > 0) {
        const previousContext = stepResults.map((res, idx) => {
          let summary = `Step ${idx + 1}:`;
          if (res.text) summary += ` ${res.text.substring(0, 200)}`; // Increased from 100 to 200 chars
          if (res.imageUrl) summary += ` [Created image]`;
          if (res.videoUrl) summary += ` [Created video]`;
          if (res.audioUrl) summary += ` [Created audio]`;
          if (res.poll) summary += ` [Created poll: "${res.poll.question}"]`;
          if (res.latitude && res.longitude) summary += ` [Sent location]`;
          return summary;
        }).join('\n');
        
        stepPrompt = `CONTEXT from previous steps:\n${previousContext}\n\nCURRENT TASK: ${step.action}`;
      }
      
      // If planner provided tool and parameters, add them to the prompt
      if (toolName && Object.keys(toolParams).length > 0) {
        const paramsStr = Object.entries(toolParams)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        stepPrompt = `${stepPrompt}\n\nTool: ${toolName}\nParameters: ${paramsStr}`;
      }
      
      // Execute this step
      try {
        console.log(`🔄 [Multi-step] Executing Step ${step.stepNumber}/${plan.steps.length}: ${step.action}`);
        const stepResult = await executeSingleStep(stepPrompt, chatId, {
          ...options,
          maxIterations: 5, // Limit iterations per step
          languageInstruction,
          agentConfig,
          functionDeclarations,
          systemInstruction: prompts.singleStepInstruction(languageInstruction),
          expectedTool: toolName  // Restrict execution to this tool only
        });
        
        console.log(`🔍 [Multi-step] Step ${step.stepNumber} executeSingleStep returned:`, {
          success: stepResult.success,
          hasLocation: !!(stepResult.latitude && stepResult.longitude),
          hasPoll: !!stepResult.poll,
          hasImage: !!stepResult.imageUrl,
          hasVideo: !!stepResult.videoUrl,
          hasAudio: !!stepResult.audioUrl,
          hasText: !!stepResult.text,
          toolsUsed: stepResult.toolsUsed,
          error: stepResult.error
        });
        
        if (stepResult.success) {
          stepResults.push(stepResult);
          const { greenApiService } = getServices();
          
          // 🚀 CRITICAL: Send ALL results immediately in order (location/poll/text/media)
          // Each step's output must be sent before moving to next step
          console.log(`🔍 [Multi-step] Step ${step.stepNumber} result:`, {
            hasLocation: !!(stepResult.latitude && stepResult.longitude),
            hasPoll: !!stepResult.poll,
            hasImage: !!stepResult.imageUrl,
            hasVideo: !!stepResult.videoUrl,
            hasAudio: !!stepResult.audioUrl,
            hasText: !!stepResult.text,
            toolsUsed: stepResult.toolsUsed
          });
          
          // 1. Send location (if exists)
          if (stepResult.latitude && stepResult.longitude) {
            try {
              console.log(`📍 [Multi-step] Sending location for step ${step.stepNumber}/${plan.steps.length}`);
              await greenApiService.sendLocation(chatId, parseFloat(stepResult.latitude), parseFloat(stepResult.longitude), '', '');
              if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
                await greenApiService.sendTextMessage(chatId, `📍 ${stepResult.locationInfo}`);
              }
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Location sent`);
            } catch (locationError) {
              console.error(`❌ [Multi-step] Failed to send location:`, locationError.message);
            }
          }
          
          // 2. Send poll (if exists)
          if (stepResult.poll) {
            try {
              const pollOptions = stepResult.poll.options.map(opt => ({ optionName: opt }));
              await greenApiService.sendPoll(chatId, stepResult.poll.question, pollOptions, false);
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Poll sent`);
            } catch (pollError) {
              console.error(`❌ [Multi-step] Failed to send poll:`, pollError.message);
            }
          }
          
          // 3. Send image (if exists)
          if (stepResult.imageUrl) {
            try {
              const fullImageUrl = stepResult.imageUrl.startsWith('http') 
                ? stepResult.imageUrl 
                : getStaticFileUrl(stepResult.imageUrl.replace('/static/', ''));
              const caption = stepResult.imageCaption || '';
              await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption);
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Image sent`);
            } catch (imageError) {
              console.error(`❌ [Multi-step] Failed to send image:`, imageError.message);
            }
          }
          
          // 4. Send video (if exists)
          if (stepResult.videoUrl) {
            try {
              const fullVideoUrl = stepResult.videoUrl.startsWith('http') 
                ? stepResult.videoUrl 
                : getStaticFileUrl(stepResult.videoUrl.replace('/static/', ''));
              await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '');
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Video sent`);
            } catch (videoError) {
              console.error(`❌ [Multi-step] Failed to send video:`, videoError.message);
            }
          }
          
          // 5. Send audio (if exists)
          if (stepResult.audioUrl) {
            try {
              const fullAudioUrl = stepResult.audioUrl.startsWith('http') 
                ? stepResult.audioUrl 
                : getStaticFileUrl(stepResult.audioUrl.replace('/static/', ''));
              await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Audio sent`);
            } catch (audioError) {
              console.error(`❌ [Multi-step] Failed to send audio:`, audioError.message);
            }
          }
          
          // 6. Send text (ONLY if no structured output was already sent)
          // CRITICAL: Avoid duplicate sending - if location/poll/media was sent, 
          // the text is usually just a description that's already been sent separately
          const hasStructuredOutput = stepResult.latitude || stepResult.poll || 
                                       stepResult.imageUrl || stepResult.videoUrl || 
                                       stepResult.audioUrl || stepResult.locationInfo;
          
          if (!hasStructuredOutput && stepResult.text && stepResult.text.trim()) {
            try {
              let cleanText = stepResult.text.trim();
              
              // CRITICAL: For search_web and similar tools, URLs are part of the content
              // Only remove URLs for creation tools where they might be duplicate artifacts
              const toolsWithUrls = ['search_web', 'get_chat_history', 'chat_summary', 'translate_text'];
              if (!stepResult.toolsUsed || !stepResult.toolsUsed.some(tool => toolsWithUrls.includes(tool))) {
                // Remove URLs only if not a text-based tool that returns URLs
                cleanText = cleanText.replace(/https?:\/\/[^\s]+/gi, '').trim();
              }
              
              if (cleanText) {
                await greenApiService.sendTextMessage(chatId, cleanText);
                console.log(`✅ [Multi-step] Step ${step.stepNumber}: Text sent`);
              }
            } catch (textError) {
              console.error(`❌ [Multi-step] Failed to send text:`, textError.message);
            }
          } else if (hasStructuredOutput) {
            console.log(`⏭️ [Multi-step] Step ${step.stepNumber}: Skipping text - structured output already sent`);
          }
          
          // ✅ CRITICAL: ALL results for this step have been sent and awaited
          // All async operations (sendLocation, sendPoll, sendFileByUrl, sendTextMessage) have completed
          // The loop will now continue to the next iteration, where the Ack will be sent
          console.log(`✅ [Multi-step] Step ${step.stepNumber}/${plan.steps.length} completed and ALL results sent and delivered: ${stepResult.toolsUsed?.join(', ') || 'text only'}`);
          
          // At this point, all messages for this step have been sent to WhatsApp
          // The next iteration will start, and the Ack for the next step will be sent
        } else {
          // ❌ Step failed - send initial error, then try fallback for creation tools
          console.error(`❌ [Agent] Step ${step.stepNumber}/${plan.steps.length} failed:`, stepResult.error);
          
          // 🔄 FALLBACK: For creation tools that failed, try alternative providers
          const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video'];
          let fallbackSucceeded = false;
          
          if (creationTools.includes(toolName)) {
            // CRITICAL: Send the initial error to user first (rule #2)
            if (stepResult.error) {
              try {
                const { greenApiService } = getServices();
                const errorMessage = stepResult.error.toString();
                await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`);
                console.log(`📤 [Multi-step] Step ${step.stepNumber}: Initial error sent to user`);
              } catch (errorSendError) {
                console.error(`❌ [Multi-step] Failed to send initial error:`, errorSendError.message);
              }
            }
            
            console.log(`🔄 [Multi-step Fallback] Attempting automatic fallback for ${toolName}...`);
            
            try {
              const { greenApiService } = getServices();
              
              // Determine provider order based on what failed
              const avoidProvider = toolParams.provider || 'gemini';
              const imageProviders = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
              const videoProviders = ['veo3', 'sora', 'kling'].filter(p => p !== avoidProvider);
              
              let providersToTry = toolName.includes('image') ? imageProviders : videoProviders;
              const allErrors = [`${avoidProvider}: ${stepResult.error}`];
              
              // Try each provider with Ack
              for (const provider of providersToTry) {
                console.log(`🔄 [Multi-step Fallback] Trying ${provider}...`);
                
                // Send Ack for this fallback attempt
                const ackMessage = TOOL_ACK_MESSAGES[toolName]?.replace('__PROVIDER__', formatProviderName(provider)) || 
                                  `מנסה עם ${formatProviderName(provider)}... 🔁`;
                await sendToolAckMessage(chatId, [{ name: toolName, args: { provider } }]);
                
                try {
                  let result;
                  const promptToUse = toolParams.prompt || toolParams.text || step.action;
                  
                  if (toolName === 'create_image') {
                    result = await agentTools.create_image.execute({ prompt: promptToUse, provider }, { chatId });
                  } else if (toolName === 'create_video') {
                    result = await agentTools.create_video.execute({ prompt: promptToUse, provider }, { chatId });
                  } else if (toolName === 'edit_image') {
                    result = await agentTools.edit_image.execute({ 
                      image_url: toolParams.image_url, 
                      edit_instruction: promptToUse, 
                      service: provider 
                    }, { chatId });
                  } else if (toolName === 'edit_video') {
                    result = await agentTools.edit_video.execute({ 
                      video_url: toolParams.video_url, 
                      edit_instruction: promptToUse, 
                      provider 
                    }, { chatId });
                  }
                  
                  if (result && result.success) {
                    console.log(`✅ [Multi-step Fallback] ${provider} succeeded!`);
                    fallbackSucceeded = true;
                    stepResults.push(result);
                    
                    // Send the result (image/video)
                    if (result.imageUrl) {
                      const fullImageUrl = result.imageUrl.startsWith('http') 
                        ? result.imageUrl 
                        : getStaticFileUrl(result.imageUrl.replace('/static/', ''));
                      const caption = result.caption || result.imageCaption || '';
                      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption);
                      console.log(`✅ [Multi-step Fallback] Image sent successfully`);
                    }
                    
                    if (result.videoUrl) {
                      const fullVideoUrl = result.videoUrl.startsWith('http') 
                        ? result.videoUrl 
                        : getStaticFileUrl(result.videoUrl.replace('/static/', ''));
                      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '');
                      console.log(`✅ [Multi-step Fallback] Video sent successfully`);
                    }
                    
                    // Success message (optional, don't send if media was sent)
                    if (result.data && !result.imageUrl && !result.videoUrl) {
                      await greenApiService.sendTextMessage(chatId, result.data);
                    }
                    
                    break; // Success! Stop trying other providers
                  } else {
                    // This provider also failed
                    const errorMsg = result?.error || 'Unknown error';
                    allErrors.push(`${provider}: ${errorMsg}`);
                    console.log(`❌ [Multi-step Fallback] ${provider} failed: ${errorMsg}`);
                    
                    // Send this error to user immediately (as-is)
                    await greenApiService.sendTextMessage(chatId, `❌ ${errorMsg}`);
                  }
                } catch (providerError) {
                  const errorMsg = providerError.message;
                  allErrors.push(`${provider}: ${errorMsg}`);
                  console.error(`❌ [Multi-step Fallback] ${provider} threw error:`, errorMsg);
                  
                  // Send this error to user immediately (as-is)
                  await greenApiService.sendTextMessage(chatId, `❌ ${errorMsg}`);
                }
              }
              
              // If all fallbacks failed, send summary
              if (!fallbackSucceeded) {
                console.log(`❌ [Multi-step Fallback] All providers failed for ${toolName}`);
                await greenApiService.sendTextMessage(chatId, `❌ כל הספקים נכשלו עבור ${toolName}`);
              }
              
            } catch (fallbackError) {
              console.error(`❌ [Multi-step Fallback] Critical error during fallback:`, fallbackError.message);
            }
          } else {
            // Not a creation tool - send original error
            if (stepResult.error) {
              try {
                const { greenApiService } = getServices();
                const errorMessage = stepResult.error.toString();
                await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`);
                console.log(`📤 [Multi-step] Step ${step.stepNumber}: Error sent to user`);
              } catch (errorSendError) {
                console.error(`❌ [Multi-step] Failed to send error message:`, errorSendError.message);
              }
            }
          }
          
          // Continue with remaining steps even if one fails
        }
      } catch (stepError) {
        // ❌ Step execution threw an exception - send error to user
        console.error(`❌ [Agent] Error executing step ${step.stepNumber}:`, stepError.message);
        
        try {
          const { greenApiService } = getServices();
          // Send error message to user (as-is, as per rule #2)
          const errorMessage = stepError.message || stepError.toString();
          await greenApiService.sendTextMessage(chatId, `❌ שגיאה בביצוע שלב ${step.stepNumber}: ${errorMessage}`);
          console.log(`📤 [Multi-step] Step ${step.stepNumber}: Exception error sent to user`);
        } catch (errorSendError) {
          console.error(`❌ [Multi-step] Failed to send exception error:`, errorSendError.message);
        }
        
        // Continue with remaining steps
      }
    }
    
    // Clean and process final text for multi-step
    let finalText = accumulatedText.trim();
    
    // NOTE: finalText is mostly unused now since each step sends results immediately
    // Kept for backward compatibility and edge cases
    // Do NOT remove URLs here - they might be needed for text-based tools
    // finalText = finalText.replace(/https?:\/\/[^\s]+/gi, '').trim();
    
    // Remove duplicate lines (if Step 1 and Step 2 both returned similar content)
    const lines = finalText.split('\n').filter(line => line.trim());
    const uniqueLines = [];
    const seen = new Set();
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueLines.push(line);
      }
    }
    finalText = uniqueLines.join('\n').trim();
    
    // ✅ All results (including media) were already sent immediately after each step
    // No need to send anything at the end
    
    console.log(`🏁 [Agent] Multi-step execution completed: ${stepResults.length}/${plan.steps.length} steps successful`);
    console.log(`📦 [Agent] Returning: ${finalText.length} chars text, image: ${!!finalAssets.imageUrl}, multiStep: true`);
    console.log(`📝 [Agent] Final text preview: "${finalText.substring(0, 100)}..."`);
    
    return {
      success: true,
      text: finalText,
      ...finalAssets,
      toolsUsed: stepResults.flatMap(r => r.toolsUsed || []),
      iterations: stepResults.reduce((sum, r) => sum + (r.iterations || 0), 0),
      multiStep: true,
      stepsCompleted: stepResults.length,
      totalSteps: plan.steps.length,
      // Mark that results were already sent immediately (don't resend in whatsappRoutes)
      alreadySent: true
    };
  }
  
  // Continue with single-step execution if not multi-step
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
    // System prompt for the agent (Hebrew base with dynamic language instruction)
    // Build tools list dynamically from central registry
    const availableToolNames = getUserFacingTools()
      .map(t => t.name)
      .slice(0, 15) // Show first 15 tools
      .join(', ');
    
    const systemInstruction = `אתה עוזר AI אוטונומי עם גישה לכלים מתקדמים.
 
 **🌐 Language:** ${languageInstruction} - תשיב בשפה שבה המשתמש כתב!
  
 **כלים זמינים:** ${availableToolNames}, ועוד.
  
 **כללים קריטיים:**
 • אם image_url/video_url בפרומפט → השתמש בו ישירות (אל תקרא get_chat_history!)
 • הודעות מצוטטות + מדיה: שאלה → analyze_image, עריכה → edit_image (לא retry!)
 • **לינקים/קישורים - חובה להשתמש ב-search_web!**
   - "שלח לי לינק", "send me link", "קישור ל-X" → search_web (כלי מחובר ל-Google Search!)
   - אסור לומר "אין לי אפשרות לשלוח לינקים" - יש לך search_web!
   - search_web מחזיר לינקים אמיתיים ועדכניים מ-Google
 • **אודיו/קול - CRITICAL: אל תיצור אודיו/קול אלא אם כן המשתמש מבקש במפורש!**
   - "ספר בדיחה" / "tell joke" → טקסט בלבד (לא text_to_speech!)
   - "תרגם ל-X ואמור" / "say in English" / "אמור ב-Y" → translate_and_speak (כן!)
   - "תשמיע לי" / "תקרא בקול" / "voice" → text_to_speech או translate_and_speak (כן!)
   - **אם המשתמש לא אמר "אמור", "תשמיע", "voice", "say" - אל תיצור אודיו!**
 • "אמור X ב-Y" → translate_and_speak (לא translate_text!)
 • create_music: ליצירת שירים חדשים | search_web: למציאת שירים קיימים/לינקים
 • תמיד ציין provider: create_image({provider: "gemini"}), create_video({provider: "kling"})
 • send_location: region הוא **אופציונלי** - ציין רק אם יש אזור ספציפי
 • אם tool נכשל → retry_with_different_provider (אל תקרא לאותו tool שוב!)
 • Multi-step: אם רואה "Step X/Y" → התמקד רק בשלב הזה`;

  // 🧠 Context for tool execution (load previous context if enabled)
  let context = {
    chatId,
    previousToolResults: {},
    toolCalls: [],
    generatedAssets: {
      images: [],
      videos: [],
      audio: [],
      polls: []
    },
    lastCommand: options.lastCommand || null,
    originalInput: options.input || null,
    suppressFinalResponse: false,
    expectedMediaType: null
  };
  
  // Load previous context if context memory is enabled (from DB)
  if (agentConfig.contextMemoryEnabled) {
    const previousContext = await conversationManager.getAgentContext(chatId);
    if (previousContext) {
      console.log(`🧠 [Agent Context] Loaded previous context from DB with ${previousContext.toolCalls.length} tool calls`);
      context = {
        ...context,
        toolCalls: previousContext.toolCalls || [],
        generatedAssets: previousContext.generatedAssets || context.generatedAssets
      };
    } else {
      console.log(`🧠 [Agent Context] No previous context found in DB (starting fresh)`);
    }
  }
  
  // Conversation history for the agent
  const chat = model.startChat({
    history: [],
    tools: [{ functionDeclarations }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }]
    }
  });
  
  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async () => {
    // Single-step execution (multi-step is handled above with executeSingleStep loop)
    let response = await chat.sendMessage(prompt);
    let iterationCount = 0;
    
    // Agent loop - continue until we get a final text response
    while (iterationCount < maxIterations) {
    iterationCount++;
    console.log(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);
    
    const result = response.response;
    
    // Check if Gemini wants to call a function
    const functionCalls = result.functionCalls();
    
    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls in this iteration
      let text = result.text();
      
      // 🧹 CRITICAL: Clean thinking patterns before sending to user
      text = cleanThinkingPatterns(text);
      
      // No continuation needed - this is the final answer
      console.log(`✅ [Agent] Completed in ${iterationCount} iterations`);
      
      // 🧠 Save context for future agent calls if enabled (to DB)
      if (agentConfig.contextMemoryEnabled) {
        await conversationManager.saveAgentContext(chatId, {
          toolCalls: context.toolCalls,
          generatedAssets: context.generatedAssets
        });
        console.log(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
      }
      
      // 🎨 Extract latest generated media to send to user
      console.log(`🔍 [Agent] Assets: ${context.generatedAssets.images.length} images, ${context.generatedAssets.videos.length} videos, ${context.generatedAssets.audio.length} audio`);
      
      const latestImageAsset = context.generatedAssets.images.length > 0 
        ? context.generatedAssets.images[context.generatedAssets.images.length - 1]
        : null;
      const latestVideoAsset = context.generatedAssets.videos.length > 0 
        ? context.generatedAssets.videos[context.generatedAssets.videos.length - 1]
        : null;
      const latestAudioAsset = context.generatedAssets.audio && context.generatedAssets.audio.length > 0 
        ? context.generatedAssets.audio[context.generatedAssets.audio.length - 1]
        : null;
      const latestPollAsset = context.generatedAssets.polls && context.generatedAssets.polls.length > 0 
        ? context.generatedAssets.polls[context.generatedAssets.polls.length - 1]
        : null;
      
      // Check if send_location was called - extract latitude/longitude from tool result
      const locationResult = context.previousToolResults['send_location'];
      const latitude = locationResult?.latitude || null;
      const longitude = locationResult?.longitude || null;
      const locationInfo = locationResult?.locationInfo || locationResult?.data || null;
      
      console.log(`🔍 [Agent] Extracted assets - Image: ${latestImageAsset?.url}, Video: ${latestVideoAsset?.url}, Audio: ${latestAudioAsset?.url}, Poll: ${latestPollAsset?.question}, Location: ${latitude}, ${longitude}`);
      
      const finalText = context.suppressFinalResponse ? '' : text;
      
      return {
        success: true,
        text: finalText,
        imageUrl: latestImageAsset?.url || null,
        imageCaption: latestImageAsset?.caption || '',
        videoUrl: latestVideoAsset?.url || null,
        audioUrl: latestAudioAsset?.url || null,
        poll: latestPollAsset || null,
        latitude: latitude,
        longitude: longitude,
        locationInfo: locationInfo,
        toolsUsed: Object.keys(context.previousToolResults),
        iterations: iterationCount,
        toolCalls: context.toolCalls,
        toolResults: context.previousToolResults,
        multiStep: false,
        alreadySent: false
      };
    }
    
    // Execute function calls (in parallel for better performance)
    console.log(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);
    
    // 📢 Send Ack message to user before executing tools (includes provider info)
    await sendToolAckMessage(chatId, functionCalls);
    
    // Execute all tools in parallel (they're independent)
    const toolPromises = functionCalls.map(async (call) => {
      const toolName = call.name;
      const toolArgs = call.args;
      
      console.log(`   → Calling tool: ${toolName} with args:`, toolArgs);
      
      const tool = agentTools[toolName];
      if (!tool) {
        console.error(`❌ Unknown tool: ${toolName}`);
        return {
          functionResponse: {
            name: toolName,
            response: {
              success: false,
              error: `Unknown tool: ${toolName}`
            }
          }
        };
      }
      
      try {
        // Execute the tool
        const toolResult = await tool.execute(toolArgs, context);
        
        // Save result for future tool calls
        context.previousToolResults[toolName] = toolResult;
        
        // Immediately surface raw errors to the user (as-is), even if fallback will follow
        if (toolResult && toolResult.error && context.chatId) {
          try {
            const { greenApiService } = getServices();
            const errorMessage = toolResult.error.startsWith('❌')
              ? toolResult.error
              : `❌ ${toolResult.error}`;
            await greenApiService.sendTextMessage(context.chatId, errorMessage);
          } catch (notifyError) {
            console.error(`❌ Failed to notify user about error: ${notifyError.message}`);
          }
        }
        
        if (toolResult && toolResult.suppressFinalResponse) {
          context.suppressFinalResponse = true;
        }
        
        // 🧠 Track tool call for context memory
        context.toolCalls.push({
          tool: toolName,
          args: toolArgs,
          success: toolResult.success !== false,
          timestamp: Date.now()
        });
        
        // 🧠 Track generated assets for context memory
        if (toolResult.imageUrl) {
          console.log(`✅ [Agent] Tracking image: ${toolResult.imageUrl}, caption: ${toolResult.caption || '(none)'}`);
          context.generatedAssets.images.push({
            url: toolResult.imageUrl,
            caption: toolResult.caption || '',
            prompt: toolArgs.prompt,
            provider: toolResult.provider || toolArgs.provider,
            timestamp: Date.now()
          });
        } else {
          console.log(`⚠️ [Agent] No imageUrl in toolResult for ${toolName}`);
        }
        if (toolResult.videoUrl) {
          context.generatedAssets.videos.push({
            url: toolResult.videoUrl,
            prompt: toolArgs.prompt,
            timestamp: Date.now()
          });
        }
        if (toolResult.audioUrl) {
          if (!context.generatedAssets.audio) context.generatedAssets.audio = [];
          context.generatedAssets.audio.push({
            url: toolResult.audioUrl,
            prompt: toolArgs.prompt || toolArgs.text_to_speak || toolArgs.text,
            timestamp: Date.now()
          });
        }
        if (toolResult.poll) {
          if (!context.generatedAssets.polls) context.generatedAssets.polls = [];
          context.generatedAssets.polls.push({
            question: toolResult.poll.question,
            options: toolResult.poll.options,
            topic: toolArgs.topic,
            timestamp: Date.now()
          });
        }
        
        return {
          functionResponse: {
            name: toolName,
            response: toolResult
          }
        };
      } catch (error) {
        console.error(`❌ Error executing tool ${toolName}:`, error);
        
        // 🧠 Track failed tool call
        context.toolCalls.push({
          tool: toolName,
          args: toolArgs,
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
        
        return {
          functionResponse: {
            name: toolName,
            response: {
              success: false,
              error: `Tool execution failed: ${error.message}`
            }
          }
        };
      }
    });
    
    // Wait for all tools to complete
    const functionResponses = await Promise.all(toolPromises);
    
    // 🧠 Enrich function responses with context for better multi-step handling
    // Add execution context directly IN the response object (not as separate text - that causes Gemini errors)
    const enrichedResponses = functionResponses.map(fr => {
      const result = fr.functionResponse.response;
      
      // Add step completion indicators to help Gemini track progress
      // Result processed successfully
      
      return fr;
    });
    
    // Log execution summary for debugging
    if (functionResponses.length > 0) {
      const successCount = functionResponses.filter(fr => fr.functionResponse.response.success !== false).length;
      const failCount = functionResponses.length - successCount;
      console.log(`📊 [Agent] Tool execution: ${successCount} succeeded, ${failCount} failed`);
    }
    
    // Send function responses back to Gemini
    // CRITICAL: Do NOT add text parts here - Gemini doesn't allow mixing FunctionResponse with text
    response = await chat.sendMessage(enrichedResponses);
  }
  
    // Max iterations reached
    console.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);
    return {
      success: false,
      error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
      toolsUsed: Object.keys(context.previousToolResults),
      iterations: iterationCount,
      toolCalls: context.toolCalls,
      toolResults: context.previousToolResults,
      multiStep: false,
      alreadySent: false
    };
  };
  
  // ⏱️ Execute agent with timeout
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Agent timeout')), agentConfig.timeoutMs)
  );
  
  try {
    return await Promise.race([agentExecution(), timeoutPromise]);
  } catch (error) {
    if (error.message === 'Agent timeout') {
      console.error(`⏱️ [Agent] Timeout after ${agentConfig.timeoutMs}ms`);
      return {
        success: false,
        error: `⏱️ הפעולה ארכה יותר מדי. נסה בקשה פשוטה יותר או נסה שוב מאוחר יותר.`,
        toolsUsed: Object.keys(context.previousToolResults),
        timeout: true,
        toolCalls: context.toolCalls,
        toolResults: context.previousToolResults,
        multiStep: false,
        alreadySent: false
      };
    }
    throw error;
  }
}

// NOTE: shouldUseAgent was removed - all requests now go through routeToAgent
// which uses LLM-based planning and execution (no regex/heuristic intent detection)
// The agent is now the PRIMARY routing mechanism, handling all intent detection via LLM

module.exports = {
  executeAgentQuery
};


