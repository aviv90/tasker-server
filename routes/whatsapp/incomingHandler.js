/**
 * Incoming Message Handler
 * 
 * Orchestrator for handling incoming WhatsApp messages from users.
 * Refactored to use modular components (Phase P1-2)
 */

// Import services
const { sendTextMessage } = require('../../services/greenApiService');
const { sendErrorToUser, ERROR_MESSAGES } = require('../../utils/errorSender');
const conversationManager = require('../../services/conversationManager');
const { routeToAgent } = require('../../services/agentRouter');
const { isAuthorizedForMediaCreation } = require('../../services/whatsapp/authorization');
const { processVoiceMessageAsync } = require('./asyncProcessors');

// Import modular handlers
const { parseIncomingMessage, extractPrompt, logIncomingMessage } = require('./incoming/messageParsing');
const {
  isActualQuote,
  extractDirectMediaUrls,
  extractQuotedMediaUrls,
  processQuotedMessage,
  buildQuotedContext
} = require('./incoming/mediaHandling');
const { sendAgentResults } = require('./incoming/resultHandling');

/**
 * Handle incoming WhatsApp message
 * @param {Object} webhookData - Webhook data from Green API
 * @param {Set} processedMessages - Shared cache for message deduplication
 */
async function handleIncomingMessage(webhookData, processedMessages) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;

    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;

    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      console.log(`✏️ Edited message - using unique ID for reprocessing: ${messageId}`);
    }

    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      console.log(`🔄 Duplicate message detected, skipping: ${messageId}`);
      return;
    }

    // Mark message as processed
    processedMessages.add(messageId);

    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";

    // Parse incoming message
    const { messageText, type } = parseIncomingMessage(messageData);
    logIncomingMessage(messageData, senderName, messageText);

    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        // Extract the prompt (remove "# " prefix if exists)
        const basePrompt = extractPrompt(messageText);

        // Check if this is a quoted/replied message
        const quotedMessage = messageData.quotedMessage;

        // Determine if this is an actual quote or media with caption
        const actualQuote = isActualQuote(messageData, quotedMessage);

        // Extract direct media URLs first
        const directMedia = extractDirectMediaUrls(messageData);
        let finalPrompt = basePrompt;
        let hasImage = directMedia.hasImage;
        let hasVideo = directMedia.hasVideo;
        let hasAudio = directMedia.hasAudio;
        let imageUrl = directMedia.imageUrl;
        let videoUrl = directMedia.videoUrl;
        let audioUrl = directMedia.audioUrl;

        // Handle quoted message or media with caption
        if (actualQuote) {
          // Process actual quoted message
          const quotedResult = await processQuotedMessage(quotedMessage, basePrompt, chatId);

          if (quotedResult.error) {
            const originalMessageId = webhookData.idMessage;
            await sendTextMessage(chatId, quotedResult.error, originalMessageId, 1000);
            return;
          }

          finalPrompt = quotedResult.prompt;
          hasImage = quotedResult.hasImage;
          hasVideo = quotedResult.hasVideo;
          hasAudio = quotedResult.hasAudio;
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
          audioUrl = quotedResult.audioUrl;
        } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
          // This is a media message with caption, NOT an actual quote
          const quotedMedia = await extractQuotedMediaUrls(messageData, webhookData, chatId);
          hasImage = quotedMedia.hasImage;
          hasVideo = quotedMedia.hasVideo;
          hasAudio = quotedMedia.hasAudio;
          imageUrl = quotedMedia.imageUrl;
          videoUrl = quotedMedia.videoUrl;
          audioUrl = quotedMedia.audioUrl;
        }

        // Prepare quoted context for Agent (if quoted message exists)
        const quotedContext = actualQuote && quotedMessage
          ? buildQuotedContext(quotedMessage, imageUrl, videoUrl, audioUrl)
          : null;

        // Save original message ID for quoting all bot responses
        const originalMessageId = webhookData.idMessage;

        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // Pass media URLs to Agent
          videoUrl: videoUrl, // Pass media URLs to Agent
          audioUrl: audioUrl, // Pass media URLs to Agent
          quotedContext: quotedContext, // Quoted message info for Agent
          originalMessageId: originalMessageId, // Original message ID for quoting bot responses
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
            // group_creation and voice_allowed will be checked only when needed (lazy evaluation)
            group_creation: null,
            voice_allowed: null
          },
          // Pass sender data for lazy authorization checks
          senderData: { senderContactName, chatName, senderName, chatId, senderId }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling) ═══════════════════
        // All requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT] Processing request with Gemini Function Calling');

        try {
          // NOTE: User messages are no longer saved to DB to avoid duplication.
          // All messages are retrieved from Green API getChatHistory when needed.
          // Commands are saved to DB (persistent) for retry functionality.
          // Logging is handled by agentRouter and commandSaver

          // Pass originalMessageId to normalized input so it's available for saveLastCommand
          normalized.originalMessageId = originalMessageId;
          
          const agentResult = await routeToAgent(normalized, chatId);

          // Pass originalMessageId to agentResult for use in result handling
          if (agentResult) {
            agentResult.originalMessageId = originalMessageId;
          }

          if (agentResult.success) {
            // Send all results (text, media, polls, locations)
            await sendAgentResults(chatId, agentResult, normalized);
          } else {
            await sendErrorToUser(chatId, agentResult.error || ERROR_MESSAGES.UNKNOWN, { quotedMessageId: originalMessageId });
          }
          return; // Exit early - no need for regular flow

        } catch (agentError) {
          console.error('❌ [Agent] Error:', agentError);
          await sendErrorToUser(chatId, agentError, { context: 'REQUEST', quotedMessageId: originalMessageId });
          return;
        }

      } catch (error) {
        console.error('❌ Command execution error:', error.message || error);
        const originalMessageId = webhookData.idMessage;
        await sendErrorToUser(chatId, error, { context: 'EXECUTION', quotedMessageId: originalMessageId });
      }
      return; // Exit early after handling # commands
    }

    // Handle automatic voice transcription for authorized users
    if (messageData.typeMessage === 'audioMessage') {
      console.log(`🎤 Detected audio message from ${senderName}`);
      const audioUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.audioMessageData?.downloadUrl;
      
      console.log(`🔍 Audio URL: ${audioUrl ? 'found' : 'NOT FOUND'}`);
      
      if (audioUrl) {
        // Check if user is authorized for automatic transcription
        const senderDataForAuth = {
          chatId,
          senderContactName,
          chatName,
          senderName,
          senderId
        };
        console.log(`🔍 Checking authorization for: ${JSON.stringify(senderDataForAuth)}`);
        
        const isAuthorized = await conversationManager.isAuthorizedForVoiceTranscription(senderDataForAuth);
        console.log(`🔐 Authorization result: ${isAuthorized}`);

        if (isAuthorized) {
          console.log(`🎤 Authorized user ${senderName} sent voice message - processing automatically`);
          processVoiceMessageAsync({
            chatId,
            senderId,
            senderName,
            audioUrl,
            originalMessageId: webhookData.idMessage
          });
          return; // Exit early after processing voice message
        } else {
          console.log(`🚫 User ${senderName} is not authorized for automatic voice transcription`);
        }
      } else {
        console.log(`❌ Audio message detected but no URL found`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}

module.exports = {
  handleIncomingMessage
};
