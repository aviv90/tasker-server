/**
 * Incoming Message Handler
 * 
 * Orchestrator for handling incoming WhatsApp messages from users.
 * Refactored to use MessageProcessor (Phase P1-3)
 */

// Import services
import { sendErrorToUser, ERROR_MESSAGES } from '../../utils/errorSender';
import conversationManager from '../../services/conversationManager';
import logger from '../../utils/logger';
import { routeToAgent, AgentResult as RouterAgentResult } from '../../services/agentRouter';
import { processVoiceMessageAsync } from './asyncProcessors';
import { WebhookData } from '../../services/whatsapp/types';
import { MessageProcessor } from '../../services/whatsapp/messageProcessor';
import { sendAgentResults, AgentResult as HandlerAgentResult } from './incoming/resultHandling';
import { saveIncomingUserMessage, extractMediaMetadata } from './incoming/messageStorage';

/**
 * Handle incoming WhatsApp message
 * @param {WebhookData} webhookData - Webhook data from Green API
 * @param {Set} processedMessages - Shared cache for message deduplication
 */
export async function handleIncomingMessage(webhookData: WebhookData, processedMessages: Set<string>): Promise<void> {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;

    // 1. Deduplication
    const uniqueId = MessageProcessor.getUniqueMessageId(webhookData);
    if (MessageProcessor.isDuplicate(uniqueId, processedMessages)) {
      return;
    }

    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";

    // 2. Process Message (Parse, Normalize, Extract Media)
    const result = await MessageProcessor.processMessage(webhookData, chatId, true);

    if (result.error) {
      await sendErrorToUser(chatId, result.error, { quotedMessageId: webhookData.idMessage });
      return;
    }

    // 3. Handle Commands
    if (result.shouldProcess && result.normalizedInput) {
      const normalized = result.normalizedInput;
      const originalMessageId = webhookData.idMessage;

      // Save user message to DB cache with metadata
      const mediaMetadata = extractMediaMetadata(webhookData);
      const combinedMetadata: Record<string, unknown> = { ...mediaMetadata };
      if (normalized.imageUrl) combinedMetadata.imageUrl = normalized.imageUrl;
      if (normalized.videoUrl) combinedMetadata.videoUrl = normalized.videoUrl;
      if (normalized.audioUrl) combinedMetadata.audioUrl = normalized.audioUrl;

      await saveIncomingUserMessage(webhookData, result.messageText || '', combinedMetadata);

      // ═══════════════════ AGENT MODE ═══════════════════
      logger.debug('🤖 [AGENT] Processing request with Gemini Function Calling');

      try {
        const agentResult = await routeToAgent(normalized, chatId);
        void (agentResult as RouterAgentResult);

        if (agentResult) {
          agentResult.originalMessageId = originalMessageId;
        }

        if (agentResult?.success) {
          const handlerResult: HandlerAgentResult = {
            ...agentResult,
            imageUrl: agentResult.imageUrl || undefined,
            videoUrl: agentResult.videoUrl || undefined,
            audioUrl: agentResult.audioUrl || undefined
          };
          await sendAgentResults(chatId, handlerResult, normalized);
        } else {
          await sendErrorToUser(chatId, agentResult?.error || ERROR_MESSAGES.UNKNOWN, { quotedMessageId: originalMessageId || undefined });
        }
      } catch (agentError: any) {
        logger.error('❌ [Agent] Error:', { error: agentError.message, stack: agentError.stack });
        await sendErrorToUser(chatId, agentError, { context: 'REQUEST', quotedMessageId: originalMessageId });
      }
      return;
    }

    // 4. Handle Voice Messages (Automatic Transcription)
    if (messageData.typeMessage === 'audioMessage') {
      logger.debug(`🎤 Detected audio message from ${senderName}`);

      // Save audio message to DB cache
      const mediaMetadata = extractMediaMetadata(webhookData);
      await saveIncomingUserMessage(webhookData, result.messageText || '', mediaMetadata);

      const audioUrl = messageData.downloadUrl ||
        messageData.fileMessageData?.downloadUrl ||
        messageData.audioMessageData?.downloadUrl;

      if (audioUrl) {
        const isAuthorized = await conversationManager.isAuthorizedForVoiceTranscription({
          chatId, senderContactName, chatName, senderName
        });

        if (isAuthorized) {
          logger.info(`🎤 Authorized user ${senderName} sent voice message - processing automatically`);
          processVoiceMessageAsync({
            chatId,
            senderId,
            senderName,
            audioUrl,
            originalMessageId: webhookData.idMessage
          });
        } else {
          logger.info(`🚫 User ${senderName} is not authorized for automatic voice transcription`);
        }
      } else {
        logger.warn(`❌ Audio message detected but no URL found`);
      }
      return;
    }

    // 5. Save other messages to history
    if (!result.isCommand) {
      const mediaMetadata = extractMediaMetadata(webhookData);
      await saveIncomingUserMessage(webhookData, result.messageText || '', mediaMetadata);
    }

  } catch (error: any) {
    logger.error('❌ Error handling incoming message:', { error: error.message || error, stack: error.stack });
  }
}
