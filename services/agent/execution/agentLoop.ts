import conversationManager from '../../conversationManager';
import { cleanThinkingPatterns } from '../utils/agentHelpers';
import { allTools as agentTools } from '../tools';
import { sendToolAckMessage, FunctionCall } from '../utils/ackUtils';
import { getServices } from '../utils/serviceLoader';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';
import { AgentResult, AgentConfig } from '../types';
import { AgentContextState as AgentContext } from './context';

// Type definitions for better type safety
interface ToolResult {
  success?: boolean;
  error?: string;
  data?: string;
  imageUrl?: string;
  imageCaption?: string;
  caption?: string;
  description?: string;
  revisedPrompt?: string;
  videoUrl?: string;
  videoCaption?: string;
  audioUrl?: string;
  poll?: {
    question: string;
    options: string[];
  };
  provider?: string;
  latitude?: number;
  longitude?: number;
  locationInfo?: string;
  suppressFinalResponse?: boolean;
  errorsAlreadySent?: boolean;
  textOnly?: boolean;
  [key: string]: unknown;
}

interface AgentTool {
  execute(args: unknown, context: AgentContext): Promise<ToolResult>;
}

interface GeminiChatSession {
  sendMessage(prompt: string | ToolFunctionResponse[]): Promise<{
    response: {
      text(): string;
      functionCalls(): FunctionCall[] | undefined;
    };
  }>;
}

interface ToolFunctionResponse {
  functionResponse: {
    name: string;
    response: {
      success?: boolean;
      error?: string;
      [key: string]: unknown;
    };
  };
}

/**
 * Single-step agent execution loop
 * Handles tool calling iterations until final response is reached
 */
class AgentLoop {
  // Track tools that already received ACK to prevent duplicate ACKs
  private ackedTools: Set<string> = new Set();
  // Track creation tools that already succeeded to prevent duplicate execution
  private succeededCreationTools: Set<string> = new Set();

  /**
   * Execute agent loop
   */
  async execute(chat: GeminiChatSession, prompt: string, chatId: string, context: AgentContext, maxIterations: number, agentConfig: AgentConfig): Promise<AgentResult> {
    // Reset tracking sets for each new execution
    this.ackedTools = new Set();
    this.succeededCreationTools = new Set();

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
        const locationResult = context.previousToolResults['send_location'] as ToolResult | undefined;
        const latitude = locationResult?.latitude || null;
        const longitude = locationResult?.longitude || null;
        let locationInfo = locationResult?.locationInfo || locationResult?.data || null;

        // Clean JSON wrappers from locationInfo
        if (typeof locationInfo === 'string') {
          locationInfo = cleanJsonWrapper(locationInfo);
        }

        logger.debug(`🔍 [Agent] Extracted assets - Image: ${latestImageAsset?.url}, Video: ${latestVideoAsset?.url}, Audio: ${latestAudioAsset?.url}, Poll: ${latestPollAsset?.question}, Location: ${latitude}, ${longitude}`);

        // Clean JSON wrappers from final text
        let finalText = context.suppressFinalResponse ? '' : cleanJsonWrapper(text);



        // Get originalMessageId from context for quoting
        const originalMessageId = extractQuotedMessageId({ context });

        // If text is empty and no assets, something went wrong (e.g. only thinking pattern)
        if (!finalText && !latestImageAsset && !latestVideoAsset && !latestAudioAsset && !latestPollAsset && !latitude) {
          logger.warn('⚠️ [Agent] Final response is empty after cleaning thinking patterns. Using fallback.');
          // Try to use original text if available, or generic error
          finalText = text.trim() ? text : 'לא הצלחתי לנסח תשובה ברורה. אנא נסה שנית.';
        }

        return {
          success: true,
          text: finalText,
          imageUrl: latestImageAsset?.url || null,
          imageCaption: latestImageAsset?.caption || '',
          videoUrl: latestVideoAsset?.url || null,
          videoCaption: latestVideoAsset?.caption || '',
          audioUrl: latestAudioAsset?.url || null,
          poll: (latestPollAsset as unknown as { question: string; options: string[] }) || null,
          latitude: latitude,
          longitude: longitude,
          locationInfo: locationInfo as string | null, // Ensure string type
          toolsUsed: Object.keys(context.previousToolResults),
          iterations: iterationCount,
          toolCalls: context.toolCalls,
          toolResults: context.previousToolResults,
          multiStep: false,
          alreadySent: false,
          suppressedFinalResponse: context.suppressFinalResponse || false,
          originalMessageId: originalMessageId || undefined // Pass originalMessageId for quoting
        };
      }

