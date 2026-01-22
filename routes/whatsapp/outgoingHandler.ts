/**
 * Outgoing Message Handler
 * 
 * Handles outgoing WhatsApp messages (commands sent by you).
 * Refactored to use MessageProcessor (Phase P1-3)
 */

// Import services
import NodeCache from 'node-cache';
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
import { saveIncomingUserMessage, extractMediaMetadata } from './incoming/messageStorage';
import { detectManagementCommand } from './commandDetector';
import { extractMessageText, logMessageDetails } from './messageParser';
import { isCommand } from '../../utils/commandUtils';

/**
 * Handle outgoing WhatsApp message
 * @param {WebhookData} webhookData - Webhook data from Green API
 * @param {NodeCache} processedMessages - Shared cache for message deduplication
 */
export async function handleOutgoingMessage(webhookData: WebhookData, processedMessages: NodeCache): Promise<void> {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;

    // 1. Deduplication
    // 1. Deduplication (moved after marking check to ensure we don't skip marking valid messages if needed, 
    // but actually dedupe first is fine. The issue is marking as user outgoing blindly)

    const uniqueId = MessageProcessor.getUniqueMessageId(webhookData);
    if (MessageProcessor.isDuplicate(uniqueId, processedMessages)) {
      return;
    }

    const chatId = senderData.chatId;

    // CRITICAL FIX: Ghost Session Prevention (Level 1 - Chat Lock)
    // Check if there's an active bot operation for this chat
    // This is the primary defense - catches messages sent during active operations
    if (conversationManager.hasBotOperationActive(chatId)) {
      logger.info(`🔒 [Outgoing] Ignoring message during active bot operation for chat ${chatId}`);
      return;
    }

    // CRITICAL FIX: Ghost Session Prevention (Level 2 - Message ID Check)
    // Check if this specific message was sent by the BOT
    const isBot = await conversationManager.isBotMessage(chatId, webhookData.idMessage);

    if (isBot) {
      logger.info(`🤖 [Outgoing] Ignoring bot-generated message ${webhookData.idMessage} to prevent recursion`);
      return;
    }

    // Mark outgoing message type in cache (Only if NOT a bot message)
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
        // NOTE: User requested explicit saving of ALL messages, including outgoing ones.
        // We save them to DB to ensure comprehensive history.
        const mediaMetadata = extractMediaMetadata(webhookData);
        saveIncomingUserMessage(webhookData, normalized.userText || '', mediaMetadata)
          .catch(err => logger.error('❌ Failed to save outgoing message (background):', err));

        logger.debug(`💾 [Agent - Outgoing] Processing command & Saving to DB`);

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

    // 5. Detected Outgoing Audio - Do NOTHING
    // User requested to DISABLE automatic transcription for outgoing voice notes.
    if (messageData.typeMessage === 'audioMessage') {
      logger.debug(`🎤 Detected outgoing audio message from ${senderName} - IGNORING (No auto-transcription for outgoing)`);
      return;
    }


  } catch (error: any) {
    logger.error('❌ Error handling outgoing message:', { error: error.message || error, stack: error.stack });
  }
}
