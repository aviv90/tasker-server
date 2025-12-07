import { allTools as agentTools } from '../tools';
import { sendToolAckMessage, FunctionCall } from '../utils/ackUtils';
import { getServices } from '../utils/serviceLoader';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';
import { AgentContextState as AgentContext } from './context';
import { AgentTool, ToolFunctionResponse, ToolResult } from '../types';

/**
 * Tool Handler
 * Encapsulates logic for executing tool calls, handling Acks, deduplication, and asset tracking.
 */
export class ToolHandler {
    /**
     * Execute a batch of function calls
     */
    async executeBatch(
        functionCalls: FunctionCall[],
        context: AgentContext,
        ackedTools: Set<string>,
        succeededCreationTools: Set<string>,
        chatId: string
    ): Promise<ToolFunctionResponse[]> {
        logger.debug(`🔧 [ToolHandler] Processing ${functionCalls.length} function call(s)`);

        // 1. Filter duplicate calls
        const filteredCalls = this.filterDuplicateCalls(functionCalls, context, succeededCreationTools);

        if (filteredCalls.length === 0 && functionCalls.length > 0) {
            logger.debug(`🛑 [ToolHandler] All function calls were blocked duplicates.`);
            return functionCalls.map(call => ({
                functionResponse: {
                    name: call.name,
                    response: {
                        success: false,
                        error: 'Duplicate tool call blocked. You already executed this tool with these exact arguments. Do not repeat yourself.'
                    }
                }
            }));
        }

        // 2. Send Acks
        await this.sendAcks(filteredCalls, context, ackedTools, chatId);

        // 3. Execute Tools (Parallel)
        const toolPromises = filteredCalls.map(async (call) => {
            return await this.executeTool(call, context, succeededCreationTools);
        });

        const functionResponses = await Promise.all(toolPromises);

        // Log summary
        if (functionResponses.length > 0) {
            const successCount = functionResponses.filter(
                (fr) => fr.functionResponse.response.success !== false
            ).length;
            const failCount = functionResponses.length - successCount;
            logger.debug(`📊 [ToolHandler] Batch execution: ${successCount} succeeded, ${failCount} failed`);
        }

        return functionResponses;
    }

    /**
     * Filter duplicate calls based on context and success history
     */
    private filterDuplicateCalls(
        functionCalls: FunctionCall[],
        context: AgentContext,
        succeededCreationTools: Set<string>
    ): FunctionCall[] {
        const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video', 'image_to_video'];
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

        return functionCalls.filter((call) => {
            // Block creation tools if ANY creation tool of that type succeeded
            if (creationTools.includes(call.name) && succeededCreationTools.has(call.name)) {
                logger.warn(`⚠️ [ToolHandler] Blocking duplicate call to ${call.name} - already succeeded in this session`);
                return false;
            }

            // Block IDENTICAL calls
            const isDuplicate = context.toolCalls.some(previous =>
                previous.tool === call.name &&
                JSON.stringify(previous.args) === JSON.stringify(call.args)
            );

            if (isDuplicate && !stochasticTools.includes(call.name)) {
                logger.warn(`⚠️ [ToolHandler] Blocking duplicate tool call: ${call.name} with identical args`);
                return false;
            }

            return true;
        });
    }

    /**
     * Send Acknowledgment messages
     */
    private async sendAcks(
        calls: FunctionCall[],
        context: AgentContext,
        ackedTools: Set<string>,
        chatId: string
    ): Promise<void> {
        const quotedMessageId = extractQuotedMessageId({ context });

        // Check if audio was already transcribed
        const originalInput = context.originalInput as Record<string, unknown> | null;
        const skipToolsAck: string[] = [];
        if (originalInput?.audioAlreadyTranscribed) {
            skipToolsAck.push('transcribe_audio');
        }

        const callsNeedingAck = calls.filter(call => !ackedTools.has(call.name));

        if (callsNeedingAck.length > 0) {
            await sendToolAckMessage(chatId, callsNeedingAck, { quotedMessageId, skipToolsAck });
            callsNeedingAck.forEach(call => ackedTools.add(call.name));
        } else {
            logger.debug(`⏭️ [ToolHandler] All tools already have ACK - skipping duplicate ACK`);
        }
    }

    /**
     * Execute a single tool
     */
    private async executeTool(
        call: FunctionCall,
        context: AgentContext,
        succeededCreationTools: Set<string>
    ): Promise<ToolFunctionResponse> {
        const toolName = call.name;
        const toolArgs = call.args || {};

        logger.debug(`   → Calling tool: ${toolName} with args:`, toolArgs);

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

            // Handle immediate error notification
            await this.notifyUserOfError(toolResult, context);

            if (toolResult && toolResult.suppressFinalResponse) {
                context.suppressFinalResponse = true;
            }

            // Track tool call
            context.toolCalls.push({
                tool: toolName,
                args: toolArgs as Record<string, unknown>,
                success: toolResult.success !== false,
                timestamp: Date.now()
            });

            // Mark successful creation tools
            const creationToolsList = ['create_image', 'create_video', 'edit_image', 'edit_video', 'image_to_video'];
            if (creationToolsList.includes(toolName) && toolResult.success !== false) {
                succeededCreationTools.add(toolName);
                logger.debug(`✅ [ToolHandler] Marked ${toolName} as succeeded`);
            }

            // Track generated assets
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

            context.toolCalls.push({
                tool: toolName,
                args: toolArgs as Record<string, unknown>,
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
     * Notify user of errors immediately if appropriate
     */
    private async notifyUserOfError(toolResult: ToolResult, context: AgentContext): Promise<void> {
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
                const quotedMessageId = extractQuotedMessageId({ context });
                await greenApiService.sendTextMessage(context.chatId!, errorMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
            } catch (notifyError: unknown) {
                const err = notifyError as Error;
                logger.error(`❌ Failed to notify user about error:`, { error: err.message });
            }
        }
    }

    /**
     * Track generated assets in context
     */
    private trackGeneratedAssets(context: AgentContext, toolName: string, toolArgs: any, toolResult: ToolResult) {
        const safeArgs = toolArgs || {};

        if (toolResult.imageUrl) {
            const imageCaption = toolResult.imageCaption || toolResult.caption || toolResult.description || toolResult.revisedPrompt || '';
            logger.debug(`✅ [ToolHandler] Tracking image: ${toolResult.imageUrl}`);
            context.generatedAssets.images.push({
                url: toolResult.imageUrl!,
                caption: imageCaption,
                prompt: safeArgs.prompt,
                provider: (toolResult.provider as string) || safeArgs.provider,
                timestamp: Date.now()
            });
        }

        if (toolResult.videoUrl) {
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

export default new ToolHandler();
