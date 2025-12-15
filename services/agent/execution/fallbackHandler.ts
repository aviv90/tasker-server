import { Step } from './multiStep';
import { StepResult } from '../types';
import { getServices } from '../utils/serviceLoader';
import { allTools as agentTools } from '../tools';
import logger from '../../../utils/logger';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { cleanMediaDescription } from '../../../utils/textSanitizer';
import { cleanAgentText } from '../../../services/whatsapp/utils';
import { formatProviderError } from '../../../utils/errorHandler';
import agentContext from './context';

export class FallbackHandler {
    /**
     * Try fallback for creation tools
     */
    async tryFallback(chatId: string, toolName: string | null, toolParams: Record<string, unknown>, step: Step, stepResult: StepResult, quotedMessageId: string | null = null, language: string = 'he'): Promise<StepResult | null> {

        if (!toolName || !this.isCreationTool(toolName)) {
            return null;
        }

        // Don't send initial error here - it's already sent by the tool itself
        // Just log it
        if (stepResult.error) {
            logger.debug(`🔍 [Multi-step Fallback] Initial error: ${stepResult.error}`);
        }

        logger.debug(`🔄 [Multi-step Fallback] Attempting automatic fallback for ${toolName}...`);

        // Check if tool handles internal fallback (create_video/image_to_video/create_image)
        // If provider was NOT specified by user, the tool (via ProviderFallback) already tried ALL providers.
        // In that case, we should NOT retry here to avoid double-execution and chaotic logs.
        const toolsWithInternalFallback = ['create_video', 'image_to_video', 'create_image', 'edit_image', 'edit_video'];
        const userSpecifiedProvider = !!(toolParams.provider || toolParams.service);

        if (toolsWithInternalFallback.includes(toolName) && !userSpecifiedProvider) {
            logger.warn(`⚠️ [Multi-step Fallback] Tool ${toolName} already attempts internal fallback. Skipping external fallback to avoid duplications.`);
            return null;
        }

        try {
            const { greenApiService } = getServices();

            // Determine provider order based on what failed
            const avoidProvider = (toolParams.provider as string) || 'gemini';
            const imageProviders = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
            const videoProviders = ['veo3', 'sora', 'kling'].filter(p => p !== avoidProvider);

            const providersToTry = toolName.includes('image') ? imageProviders : videoProviders;

            // Try each provider
            // CRITICAL: Don't send ACK in fallback - the tool already received ACK before execution
            // Sending ACK again here would create duplicate ACK messages
            // The original ACK was sent at line 126 before step execution
            for (const provider of providersToTry) {
                logger.debug(`🔄 [Multi-step Fallback] Trying ${provider}...`);

                try {
                    const result = await this.executeFallbackTool(toolName, provider, toolParams, step, chatId);

                    if (result && result.success) {
                        logger.info(`✅ [Multi-step Fallback] ${provider} succeeded!`);

                        // Send the result
                        if (result.imageUrl) {
                            const fullImageUrl = normalizeStaticFileUrl(result.imageUrl);

                            // CRITICAL: Caption MUST be sent with the image, not in a separate message
                            // Priority: imageCaption > caption > text (if text is not generic success message)
                            let caption = result.imageCaption || result.caption || '';

                            // If no caption but text exists and is not a generic success message, use text as caption
                            if (!caption && result.text && typeof result.text === 'string' && result.text.trim()) {


                                caption = result.text;
                            }

                            const cleanCaption = cleanMediaDescription(caption || '');

                            // Send image WITH caption (caption is always sent with media, never separately)
                            await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, cleanCaption, quotedMessageId || undefined, 1000);
                            logger.debug(`✅ [Multi-step Fallback] Image sent successfully with caption`);

                            // Only send additional text in a separate message if:
                            // 1. Text exists and is different from caption
                            // 2. Text is not a generic success message or apology
                            // 3. Text is meaningfully different (more than just whitespace/formatting)
                            if (result.text && typeof result.text === 'string' && result.text.trim()) {
                                const textToCheck = cleanMediaDescription(result.text);
                                const captionToCheck = cleanMediaDescription(caption);


                                // Only send if text is meaningfully different from caption
                                if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
                                    const additionalText = cleanAgentText(result.text);
                                    if (additionalText && additionalText.trim()) {
                                        logger.debug(`📝 [Multi-step Fallback] Sending additional text after image (${additionalText.length} chars)`);
                                        await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
                                    }
                                }
                            }
                        }

                        if (result.videoUrl) {
                            const fullVideoUrl = normalizeStaticFileUrl(result.videoUrl);

                            // CRITICAL: Caption MUST be sent with the video, not in a separate message
                            // Priority: videoCaption > caption > text (if text is not generic success message)
                            let caption = result.videoCaption || result.caption || '';

                            // If no caption but text exists and is not a generic success message, use text as caption
                            if (!caption && result.text && typeof result.text === 'string' && result.text.trim()) {


                                caption = result.text;
                            }

                            const cleanCaption = cleanMediaDescription(caption || '');

                            // Send video WITH caption (caption is always sent with media, never separately)
                            await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, cleanCaption, quotedMessageId || undefined, 1000);
                            logger.debug(`✅ [Multi-step Fallback] Video sent successfully with caption`);

                            // Only send additional text in a separate message if:
                            // 1. Text exists and is different from caption
                            // 2. Text is not a generic success message or apology
                            // 3. Text is meaningfully different (more than just whitespace/formatting)
                            if (result.text && typeof result.text === 'string' && result.text.trim()) {
                                const textToCheck = cleanMediaDescription(result.text);
                                const captionToCheck = cleanMediaDescription(caption);


                                // Only send if text is meaningfully different from caption
                                if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
                                    const additionalText = cleanAgentText(result.text);
                                    if (additionalText && additionalText.trim()) {
                                        logger.debug(`📝 [Multi-step Fallback] Sending additional text after video (${additionalText.length} chars)`);
                                        await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
                                    }
                                }
                            }
                        }

                        // Success message (optional) - only if no media was sent
                        // Skip generic success messages if media was already sent
                        if (result.data && typeof result.data === 'string' && !result.imageUrl && !result.videoUrl) {
                            const dataText = result.data.trim();
                            await greenApiService.sendTextMessage(chatId, dataText, quotedMessageId || undefined, 1000);
                        }

                        return result;
                    } else {
                        const errorMsg = result?.error || 'Unknown error';
                        logger.warn(`❌ [Multi-step Fallback] ${provider} failed: ${errorMsg}`);
                        // Don't send error if it was already sent by ProviderFallback
                        if (!result?.errorsAlreadySent) {
                            const formattedError = formatProviderError(provider, errorMsg, language);
                            await greenApiService.sendTextMessage(chatId, formattedError, quotedMessageId || undefined, 1000);
                        }
                    }
                } catch (providerError: any) {
                    const errorMsg = providerError.message || 'Unknown error';
                    logger.error(`❌ [Multi-step Fallback] ${provider} threw error:`, { error: errorMsg });
                    // Only send error if it wasn't already sent by ProviderFallback
                    // (ProviderFallback sends errors in _handleProviderError)
                    const formattedError = formatProviderError(provider, errorMsg, language);
                    await greenApiService.sendTextMessage(chatId, formattedError, quotedMessageId || undefined, 1000);
                }
            }

            // All fallbacks failed
            logger.warn(`❌ [Multi-step Fallback] All providers failed for ${toolName}`);
            await greenApiService.sendTextMessage(chatId, `❌ כל הספקים נכשלו עבור ${toolName}`, quotedMessageId || undefined, 1000);
            return null;
        } catch (fallbackError: any) {
            logger.error(`❌ [Multi-step Fallback] Critical error during fallback:`, { error: fallbackError.message });
            return null;
        }
    }

    /**
     * Execute fallback tool with different provider
     */
    async executeFallbackTool(toolName: string, provider: string, toolParams: Record<string, unknown>, step: Step, chatId: string): Promise<StepResult | null> {
        const promptToUse = (toolParams.prompt as string) || (toolParams.text as string) || step.action;
        const context = agentContext.createInitialContext(chatId);

        if (toolName === 'create_image') {
            if (!agentTools.create_image) return null;
            return await agentTools.create_image.execute({ prompt: promptToUse, provider }, context) as StepResult;
        } else if (toolName === 'create_video') {
            if (!agentTools.create_video) return null;
            return await agentTools.create_video.execute({ prompt: promptToUse, provider }, context) as StepResult;
        } else if (toolName === 'edit_image') {
            if (!agentTools.edit_image) return null;
            return await agentTools.edit_image.execute({
                image_url: toolParams.image_url as string,
                edit_instruction: promptToUse,
                service: provider as 'openai' | 'gemini'
            }, context) as StepResult;
        } else if (toolName === 'edit_video') {
            if (!agentTools.edit_video) return null;
            return await agentTools.edit_video.execute({
                video_url: toolParams.video_url as string,
                edit_instruction: promptToUse,
                // provider - EditVideoArgs does not explicitly support provider in definition? ignoring it or casting.
                // Assuming provider selection handles internal logic or args update needed.
                // But since I refactored edit_video and it uses generic args, extra props might trigger error.
                // So I exclude provider here.
            }, context) as StepResult;
        }

        return null;
    }

    /**
     * Check if tool is a creation tool
     */
    isCreationTool(toolName: string): boolean {
        const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video'];
        return creationTools.includes(toolName);
    }
}
