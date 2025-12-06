/**
 * Outgoing Message Handler
 * 
 * Handles outgoing WhatsApp messages (commands sent by you).
 * Refactored to use MessageProcessor (Phase P1-3)
 */

// Import services
import conversationManager from '../../services/conversationManager';
import { routeToAgent } from '../../services/agentRouter';
import { sendErrorToUser, ERROR_MESSAGES } from '../../utils/errorSender';
import { AgentResult } from '../../services/agent/types';
import logger from '../../utils/logger';
import { WebhookData } from '../../services/whatsapp/types';
import { MessageProcessor } from '../../services/whatsapp/messageProcessor';

// Import WhatsApp utilities
import { isAdminCommand } from '../../services/whatsapp/authorization';
import { handleManagementCommand } from './managementHandler';
import { sendAgentResults, AgentResult as HandlerAgentResult } from './incoming/resultHandling';
import { detectManagementCommand } from './commandDetector';
import { extractMessageText, logMessageDetails } from './messageParser';
import { isCommand } from '../../utils/commandUtils';

/**
 * Handle outgoing WhatsApp message
 * @param {WebhookData} webhookData - Webhook data from Green API
 * @param {Set} processedMessages - Shared cache for message deduplication
 */
export async function handleOutgoingMessage(webhookData: WebhookData, processedMessages: Set<string>): Promise<void> {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;

    // 1. Deduplication
    const uniqueId = MessageProcessor.getUniqueMessageId(webhookData);
    if (MessageProcessor.isDuplicate(uniqueId, processedMessages)) {
      return;
    }

    // Mark outgoing message type in cache
    const chatId = senderData.chatId;
    await conversationManager.markAsUserOutgoing(chatId, webhookData.idMessage);

    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";

    // Extract message text using centralized parser
    const messageText = extractMessageText(messageData);

    // Log edited messages
    if (messageData.typeMessage === 'editedMessage' && messageText) {
      logger.info(`✏️ Edited message detected (outgoing): "${messageText}"`);
    }

    // Enhanced logging for outgoing messages
    logMessageDetails(messageData, senderName, messageText);

    // 2. Handle Management Commands (without #, only for outgoing messages)
    if (messageText && messageText.trim() && !isCommand(messageText)) {
      const managementCommand = detectManagementCommand(messageText, {
        chatId,
        chatName,
        senderName,
        senderContactName
      });

      if (managementCommand && isAdminCommand(managementCommand.type)) {
        try {
          const originalMessageId = webhookData.idMessage;
          await handleManagementCommand(managementCommand, chatId, senderId, senderName, senderContactName, chatName, originalMessageId);
          return;
        } catch (error: any) {
          logger.error('❌ Management command error:', { error: error.message || error, stack: error.stack });
          const originalMessageId = webhookData.idMessage;
          await sendErrorToUser(chatId, error, { context: 'PROCESSING', quotedMessageId: originalMessageId });
          return;
        }
      }
    }

    // 3. Process Message for Agent (Parse, Normalize, Extract Media)
    // We pass isIncoming=false to MessageProcessor
    const result = await MessageProcessor.processMessage(webhookData, chatId, false);

    if (result.error) {
      await sendErrorToUser(chatId, result.error, { quotedMessageId: webhookData.idMessage });
      return;
    }

    // 4. Handle Agent Commands
    if (result.shouldProcess && result.normalizedInput) {
      const normalized = result.normalizedInput;
      const originalMessageId = webhookData.idMessage;

      // ═══════════════════ AGENT MODE (OUTGOING) ═══════════════════
      logger.debug(`🤖 [AGENT - OUTGOING] Processing request: "${normalized.userText}"`);

      try {
        // NOTE: User messages are no longer saved to DB to avoid duplication.
        // All messages are retrieved from Green API getChatHistory when needed.
        // Commands are saved to DB (persistent) for retry functionality.
        logger.debug(`💾 [Agent - Outgoing] Processing command (not saving to DB - using Green API history)`);

        const agentResult = await routeToAgent(normalized, chatId);
        void (agentResult as AgentResult);

        if (agentResult) {
          agentResult.originalMessageId = originalMessageId;
        }

        const quotedMessageId = (agentResult?.originalMessageId || normalized?.originalMessageId || null) as string | null;

        if (agentResult?.success) {
          const handlerResult: HandlerAgentResult = {
            ...agentResult,
            imageUrl: agentResult.imageUrl || undefined,
            videoUrl: agentResult.videoUrl || undefined,
            audioUrl: agentResult.audioUrl || undefined
          };
          await sendAgentResults(chatId, handlerResult, normalized);
          logger.info(`✅ [Agent - Outgoing] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
        } else {
          await sendErrorToUser(chatId, agentResult?.error || ERROR_MESSAGES.UNKNOWN, { quotedMessageId: quotedMessageId || undefined });
        }
        return;

      } catch (agentError: any) {
        logger.error('❌ [Agent - Outgoing] Error:', { error: agentError.message, stack: agentError.stack });
        const originalMessageId = webhookData.idMessage;
        await sendErrorToUser(chatId, agentError, { context: 'REQUEST', quotedMessageId: originalMessageId });
        return;
      }
    }

    // 5. Handle Automatic Voice Transcription (Outgoing)
    if (messageData.typeMessage === 'audioMessage') {
      logger.debug(`🎤 Detected outgoing audio message from ${senderName}`);

      const audioUrl = messageData.downloadUrl ||
        messageData.fileMessageData?.downloadUrl ||
        messageData.audioMessageData?.downloadUrl;

      if (audioUrl) {
        logger.info(`🎤 Processing outgoing voice message for transcription`);
        const { processVoiceMessageAsync } = await import('./asyncProcessors');

        processVoiceMessageAsync({
          chatId,
          senderId,
          senderName,
          audioUrl,
          originalMessageId: webhookData.idMessage
        });
        return;
      }
    }

  } catch (error: any) {
    logger.error('❌ Error handling outgoing message:', { error: error.message || error, stack: error.stack });
  }
}
