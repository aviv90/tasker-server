/**
 * Incoming Message Handler
 * 
 * Orchestrator for handling incoming WhatsApp messages from users.
 * Refactored to use modular components (Phase P1-2)
 */

// Import services
const { sendTextMessage } = require('../../services/greenApiService');
const conversationManager = require('../../services/conversationManager');
const { routeToAgent } = require('../../services/agentRouter');
const { isAuthorizedForMediaCreation } = require('../../services/whatsapp/authorization');
const { isAuthorizedForVoiceTranscription } = require('../../services/conversationManager');
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
            await sendTextMessage(chatId, quotedResult.error);
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

        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // Pass media URLs to Agent
          videoUrl: videoUrl, // Pass media URLs to Agent
          audioUrl: audioUrl, // Pass media URLs to Agent
          quotedContext: quotedContext, // Quoted message info for Agent
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
          // CRITICAL: Save user message to conversation history BEFORE processing
          // This ensures continuity and allows the bot to see the full conversation
          await conversationManager.addMessage(chatId, 'user', normalized.userText);
          console.log(`💾 [Agent] Saved user message to conversation history`);

          const agentResult = await routeToAgent(normalized, chatId);

          if (agentResult.success) {
            // Send all results (text, media, polls, locations)
            await sendAgentResults(chatId, agentResult, normalized);
          } else {
            await sendTextMessage(chatId, `❌ שגיאה: ${agentResult.error || 'לא הצלחתי לעבד את הבקשה'}`);
          }
          return; // Exit early - no need for regular flow

        } catch (agentError) {
          console.error('❌ [Agent] Error:', agentError);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${agentError.message}`);
          return;
        }

      } catch (error) {
        console.error('❌ Command execution error:', error.message || error);
        await sendTextMessage(chatId, `❌ שגיאה בביצוע הפקודה: ${error.message || error}`);
      }
      return; // Exit early after handling # commands
    }

    // Handle automatic voice transcription for authorized users
    if (messageData.typeMessage === 'audioMessage') {
      const audioUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.audioMessageData?.downloadUrl;
      
      if (audioUrl) {
        // Check if user is authorized for automatic transcription
        const isAuthorized = await isAuthorizedForVoiceTranscription({
          chatId,
          senderContactName,
          chatName,
          senderName,
          senderId
        });

        if (isAuthorized) {
          console.log(`🎤 Authorized user ${senderName} sent voice message - processing automatically`);
          processVoiceMessageAsync({
            chatId,
            senderId,
            senderName,
            audioUrl
          });
          return; // Exit early after processing voice message
        } else {
          console.log(`🚫 User ${senderName} is not authorized for automatic voice transcription`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}

module.exports = {
  handleIncomingMessage
};
