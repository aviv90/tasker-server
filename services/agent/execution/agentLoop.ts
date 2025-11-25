// @ts-nocheck
const { GoogleGenerativeAI } = require('@google/generative-ai');
// Handle default export from TypeScript
const conversationManagerModule = require('../../conversationManager');
const conversationManager = conversationManagerModule.default || conversationManagerModule;
const { cleanThinkingPatterns } = require('../../../utils/agentHelpers');
const { allTools: agentTools } = require('../tools');
const { sendToolAckMessage } = require('../utils/ackUtils');
const { getServices } = require('../utils/serviceLoader');
const { extractQuotedMessageId } = require('../../../utils/messageHelpers');
const { cleanJsonWrapper } = require('../../../utils/textSanitizer');
const logger = require('../../../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Single-step agent execution loop
 * Handles tool calling iterations until final response is reached
 */
class AgentLoop {
  /**
   * Execute agent loop
   * @param {Object} chat - Gemini chat instance
   * @param {string} prompt - User prompt
   * @param {string} chatId - Chat ID
   * @param {Object} context - Agent context
   * @param {number} maxIterations - Maximum iterations
   * @param {Object} agentConfig - Agent configuration
   * @returns {Promise<Object>} - Execution result
   */
  async execute(chat, prompt, chatId, context, maxIterations, agentConfig) {
    let response = await chat.sendMessage(prompt);
    let iterationCount = 0;

    while (iterationCount < maxIterations) {
      iterationCount++;
      logger.debug(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);

      const result = response.response;
      const functionCalls = result.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        // No more function calls - final answer
        let text = result.text();
        text = cleanThinkingPatterns(text);

        logger.info(`✅ [Agent] Completed in ${iterationCount} iterations`);

        // Save context if enabled
        if (agentConfig.contextMemoryEnabled) {
          await conversationManager.saveAgentContext(chatId, {
            toolCalls: context.toolCalls,
            generatedAssets: context.generatedAssets
          });
          logger.debug(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
        }

        // Extract latest generated media
        logger.debug(`🔍 [Agent] Assets: ${context.generatedAssets.images.length} images, ${context.generatedAssets.videos.length} videos, ${context.generatedAssets.audio.length} audio`);

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

        // Check if send_location was called
        const locationResult = context.previousToolResults['send_location'];
        const latitude = locationResult?.latitude || null;
        const longitude = locationResult?.longitude || null;
        let locationInfo = locationResult?.locationInfo || locationResult?.data || null;
        
        // Clean JSON wrappers from locationInfo
        if (locationInfo) {
          locationInfo = cleanJsonWrapper(locationInfo);
        }

        logger.debug(`🔍 [Agent] Extracted assets - Image: ${latestImageAsset?.url}, Video: ${latestVideoAsset?.url}, Audio: ${latestAudioAsset?.url}, Poll: ${latestPollAsset?.question}, Location: ${latitude}, ${longitude}`);

        // Clean JSON wrappers from final text
        let finalText = context.suppressFinalResponse ? '' : cleanJsonWrapper(text);

        // Get originalMessageId from context for quoting
        const originalMessageId = extractQuotedMessageId({ context });

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
          alreadySent: false,
          originalMessageId: originalMessageId // Pass originalMessageId for quoting
        };
      }

      // Execute function calls (in parallel)
      logger.debug(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);

      // Send Ack message before executing tools
      // Get quotedMessageId from context if available
      const quotedMessageId = extractQuotedMessageId({ context });
      await sendToolAckMessage(chatId, functionCalls, quotedMessageId);

      // Execute all tools in parallel
      const toolPromises = functionCalls.map(async (call) => {
        return await this.executeTool(call, context);
      });

      const functionResponses = await Promise.all(toolPromises);

      // Log execution summary
      if (functionResponses.length > 0) {
        const successCount = functionResponses.filter(fr => fr.functionResponse.response.success !== false).length;
        const failCount = functionResponses.length - successCount;
        logger.debug(`📊 [Agent] Tool execution: ${successCount} succeeded, ${failCount} failed`);
      }

      // Send function responses back to Gemini
      response = await chat.sendMessage(functionResponses);
    }

    // Max iterations reached
    logger.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);
    // Get originalMessageId from context for quoting
    const originalMessageId = extractQuotedMessageId({ context });
    return {
      success: false,
      error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
      toolsUsed: Object.keys(context.previousToolResults),
      iterations: iterationCount,
      toolCalls: context.toolCalls,
      toolResults: context.previousToolResults,
      multiStep: false,
      alreadySent: false,
      originalMessageId: originalMessageId // Pass originalMessageId for quoting error messages
    };
  }

  /**
   * Execute a single tool
   */
  async executeTool(call, context) {
    const toolName = call.name;
    const toolArgs = call.args;

    logger.debug(`   → Calling tool: ${toolName} with args:`, toolArgs);

    const tool = agentTools[toolName];
    if (!tool) {
      logger.error(`❌ Unknown tool: ${toolName}`);
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

      // Immediately surface raw errors to the user (as-is)
      // BUT: Skip if:
      // 1. Errors were already sent (e.g., by ProviderFallback during fallback attempts)
      // 2. Tool will be retried (suppressFinalResponse = true means fallback is happening)
      const shouldSendError = toolResult && 
                             toolResult.error && 
                             context.chatId && 
                             !toolResult.errorsAlreadySent &&
                             !toolResult.suppressFinalResponse;
      
      if (shouldSendError) {
        try {
          const { greenApiService } = getServices();
          const { TIME } = require('../../../utils/constants');
          const errorMessage = toolResult.error.startsWith('❌')
            ? toolResult.error
            : `❌ ${toolResult.error}`;
          // Get originalMessageId from context for quoting
          const quotedMessageId = extractQuotedMessageId({ context });
          await greenApiService.sendTextMessage(context.chatId, errorMessage, quotedMessageId, TIME.TYPING_INDICATOR);
        } catch (notifyError) {
          logger.error(`❌ Failed to notify user about error:`, { error: notifyError.message, stack: notifyError.stack });
        }
      }

      if (toolResult && toolResult.suppressFinalResponse) {
        context.suppressFinalResponse = true;
      }

      // Track tool call for context memory
      context.toolCalls.push({
        tool: toolName,
        args: toolArgs,
        success: toolResult.success !== false,
        timestamp: Date.now()
      });

      // Track generated assets for context memory
      this.trackGeneratedAssets(context, toolName, toolArgs, toolResult);

      return {
        functionResponse: {
          name: toolName,
          response: toolResult
        }
      };
    } catch (error) {
      logger.error(`❌ Error executing tool ${toolName}:`, { error: error.message, stack: error.stack });

      // Track failed tool call
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
  }

  /**
   * Track generated assets in context
   */
  trackGeneratedAssets(context, toolName, toolArgs, toolResult) {
    if (toolResult.imageUrl) {
      logger.debug(`✅ [Agent] Tracking image: ${toolResult.imageUrl}, caption: ${toolResult.caption || '(none)'}`);
      context.generatedAssets.images.push({
        url: toolResult.imageUrl,
        caption: toolResult.caption || '',
        prompt: toolArgs.prompt,
        provider: toolResult.provider || toolArgs.provider,
        timestamp: Date.now()
      });
    } else {
      logger.debug(`⚠️ [Agent] No imageUrl in toolResult for ${toolName}`);
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
  }
}

module.exports = new AgentLoop();

