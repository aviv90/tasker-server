const { executeSingleStep } = require('./singleStep');
const { sendToolAckMessage } = require('../utils/ackUtils');
const { formatProviderName } = require('../utils/providerUtils');
const { TOOL_ACK_MESSAGES } = require('../config/constants');
const { getServices } = require('../utils/serviceLoader');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { allTools: agentTools } = require('../tools');
const prompts = require('../../../config/prompts');
const resultSender = require('./resultSender');

/**
 * Multi-step execution handler
 * Executes multiple steps sequentially with proper context and result handling
 */
class MultiStepExecution {
  /**
   * Execute multi-step plan
   * @param {Object} plan - Plan from planner
   * @param {string} chatId - Chat ID
   * @param {Object} options - Execution options
   * @param {string} languageInstruction - Language instruction
   * @param {Object} agentConfig - Agent configuration
   * @returns {Promise<Object>} - Execution result
   */
  async execute(plan, chatId, options, languageInstruction, agentConfig) {
    console.log(`✅ [Planner] Entering multi-step execution with ${plan.steps.length} steps`);
    
    // Adjust config for multi-step
    agentConfig.maxIterations = Math.max(agentConfig.maxIterations, 15);
    agentConfig.timeoutMs = Math.max(agentConfig.timeoutMs, 360000); // 6 minutes
    
    const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
    const systemInstruction = prompts.agentSystemInstruction(languageInstruction);
    
    const stepResults = [];
    let accumulatedText = '';
    const finalAssets = {
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
      const toolName = step.tool || null;
      const toolParams = step.parameters || {};
      
      // Send Ack BEFORE executing the step
      if (toolName) {
        console.log(`📢 [Multi-step] Sending Ack for Step ${step.stepNumber}/${plan.steps.length} (${toolName}) BEFORE execution`);
        // Get quotedMessageId from options.input if available
        const quotedMessageId = options.input?.originalMessageId || null;
        await sendToolAckMessage(chatId, [{ name: toolName, args: toolParams }], quotedMessageId);
      }
      
      // Build focused prompt for this step
      let stepPrompt = step.action;
      
      // Add context from previous steps
      if (stepResults.length > 0) {
        const previousContext = stepResults.map((res, idx) => {
          let summary = `Step ${idx + 1}:`;
          if (res.text) summary += ` ${res.text.substring(0, 200)}`;
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
          maxIterations: 5,
          languageInstruction,
          agentConfig,
          functionDeclarations,
          systemInstruction: prompts.singleStepInstruction(languageInstruction),
          expectedTool: toolName
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
          
          // Get quotedMessageId from options.input if available
          const quotedMessageId = options.input?.originalMessageId || null;
          console.log(`🔍 [MultiStep] quotedMessageId for step ${step.stepNumber}: ${quotedMessageId}, from options.input: ${options.input?.originalMessageId}`);
          
          // Send ALL results immediately in order
          await resultSender.sendStepResults(chatId, stepResult, step.stepNumber, quotedMessageId);
          
          console.log(`✅ [Multi-step] Step ${step.stepNumber}/${plan.steps.length} completed and ALL results sent`);
        } else {
          // Step failed - try fallback
          console.error(`❌ [Agent] Step ${step.stepNumber}/${plan.steps.length} failed:`, stepResult.error);
          
          const fallbackResult = await this.tryFallback(chatId, toolName, toolParams, step, stepResult);
          if (fallbackResult) {
            stepResults.push(fallbackResult);
          } else {
            // Send error for non-creation tools
            if (!this.isCreationTool(toolName)) {
              await this.sendError(chatId, stepResult.error, step.stepNumber);
            }
          }
        }
      } catch (stepError) {
        console.error(`❌ [Agent] Error executing step ${step.stepNumber}:`, stepError.message);
        await this.sendError(chatId, stepError.message || stepError.toString(), step.stepNumber, true);
      }
    }
    
    // Clean and process final text
    let finalText = accumulatedText.trim();
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
    
    console.log(`🏁 [Agent] Multi-step execution completed: ${stepResults.length}/${plan.steps.length} steps successful`);
    
    return {
      success: true,
      text: finalText,
      ...finalAssets,
      toolsUsed: stepResults.flatMap(r => r.toolsUsed || []),
      iterations: stepResults.reduce((sum, r) => sum + (r.iterations || 0), 0),
      multiStep: true,
      stepsCompleted: stepResults.length,
      totalSteps: plan.steps.length,
      alreadySent: true
    };
  }

  /**
   * Try fallback for creation tools
   */
  async tryFallback(chatId, toolName, toolParams, step, stepResult) {
    const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video'];
    
    if (!this.isCreationTool(toolName)) {
      return null;
    }
    
    // Send initial error first
    if (stepResult.error) {
      await this.sendError(chatId, stepResult.error.toString(), step.stepNumber);
    }
    
    console.log(`🔄 [Multi-step Fallback] Attempting automatic fallback for ${toolName}...`);
    
    try {
      const { greenApiService } = getServices();
      
      // Determine provider order based on what failed
      const avoidProvider = toolParams.provider || 'gemini';
      const imageProviders = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
      const videoProviders = ['veo3', 'sora', 'kling'].filter(p => p !== avoidProvider);
      
      let providersToTry = toolName.includes('image') ? imageProviders : videoProviders;
      
      // Try each provider with Ack
      for (const provider of providersToTry) {
        console.log(`🔄 [Multi-step Fallback] Trying ${provider}...`);
        
        // Send Ack for this fallback attempt
        // Get quotedMessageId from options.input if available
        const quotedMessageId = options.input?.originalMessageId || null;
        await sendToolAckMessage(chatId, [{ name: toolName, args: { provider } }], quotedMessageId);
        
        try {
          const result = await this.executeFallbackTool(toolName, provider, toolParams, step, chatId);
          
          if (result && result.success) {
            console.log(`✅ [Multi-step Fallback] ${provider} succeeded!`);
            
            // Send the result
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
            
            // Success message (optional)
            if (result.data && !result.imageUrl && !result.videoUrl) {
              await greenApiService.sendTextMessage(chatId, result.data);
            }
            
            return result;
          } else {
            const errorMsg = result?.error || 'Unknown error';
            console.log(`❌ [Multi-step Fallback] ${provider} failed: ${errorMsg}`);
            await greenApiService.sendTextMessage(chatId, `❌ ${errorMsg}`);
          }
        } catch (providerError) {
          const errorMsg = providerError.message;
          console.error(`❌ [Multi-step Fallback] ${provider} threw error:`, errorMsg);
          await greenApiService.sendTextMessage(chatId, `❌ ${errorMsg}`);
        }
      }
      
      // All fallbacks failed
      console.log(`❌ [Multi-step Fallback] All providers failed for ${toolName}`);
      await greenApiService.sendTextMessage(chatId, `❌ כל הספקים נכשלו עבור ${toolName}`);
      return null;
    } catch (fallbackError) {
      console.error(`❌ [Multi-step Fallback] Critical error during fallback:`, fallbackError.message);
      return null;
    }
  }

  /**
   * Execute fallback tool with different provider
   */
  async executeFallbackTool(toolName, provider, toolParams, step, chatId) {
    const promptToUse = toolParams.prompt || toolParams.text || step.action;
    
    if (toolName === 'create_image') {
      return await agentTools.create_image.execute({ prompt: promptToUse, provider }, { chatId });
    } else if (toolName === 'create_video') {
      return await agentTools.create_video.execute({ prompt: promptToUse, provider }, { chatId });
    } else if (toolName === 'edit_image') {
      return await agentTools.edit_image.execute({
        image_url: toolParams.image_url,
        edit_instruction: promptToUse,
        service: provider
      }, { chatId });
    } else if (toolName === 'edit_video') {
      return await agentTools.edit_video.execute({
        video_url: toolParams.video_url,
        edit_instruction: promptToUse,
        provider
      }, { chatId });
    }
    
    return null;
  }

  /**
   * Check if tool is a creation tool
   */
  isCreationTool(toolName) {
    const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video'];
    return creationTools.includes(toolName);
  }

  /**
   * Send error message to user
   */
  async sendError(chatId, error, stepNumber = null, isException = false) {
    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` שגיאה בביצוע שלב ${stepNumber}:` : '';
      const prefix = isException ? `❌${stepInfo}` : '❌';
      const errorMessage = error.startsWith('❌') ? error : `${prefix} ${error}`;
      await greenApiService.sendTextMessage(chatId, errorMessage);
      console.log(`📤 [Multi-step] Error sent to user${stepNumber ? ` for step ${stepNumber}` : ''}`);
    } catch (errorSendError) {
      console.error(`❌ [Multi-step] Failed to send error message:`, errorSendError.message);
    }
  }
}

module.exports = new MultiStepExecution();

