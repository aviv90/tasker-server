/**
 * Message Processor Service
 * 
 * Centralized service for processing WhatsApp messages (both incoming and outgoing).
 * Handles deduplication, parsing, media extraction, and input normalization.
 */

import { WebhookData } from './types';
import logger from '../../utils/logger';
import { NormalizedInput } from '../../services/agentRouter';
import { extractMessageText, logMessageDetails, buildQuotedContext } from '../../routes/whatsapp/messageParser';
import { extractDirectMediaUrls, extractQuotedMediaUrls, isActualQuote } from './mediaExtraction';
import { isCommand, extractCommandPrompt } from '../../utils/commandUtils';
import { handleQuotedMessage } from '../../routes/whatsapp/quotedMessageHandler';
import { isAuthorizedForMediaCreation } from './authorization';

export interface ProcessedMessageResult {
    shouldProcess: boolean;
    normalizedInput?: NormalizedInput;
    messageText?: string;
    isCommand: boolean;
    error?: string;
}

export class MessageProcessor {
    /**
     * Check if message is a duplicate
     */
    static isDuplicate(messageId: string, processedMessages: Set<string>): boolean {
        if (processedMessages.has(messageId)) {
            logger.debug(`🔄 Duplicate message detected, skipping: ${messageId}`);
            return true;
        }
        processedMessages.add(messageId);
        return false;
    }

    /**
     * Generate unique message ID (handles edited messages)
     */
    static getUniqueMessageId(webhookData: WebhookData): string {
        let messageId = webhookData.idMessage;
        if (webhookData.messageData.typeMessage === 'editedMessage') {
            messageId = `${messageId}_edited_${Date.now()}`;
            logger.debug(`✏️ Edited message - using unique ID: ${messageId}`);
        }
        return messageId;
    }

    /**
     * Process a message and prepare it for the Agent
     */
    static async processMessage(
        webhookData: WebhookData,
        chatId: string,
        isIncoming: boolean
    ): Promise<ProcessedMessageResult> {
        const messageData = webhookData.messageData;
        const senderData = webhookData.senderData;
        const senderName = senderData.senderName || senderData.sender;
        const senderContactName = senderData.senderContactName || "";
        const chatName = senderData.chatName || "";

        // Extract text
        const messageText = extractMessageText(messageData);
        logMessageDetails(messageData, senderName, messageText, isIncoming ? 'Incoming' : 'Outgoing');

        // Helper to check if text is a command
        const isCmd = isCommand(messageText);

        if (!isCmd && isIncoming && messageData.typeMessage !== 'audioMessage') {
            // Not a command, not audio, incoming -> just save to history (handled by caller)
            return { shouldProcess: false, messageText: messageText || undefined, isCommand: false };
        }

        if (!isCommand && !isIncoming) {
            // Outgoing non-command -> ignore
            return { shouldProcess: false, messageText: messageText || undefined, isCommand: false };
        }

        // It's a command (or incoming audio which might be voice command)
        // We'll focus on command processing here. Audio handling is separate in handlers for now.
        if (!isCommand) {
            return { shouldProcess: false, messageText: messageText || undefined, isCommand: false };
        }

        try {
            const basePrompt = extractCommandPrompt(messageText || '');
            const quotedMessage = messageData.quotedMessage;
            const actualQuote = isActualQuote(messageData, quotedMessage);

            let finalPrompt = basePrompt;
            let imageUrl: string | null = null;
            let videoUrl: string | null = null;
            let audioUrl: string | null = null;
            let hasImage = false;
            let hasVideo = false;
            let hasAudio = false;

            // Handle quoted message or media with caption
            if (actualQuote && quotedMessage) {
                // Unified quoted message handling for both incoming and outgoing
                const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);

                if (quotedResult.error) {
                    return { shouldProcess: false, isCommand: true, error: quotedResult.error };
                }

                finalPrompt = quotedResult.prompt || basePrompt;
                hasImage = quotedResult.hasImage ?? false;
                hasVideo = quotedResult.hasVideo ?? false;
                hasAudio = quotedResult.hasAudio ?? false;
                imageUrl = quotedResult.imageUrl || null;
                videoUrl = quotedResult.videoUrl || null;
                audioUrl = quotedResult.audioUrl || null;

            } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
                // Media with caption (not actual quote)
                const quotedMedia = await extractQuotedMediaUrls(quotedMessage, chatId, webhookData.idMessage);
                hasImage = quotedMedia.hasImage ?? false;
                hasVideo = quotedMedia.hasVideo ?? false;
                hasAudio = quotedMedia.hasAudio ?? false;
                imageUrl = quotedMedia.imageUrl || null;
                videoUrl = quotedMedia.videoUrl || null;
                audioUrl = quotedMedia.audioUrl || null;
            } else {
                // Direct media
                const mediaUrls = extractDirectMediaUrls(messageData);
                imageUrl = mediaUrls.imageUrl || null;
                videoUrl = mediaUrls.videoUrl || null;
                audioUrl = mediaUrls.audioUrl || null;
                hasImage = !!imageUrl;
                hasVideo = !!videoUrl;
                hasAudio = !!audioUrl;
            }

            // Build quoted context
            const quotedContext = actualQuote && quotedMessage
                ? buildQuotedContext(quotedMessage, imageUrl, videoUrl, audioUrl)
                : null;

            const originalMessageId = webhookData.idMessage;

            // Authorization check (lazy)
            const authorizations = {
                media_creation: isIncoming
                    ? await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId })
                    : true, // Outgoing always authorized
                group_creation: isIncoming ? null : true,
                voice_allowed: isIncoming ? null : true
            };

            const normalized: NormalizedInput = {
                userText: `# ${finalPrompt}`,
                hasImage,
                hasVideo,
                hasAudio,
                imageUrl,
                videoUrl,
                audioUrl,
                quotedContext,
                originalMessageId,
                chatType: chatId.endsWith('@g.us') ? 'group' : chatId.endsWith('@c.us') ? 'private' : 'unknown',
                language: 'he',
                authorizations,
                senderData: { senderContactName, chatName, senderName, chatId, sender: senderData.sender }
            };


            return {
                shouldProcess: true,
                normalizedInput: normalized,
                messageText: messageText || undefined,
                isCommand: true
            };

        } catch (error: any) {
            logger.error('❌ Error in MessageProcessor:', error);
            return { shouldProcess: false, isCommand: true, error: error.message };
        }
    }
}
