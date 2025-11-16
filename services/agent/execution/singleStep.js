/**
 * Single Step Execution - Execute a single step in a workflow
 * 
 * Handles execution of individual steps in both single-step and multi-step workflows.
 * - Manages tool execution with context
 * - Enforces expected tool restrictions in multi-step mode
 * - Extracts assets (images, videos, audio, etc.) from tool results
 * - Prevents tool confusion by isolating each step
 * 
 * Extracted from agentService.js (Phase 4.2)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const prompts = require('../../../config/prompts');
const { cleanThinkingPatterns } = require('../../../utils/agentHelpers');
const { allTools: agentTools } = require('../tools');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Execute a single step in a multi-step workflow
 * @param {string} stepPrompt - Prompt for this specific step
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Configuration options
 * @param {number} options.maxIterations - Max iterations for tool calling loop (default: 5)
 * @param {string} options.languageInstruction - Language-specific instruction
 * @param {Object} options.agentConfig - Agent configuration (model, etc.)
 * @param {Array} options.functionDeclarations - Tool declarations for this step
 * @param {string} options.systemInstruction - Custom system instruction (optional)
 * @param {string} options.expectedTool - In multi-step, restrict execution to this tool only
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

module.exports = {
  executeSingleStep
};

