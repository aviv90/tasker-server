const { GoogleGenerativeAI } = require('@google/generative-ai');
const conversationManager = require('../../conversationManager');
const { cleanThinkingPatterns } = require('../../../utils/agentHelpers');
const { allTools: agentTools } = require('../tools');
const { sendToolAckMessage } = require('../utils/ackUtils');
const { getServices } = require('../utils/serviceLoader');

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
      console.log(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);

      const result = response.response;
      const functionCalls = result.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        // No more function calls - final answer
        let text = result.text();
        text = cleanThinkingPatterns(text);

        console.log(`✅ [Agent] Completed in ${iterationCount} iterations`);

        // Save context if enabled
        if (agentConfig.contextMemoryEnabled) {
          await conversationManager.saveAgentContext(chatId, {
            toolCalls: context.toolCalls,
            generatedAssets: context.generatedAssets
          });
          console.log(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
        }

        // Extract latest generated media
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

        // Check if send_location was called
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

      // Execute function calls (in parallel)
      console.log(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);

      // Send Ack message before executing tools
      // Get quotedMessageId from context if available
      const quotedMessageId = context.originalInput?.originalMessageId || null;
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
        console.log(`📊 [Agent] Tool execution: ${successCount} succeeded, ${failCount} failed`);
      }

      // Send function responses back to Gemini
      response = await chat.sendMessage(functionResponses);
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
  }

  /**
   * Execute a single tool
   */
  async executeTool(call, context) {
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

      // Immediately surface raw errors to the user (as-is)
      // BUT: Skip if errors were already sent (e.g., by ProviderFallback during fallback attempts)
      if (toolResult && toolResult.error && context.chatId && !toolResult.errorsAlreadySent) {
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
      console.error(`❌ Error executing tool ${toolName}:`, error);

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
  }
}

module.exports = new AgentLoop();