      // Execute function calls (in parallel)
      logger.debug(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);

      // Filter out duplicate calls for creation tools that already succeeded
      // Filter out duplicate calls (Identical Name + Identical Args) to prevent loops
      // Also respect the "succeededCreationTools" logic for creation tools
      const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video', 'image_to_video'];

      const filteredCalls = functionCalls.filter((call: FunctionCall) => {
        // 1. Block creation tools if ANY creation tool of that type succeeded (existing logic)
        if (creationTools.includes(call.name) && this.succeededCreationTools.has(call.name)) {
          logger.warn(`⚠️ [Agent] Blocking duplicate call to ${call.name} - already succeeded in this session`);
          return false;
        }

        // 2. Block IDENTICAL calls (Name + Args) that were already attempted (Success or Fail)
        // This prevents "Insanity" (doing the same thing expecting different results)
        // We check context.toolCalls to see if this exact call was made previously in this session
        // EXCEPTION: "Random" tools are stochastic and valid to repeat with same args
        // Creation tools (image/video) are also valid to repeat as users often want "another one"
        const stochasticTools = [
          'random_amazon_product',
          'random_flight',
          'create_image',
          'generate_image',
          'create_video',
          'generate_video',
          'edit_image',
          'image_to_video',
          'create_music',
          'create_poll',
          'creative_audio_mix',
          'retry_last_command'
        ];

        const isDuplicate = context.toolCalls.some(previous =>
          previous.tool === call.name &&
          JSON.stringify(previous.args) === JSON.stringify(call.args)
        );

        if (isDuplicate && !stochasticTools.includes(call.name)) {
          logger.warn(`⚠️ [Agent] Blocking duplicate tool call: ${call.name} with identical args`);
          return false;
        }

        return true;
      });

      if (filteredCalls.length === 0 && functionCalls.length > 0) {
        // All calls were filtered out. Instead of stopping silently, we should provide feedback to the model
        // so it can generate a text response explaining why it can't proceed or try something else.
        logger.debug(`🛑 [Agent] All function calls were blocked duplicates. Returning feedback to model.`);

        const blockedResponses: ToolFunctionResponse[] = functionCalls.map((call: FunctionCall) => ({
          functionResponse: {
            name: call.name,
            response: {
              success: false,
              error: 'Duplicate tool call blocked. You already executed this tool with these exact arguments. Do not repeat yourself.'
            }
          }
        }));

        // Feed back the error to the model
        response = await chat.sendMessage(blockedResponses);
        continue; // Continue to next iteration to let model generate text response
      }

      // (Dead code removed: if (filteredCalls.length === 0) break; - handled above)

      // Send Ack message ONLY for tools that haven't received ACK yet
      // Get quotedMessageId from context if available
      const quotedMessageId = extractQuotedMessageId({ context });

      // Check if audio was already transcribed (from voice message flow)
      // If so, skip ACK for transcribe_audio to avoid duplicate "מתמלל הקלטה..." messages
      const originalInput = context.originalInput as Record<string, unknown> | null;
      const skipToolsAck: string[] = [];
      if (originalInput?.audioAlreadyTranscribed) {
        skipToolsAck.push('transcribe_audio');
      }

      // Filter calls that need ACK (haven't received one yet in this session)
      const callsNeedingAck = filteredCalls.filter((call: FunctionCall) => !this.ackedTools.has(call.name));
      if (callsNeedingAck.length > 0) {
        await sendToolAckMessage(chatId, callsNeedingAck, { quotedMessageId, skipToolsAck });
        // Mark these tools as acked
        callsNeedingAck.forEach((call: FunctionCall) => this.ackedTools.add(call.name));
      } else {
        logger.debug(`⏭️ [Agent] All tools already have ACK - skipping duplicate ACK`);
      }

      // Execute all tools in parallel
      const toolPromises = filteredCalls.map(async (call: FunctionCall) => {
        return await this.executeTool(call, context);
      });

      const functionResponses = (await Promise.all(toolPromises)) as ToolFunctionResponse[];

