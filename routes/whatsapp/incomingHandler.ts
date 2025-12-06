/**
 * Incoming Message Handler
 * 
 * Orchestrator for handling incoming WhatsApp messages from users.
 * Refactored to use MessageProcessor (Phase P1-3)
 */

// Import services
import { sendErrorToUser, ERROR_MESSAGES } from '../../utils/errorSender';
// import { sendTextMessage } from '../../services/greenApiService';
import conversationManager from '../../services/conversationManager';
import logger from '../../utils/logger';
import { routeToAgent, AgentResult as RouterAgentResult } from '../../services/agentRouter';
import { processVoiceMessageAsync } from './asyncProcessors';
import { WebhookData } from '../../services/whatsapp/types';
import { MessageProcessor } from '../../services/whatsapp/messageProcessor';
import { AgentOrchestrator } from '../../services/agent/agentOrchestrator';
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

      // PERFORMANCE OPTIMIZATION: Send immediate Ack/Thinking indicator
      // REMOVED: User requested to remove this as it conflicts with Agent Acks
      // The Agent handles its own Acks via ackUtils

      /* 
      const sendAckPromise = (async () => {
        try {
          // Send "Thinking..." with small typing time (not 0) to ensure delivery
          // Using a subtle emoji to indicate processing
          logger.debug(`🤖 Sending immediate Ack to ${chatId}`);
          await sendTextMessage(chatId, 'חושב... 🤖', undefined, 1000);
        } catch (err) {
          logger.warn('⚠️ Failed to send Ack:', err);
        }
      })();
      */

      // Save user message to DB cache with metadata (FIRE AND FORGET / PARALLEL)
      const mediaMetadata = extractMediaMetadata(webhookData);
      const combinedMetadata: Record<string, unknown> = { ...mediaMetadata };
      if (normalized.imageUrl) combinedMetadata.imageUrl = normalized.imageUrl;
      if (normalized.videoUrl) combinedMetadata.videoUrl = normalized.videoUrl;
      if (normalized.audioUrl) combinedMetadata.audioUrl = normalized.audioUrl;

      // Don't await DB write, let it run in background
      const saveMessagePromise = saveIncomingUserMessage(webhookData, result.messageText || '', combinedMetadata)
        .catch(err => logger.error('❌ Failed to save incoming message (background):', err));

      // ═══════════════════ AGENT MODE ═══════════════════
      logger.debug('🤖 [AGENT] Processing request with Gemini Function Calling');

      try {
        // Wait for Ack to be sent (it's fast) to ensure order, but don't block too long
        // Actually, we don't need to wait for Ack, it can happen in parallel with agent routing
        // But we DO want to ensure Ack is sent before the Agent might reply (rare race condition)
        // Let's just let it race. The Agent takes seconds, Ack takes milliseconds.

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

      // Ensure promises complete (optional, mostly for testing/clean exit)
      // In production, we don't strictly need to await them here if we handle errors
      // But to be safe against process termination:
      await Promise.allSettled([saveMessagePromise]);

      return;
    }

    // 4. Handle Voice Messages (Automatic Transcription)
    if (messageData.typeMessage === 'audioMessage') {
      logger.debug(`🎤 Detected audio message from ${senderName}`);

      // Save audio message to DB cache (FIRE AND FORGET)
      const mediaMetadata = extractMediaMetadata(webhookData);
      saveIncomingUserMessage(webhookData, result.messageText || '', mediaMetadata)
        .catch(err => logger.error('❌ Failed to save audio message (background):', err));

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

    // 5. Save other messages to history (FIRE AND FORGET)
    if (!result.isCommand) {
      const mediaMetadata = extractMediaMetadata(webhookData);
      saveIncomingUserMessage(webhookData, result.messageText || '', mediaMetadata)
        .catch(err => logger.error('❌ Failed to save message (background):', err));
    }

  } catch (error: any) {
    logger.error('❌ Error handling incoming message:', { error: error.message || error, stack: error.stack });
  }
}