      // Log execution summary
      if (functionResponses.length > 0) {
        const successCount = functionResponses.filter(
          (fr) => fr.functionResponse.response.success !== false
        ).length;
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
      originalMessageId: originalMessageId || undefined // Pass originalMessageId for quoting error messages
    };
  }

  /**
   * Execute a single tool
   */
  async executeTool(call: FunctionCall, context: AgentContext): Promise<ToolFunctionResponse> {
    const toolName = call.name;
    const toolArgs = call.args || {};

    logger.debug(`   → Calling tool: ${toolName} with args:`, toolArgs);

    // Cast agentTools to allow indexing by string, but check existence
    const tools = agentTools as unknown as Record<string, AgentTool>;
    const tool = tools[toolName];

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
      const toolResult: ToolResult = await tool.execute(toolArgs, context);

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
          const errorMessage = (toolResult.error as string).startsWith('❌')
            ? (toolResult.error as string)
            : `❌ ${toolResult.error}`;
          // Get originalMessageId from context for quoting
          const quotedMessageId = extractQuotedMessageId({ context });
          await greenApiService.sendTextMessage(context.chatId!, errorMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
        } catch (notifyError: unknown) {
          const err = notifyError as Error;
          logger.error(`❌ Failed to notify user about error:`, { error: err.message, stack: err.stack });
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

      // Track successful creation tools to prevent duplicates
      const creationToolsList = ['create_image', 'create_video', 'edit_image', 'edit_video', 'image_to_video'];
      if (creationToolsList.includes(toolName) && toolResult.success !== false) {
        this.succeededCreationTools.add(toolName);
        logger.debug(`✅ [Agent] Marked ${toolName} as succeeded - will block duplicate calls`);
      }

      // Track generated assets for context memory
      this.trackGeneratedAssets(context, toolName, toolArgs, toolResult);

      return {
        functionResponse: {
          name: toolName,
          response: toolResult
        }
      };
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`❌ Error executing tool ${toolName}:`, { error: err.message, stack: err.stack });

      // Track failed tool call
      context.toolCalls.push({
        tool: toolName,
        args: toolArgs,
        success: false,
        error: err.message,
        timestamp: Date.now()
      });

      return {
        functionResponse: {
          name: toolName,
          response: {
            success: false,
            error: `Tool execution failed: ${err.message}`
          }
        }
      };
    }
  }

  /**
   * Track generated assets in context
   */
  trackGeneratedAssets(context: AgentContext, toolName: string, toolArgs: any, toolResult: ToolResult) {
    // Ensure toolArgs is an object
    const safeArgs = toolArgs || {};

    if (toolResult.imageUrl) {
      // CRITICAL: Check both imageCaption and caption - tools may use either field name
      // Priority: imageCaption > caption > description > revisedPrompt (from provider)
      const imageCaption = toolResult.imageCaption || toolResult.caption || toolResult.description || toolResult.revisedPrompt || '';
      logger.debug(`✅ [Agent] Tracking image: ${toolResult.imageUrl}, caption: ${imageCaption || '(none)'}`);
      context.generatedAssets.images.push({
        url: toolResult.imageUrl!,
        caption: imageCaption,
        prompt: safeArgs.prompt,
        provider: (toolResult.provider as string) || safeArgs.provider,
        timestamp: Date.now()
      });
    } else {
      logger.debug(`⚠️ [Agent] No imageUrl in toolResult for ${toolName}`);
    }

    if (toolResult.videoUrl) {
      // CRITICAL: Check both videoCaption and caption - tools may use either field name
      const videoCaption = toolResult.videoCaption || toolResult.caption || toolResult.description || '';
      context.generatedAssets.videos.push({
        url: toolResult.videoUrl!,
        caption: videoCaption,
        prompt: safeArgs.prompt,
        timestamp: Date.now()
      });
    }

    if (toolResult.audioUrl) {
      if (!context.generatedAssets.audio) context.generatedAssets.audio = [];
      context.generatedAssets.audio.push({
        url: toolResult.audioUrl!,
        prompt: safeArgs.prompt || safeArgs.text_to_speak || safeArgs.text,
        timestamp: Date.now()
      });
    }

    if (toolResult.poll) {
      if (!context.generatedAssets.polls) context.generatedAssets.polls = [];
      context.generatedAssets.polls.push({
        question: toolResult.poll.question,
        options: toolResult.poll.options,
        topic: safeArgs.topic,
        timestamp: Date.now()
      });
    }
  }
}

export default new AgentLoop();
