const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile, getChatHistory, getMessage, sendPoll, sendLocation } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const locationService = require('../services/locationService');
const conversationManager = require('../services/conversationManager');
const { routeToAgent } = require('../services/agentRouter');
const { executeAgentQuery } = require('../services/agentService');
const authStore = require('../store/authStore');
const groupAuthStore = require('../store/groupAuthStore');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import WhatsApp service constants
const {
  IMAGE_EDIT_PATTERN,
  IMAGE_IMPLICIT_EDIT_PATTERN,
  TTS_KEYWORDS_PATTERN,
  TRANSLATE_KEYWORDS_PATTERN,
  JUST_TRANSCRIPTION_PATTERN,
  MIN_DURATION_FOR_CLONING,
  ELEVENLABS_TTS_DEFAULTS,
  TRANSCRIPTION_DEFAULTS,
  CHAT_HISTORY_LIMIT
} = require('../services/whatsapp/constants');

// Import WhatsApp utility functions
const {
  cleanAgentText,
  cleanForLogging,
  isLandLocation,
  formatChatHistoryForContext
} = require('../services/whatsapp/utils');

// Import WhatsApp authorization functions
const {
  isAuthorizedForMediaCreation,
  isAuthorizedForGroupCreation,
  requiresMediaAuthorization,
  isAdminCommand,
  sendUnauthorizedMessage
} = require('../services/whatsapp/authorization');

// Import WhatsApp media handlers
const {
  handleImageEdit,
  handleImageToVideo,
  handleVideoToVideo,
  handleVoiceMessage
} = require('../services/whatsapp/mediaHandlers');

// Import WhatsApp messaging functions
const { sendAck } = require('../services/whatsapp/messaging');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Voice transcription and media authorization are managed through PostgreSQL database
// All other constants are now imported from services/whatsapp/constants.js (SSOT)
// Utility functions are now imported from services/whatsapp/utils.js (SSOT)

/**
 * Save last executed command for retry functionality (persisted to DB)
 * @param {string} chatId - Chat ID
 * @param {Object} decision - Router decision object
 * @param {Object} options - Additional options (imageUrl, videoUrl, normalized)
 */
async function saveLastCommand(chatId, decision, options = {}) {
  // Don't save retry, clarification, or denial commands
  if (['retry_last_command', 'ask_clarification', 'deny_unauthorized'].includes(decision.tool)) {
    return;
  }
  
  // Save to database for persistence across restarts
  await conversationManager.saveLastCommand(chatId, decision.tool, decision.args, {
    normalized: options.normalized,
    imageUrl: options.imageUrl,
    videoUrl: options.videoUrl,
    audioUrl: options.audioUrl
  });
}

// Provider override helper for retry (supports Hebrew/English variants)
function applyProviderOverride(additionalInstructions, currentDecision, context = {}) {
  if (!additionalInstructions || !additionalInstructions.trim()) return null;

  const text = additionalInstructions.toLowerCase();
  const wantsOpenAI = /openai|אוופנאי|אופן איי/i.test(additionalInstructions);
  const wantsGemini = /gemini|ג׳מיני|גמיני|גימיני/i.test(additionalInstructions);
  const wantsGrok   = /grok|גרוק/i.test(additionalInstructions);
  const wantsSora   = /sora|סורה/i.test(additionalInstructions);
  const wantsVeo    = /veo\s*3?(?:\.\d+)?|veo|ויו|וֶאו/i.test(additionalInstructions);
  const wantsKling  = /kling|קלינג/i.test(additionalInstructions);

  // Sora model variants
  const wantsSoraPro = /sora\s*2\s*pro|sora-2-pro|סורה\s*2\s*פרו|סורה-?2-?פרו/i.test(additionalInstructions);
  const wantsSora2   = /sora\s*2\b|sora-2\b|סורה\s*2|סורה-?2/i.test(additionalInstructions);

  // Decide new tool by media context and provider intent
  const { hasImage, hasVideo } = context;
  const originalTool = currentDecision?.tool || '';

  const cloneArgs = (args) => ({ ...(args || {}) });

  // Image-to-video intents with image present
  if (hasImage && (wantsSora || wantsVeo || wantsKling)) {
    if (wantsSora) {
      return {
        tool: 'sora_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')), service: 'openai' },
        reason: 'Retry override → Sora image-to-video'
      };
    }
    if (wantsVeo) {
      return {
        tool: 'veo3_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'veo-3', service: 'gemini' },
        reason: 'Retry override → Veo image-to-video'
      };
    }
    if (wantsKling) {
      return {
        tool: 'kling_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'kling-1', service: 'kling' },
        reason: 'Retry override → Kling image-to-video'
      };
    }
  }

  // Text-to-image
  if (!hasImage && /image|תמונה|צייר|ציור|צור.*תמונה|תייצר.*תמונה|תייצרי.*תמונה/i.test(additionalInstructions)) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Generic provider swap preserving tool family
  
  // Image editing
  if (originalTool.endsWith('_image_edit') || originalTool === 'image_edit') {
    if (wantsOpenAI) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → OpenAI image edit' };
    if (wantsGemini) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Gemini image edit' };
  }
  
  // Video editing
  if (originalTool.endsWith('_video_edit') || originalTool === 'video_to_video') {
    if (wantsSora) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → Sora video' };
    if (wantsVeo) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Veo video' };
    if (wantsKling) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'kling' }, reason: 'Retry override → Kling video' };
  }
  
  // Image generation (not editing)
  if (originalTool.endsWith('_image') && !originalTool.endsWith('_image_edit')) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Image-to-video
  if (originalTool.endsWith('_image_to_video')) {
    if (wantsSora)   return { tool: 'sora_image_to_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora image-to-video' };
    if (wantsVeo)    return { tool: 'veo3_image_to_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo image-to-video' };
    if (wantsKling)  return { tool: 'kling_image_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling image-to-video' };
  }
  
  // Text-to-video
  if (originalTool.endsWith('_video') || originalTool === 'kling_text_to_video') {
    if (wantsSora)   return { tool: 'sora_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora text-to-video' };
    if (wantsVeo)    return { tool: 'veo3_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo text-to-video' };
    if (wantsKling)  return { tool: 'kling_text_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling text-to-video' };
  }

  // Chat provider swap
  if (originalTool.endsWith('_chat')) {
    if (wantsOpenAI) return { tool: 'openai_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI chat' };
    if (wantsGemini) return { tool: 'gemini_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini chat' };
    if (wantsGrok)   return { tool: 'grok_chat',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok chat' };
  }

  return null;
}

// formatChatHistoryForContext is now imported from services/whatsapp/utils.js

// Authorization functions moved to services/whatsapp/authorization.js
// Now imported above instead of defined locally

// Clean up old processed messages cache every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
  // Last commands are now persisted in DB, no need to clean up in-memory cache
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
// sendAck function is now imported from services/whatsapp/messaging.js

/**
 * WhatsApp Green API Integration Routes
 */

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 */
router.post('/webhook', async (req, res) => {
  try {
    // Security check: Verify webhook token
    const token = req.headers['authorization']?.replace('Bearer ', '') ||
                  req.query.token || 
                  req.body.token;
    
    const expectedToken = process.env.GREEN_API_WEBHOOK_TOKEN;
    
    if (!expectedToken) {
      console.error('❌ GREEN_API_WEBHOOK_TOKEN not configured in environment');
      return res.status(500).json({ error: 'Webhook token not configured' });
    }
    
    if (token !== expectedToken) {
      console.error('❌ Unauthorized webhook request - invalid token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const webhookData = req.body;
    
    // Log full webhook payload for debugging
    console.log(`📱 Green API webhook: ${webhookData.typeWebhook || 'unknown'} | Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);
    
    // TEMPORARY DEBUG: Log full payload to see what we're missing
    if (webhookData.messageData?.typeMessage) {
      console.log('🔍 FULL WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    }

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
      });
    } else if (webhookData.typeWebhook === 'outgoingMessageReceived') {
      // Process outgoing messages (commands sent by you)
      handleOutgoingMessage(webhookData).catch(error => {
        console.error('❌ Error in async outgoing message processing:', error.message || error);
      });
    }

    // Return 200 OK immediately
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Error processing webhook:', error.message || error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Handle quoted (replied) messages
 * Merges quoted message content with current message prompt
 */
async function handleQuotedMessage(quotedMessage, currentPrompt, chatId) {
  try {
    console.log(`🔗 Processing quoted message: ${quotedMessage.stanzaId}`);
    
    // Extract quoted message type and content
    const quotedType = quotedMessage.typeMessage;
    
    // For text messages, combine both texts
    if (quotedType === 'textMessage' || quotedType === 'extendedTextMessage') {
      const quotedText = quotedMessage.textMessage || '';
      const combinedPrompt = `${quotedText}\n\n${currentPrompt}`;
      console.log(`📝 Combined text prompt: ${combinedPrompt.substring(0, 100)}...`);
      return {
        hasImage: false,
        hasVideo: false,
        prompt: combinedPrompt,
        imageUrl: null,
        videoUrl: null
      };
    }
    
    // For media messages (image/video/audio/sticker), try to get downloadUrl
    if (quotedType === 'imageMessage' || quotedType === 'videoMessage' || quotedType === 'audioMessage' || quotedType === 'stickerMessage') {
      console.log(`📸 Quoted ${quotedType}, attempting to extract media URL...`);
      
      let downloadUrl = null;
      
      // STEP 1: Try to get downloadUrl directly from quotedMessage (fastest path)
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.imageMessageData?.downloadUrl ||
                     quotedMessage.stickerMessageData?.downloadUrl;
      } else if (quotedType === 'videoMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.videoMessageData?.downloadUrl;
      } else if (quotedType === 'audioMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.audioMessageData?.downloadUrl;
      }
      
      // STEP 2: If downloadUrl is empty or not found, try getMessage API
      if (!downloadUrl || downloadUrl === '') {
        console.log(`📨 Fetching message ${quotedMessage.stanzaId} from chat ${chatId}`);
        try {
          const originalMessage = await getMessage(chatId, quotedMessage.stanzaId);
          
          if (originalMessage) {
            if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.imageMessageData?.downloadUrl ||
                           originalMessage.stickerMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.imageMessageData?.downloadUrl ||
                           originalMessage.messageData?.stickerMessageData?.downloadUrl;
            } else if (quotedType === 'videoMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.videoMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.videoMessageData?.downloadUrl;
            } else if (quotedType === 'audioMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.audioMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.audioMessageData?.downloadUrl;
            }
            
            if (downloadUrl) {
              console.log(`✅ Found downloadUrl via getMessage`);
            }
          }
        } catch (getMessageError) {
          console.log(`⚠️ getMessage failed: ${getMessageError.message}`);
          // Continue to STEP 3 - try thumbnail
        }
      }
      
      // STEP 3: If still no downloadUrl and there's a thumbnail, use it (for images only)
      if ((!downloadUrl || downloadUrl === '') && (quotedType === 'imageMessage' || quotedType === 'stickerMessage')) {
        const thumbnail = quotedMessage.jpegThumbnail || quotedMessage.thumbnail;
        if (thumbnail) {
          console.log(`🖼️ No downloadUrl found, converting jpegThumbnail to temporary image...`);
          try {
            // Decode base64 thumbnail to buffer
            const thumbnailBuffer = Buffer.from(thumbnail, 'base64');
            // Save to temporary file
            const tempFileName = `quoted_image_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);
            fs.writeFileSync(tempFilePath, thumbnailBuffer);
            
            // Move to public/tmp for web access
            const publicTmpDir = path.join(__dirname, '..', 'public', 'tmp');
            if (!fs.existsSync(publicTmpDir)) {
              fs.mkdirSync(publicTmpDir, { recursive: true });
            }
            const publicFilePath = path.join(publicTmpDir, tempFileName);
            fs.renameSync(tempFilePath, publicFilePath);
            
            // Generate public URL
            downloadUrl = getStaticFileUrl(`/tmp/${tempFileName}`);
            console.log(`✅ Created temporary image from thumbnail: ${downloadUrl}`);
          } catch (thumbnailError) {
            console.error(`❌ Failed to process thumbnail: ${thumbnailError.message}`);
          }
        }
      }
      
      // STEP 4: If still no downloadUrl, throw error
      if (!downloadUrl || downloadUrl === '') {
        console.log(`❌ No downloadUrl or thumbnail found for quoted ${quotedType}`);
        throw new Error(`לא הצלחתי לגשת ל${quotedType === 'imageMessage' ? 'תמונה' : quotedType === 'videoMessage' ? 'וידאו' : 'מדיה'} המצוטטת. ייתכן שהיא נמחקה או ממספר אחר.`);
      }
      
      console.log(`✅ Successfully extracted downloadUrl for quoted ${quotedType}`);
      
      // Extract caption from media message (if exists)
      // Caption can be directly on quotedMessage or nested in fileMessageData/imageMessageData
      let originalCaption = null;
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.imageMessageData?.caption;
      } else if (quotedType === 'videoMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.videoMessageData?.caption;
      }
      
      console.log(`📝 [handleQuotedMessage] Original caption found: "${originalCaption}"`);
      console.log(`📝 [handleQuotedMessage] Current prompt (additional): "${currentPrompt}"`);
      
      // If there's a caption with a command (starts with #), merge it with additional instructions
      let finalPrompt = currentPrompt;
      if (originalCaption && /^#\s+/.test(originalCaption.trim())) {
        // Remove # prefix from original caption
        const cleanCaption = originalCaption.trim().replace(/^#\s+/, '');
        // If there are additional instructions, append them
        if (currentPrompt && currentPrompt.trim()) {
          finalPrompt = `${cleanCaption}, ${currentPrompt}`;
          console.log(`🔗 Merged caption with additional instructions: "${finalPrompt.substring(0, 100)}..."`);
        } else {
          finalPrompt = cleanCaption;
        }
      }
      
      // Return the URL directly - let the handler functions download when needed
      return {
        hasImage: quotedType === 'imageMessage' || quotedType === 'stickerMessage',
        hasVideo: quotedType === 'videoMessage',
        hasAudio: quotedType === 'audioMessage',
        prompt: finalPrompt, // Use merged prompt (original caption + additional instructions)
        imageUrl: (quotedType === 'imageMessage' || quotedType === 'stickerMessage') ? downloadUrl : null,
        videoUrl: quotedType === 'videoMessage' ? downloadUrl : null,
        audioUrl: quotedType === 'audioMessage' ? downloadUrl : null
      };
    }
    
    // For other types, just use current prompt
    console.log(`⚠️ Unsupported quoted message type: ${quotedType}, using current prompt only`);
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };
    
  } catch (error) {
    console.error('❌ Error handling quoted message:', error.message);
    
    // If it's a downloadUrl error for bot's own messages, return a clear error
    if (error.message.includes('Cannot process media from bot')) {
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null,
        error: '⚠️ לא יכול לעבד תמונות/וידאו/אודיו שהבוט שלח. שלח את המדיה מחדש או צטט הודעה ממשתמש אחר.'
      };
    }
    
    // If it's our custom error message (inaccessible media), return it to user
    if (error.message.includes('לא הצלחתי לגשת ל')) {
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null,
        error: `⚠️ ${error.message}`
      };
    }
    
    // For other errors, fallback to current prompt only (don't show error to user)
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };
  }
}
/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(webhookData) {
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
    
    // Handle text messages (regular, extended, quoted, and edited)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    } else if (messageData.typeMessage === 'quotedMessage') {
      // When replying to a message, the text is in extendedTextMessageData
      messageText = messageData.extendedTextMessageData?.text;
      // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      if (!messageText) {
        messageText = messageData.fileMessageData?.caption || 
                     messageData.imageMessageData?.caption || 
                     messageData.videoMessageData?.caption ||
                     messageData.stickerMessageData?.caption;
      }
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected: "${messageText}"`);
    } else if (messageData.typeMessage === 'imageMessage') {
      // 🆕 Extract caption from image messages
      messageText = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    } else if (messageData.typeMessage === 'videoMessage') {
      // 🆕 Extract caption from video messages
      messageText = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    } else if (messageData.typeMessage === 'stickerMessage') {
      // 🆕 Extract caption from sticker messages (rare but possible)
      messageText = messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption;
    }
    
    // Enhanced logging for incoming messages
    console.log(`📱 Incoming from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'stickerMessage') {
      const caption = messageData.fileMessageData?.caption;
      console.log(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
    }
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
      }
      if (messageData.quotedMessage.caption) {
        console.log(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
      }
    }
    
    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        // Only process quotedMessage if typeMessage is 'quotedMessage' (actual reply)
        // Don't process if it's just extendedTextMessage with leftover quotedMessage metadata
        const quotedMessage = messageData.quotedMessage;
        
        // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
        // Check if this is a REAL quote (reply) or just a media message with caption
        // Logic:
        // - If caption exists AND matches/starts with the text → It's a NEW media message (not a quote)
        // - If caption doesn't exist OR doesn't match → It's a REAL quote
        const quotedCaption = quotedMessage?.caption;
        const extractedText = messageData.extendedTextMessageData?.text; // Don't shadow messageText!
        // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
        const captionMatchesText = quotedCaption && extractedText && 
                                  (quotedCaption === extractedText || 
                                   quotedCaption.startsWith(extractedText) ||
                                   extractedText.startsWith(quotedCaption));
        
        const isActualQuote = messageData.typeMessage === 'quotedMessage' && 
                             quotedMessage && 
                             quotedMessage.stanzaId &&
                             extractedText &&
                             !captionMatchesText; // It's a quote if text doesn't match caption
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        let imageUrl = null;
        let videoUrl = null;
        let audioUrl = null;
        
        // 🆕 Extract URLs for direct media messages (imageMessage/videoMessage/audioMessage)
        if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage') {
          imageUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.imageMessageData?.downloadUrl ||
                    messageData.stickerMessageData?.downloadUrl;
          console.log(`📸 Incoming: Direct image message, downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'videoMessage') {
          videoUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.videoMessageData?.downloadUrl;
          console.log(`🎥 Incoming: Direct video message, downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'audioMessage') {
          audioUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.audioMessageData?.downloadUrl;
          console.log(`🎵 Incoming: Direct audio message, downloadUrl: ${audioUrl ? 'found' : 'NOT FOUND'}`);
        }
        
        if (isActualQuote) {
          console.log(`🔗 Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
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
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself
          console.log(`📸 Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
            hasImage = true;
            // Try all possible locations for downloadUrl
            imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!imageUrl) {
              console.log('⚠️ downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                imageUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.imageMessageData?.downloadUrl;
                console.log(`✅ downloadUrl fetched from getMessage: ${imageUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`📸 Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
          } else if (quotedMessage.typeMessage === 'videoMessage') {
            hasVideo = true;
            videoUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.videoMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.videoMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!videoUrl) {
              console.log('⚠️ Video downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                videoUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.videoMessageData?.downloadUrl;
                console.log(`✅ Video downloadUrl fetched from getMessage: ${videoUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch video downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`🎥 Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
          }
        }
        
        // Prepare quoted context for Agent (if quoted message exists)
        let quotedContext = null;
        if (isActualQuote && quotedMessage) {
          quotedContext = {
            type: quotedMessage.typeMessage || 'unknown',
            text: quotedMessage.textMessage || quotedMessage.caption || '',
            hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
            hasVideo: quotedMessage.typeMessage === 'videoMessage',
            hasAudio: quotedMessage.typeMessage === 'audioMessage',
            imageUrl: imageUrl || null,
            videoUrl: videoUrl || null,
            audioUrl: audioUrl || null, // Include audio URL if available
            stanzaId: quotedMessage.stanzaId
          };
        }
        
        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // 🆕 Pass media URLs to Agent
          videoUrl: videoUrl, // 🆕 Pass media URLs to Agent
          audioUrl: audioUrl, // 🆕 Pass media URLs to Agent
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
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
        
        const { routeToAgent } = require('../services/agentRouter');
        
        try {
            // 🧠 CRITICAL: Save user message to conversation history BEFORE processing
            // This ensures continuity and allows the bot to see the full conversation
            await conversationManager.addMessage(chatId, 'user', normalized.userText);
            console.log(`💾 [Agent] Saved user message to conversation history`);
            
            const agentResult = await routeToAgent(normalized, chatId);
            
            if (agentResult.success) {
              // 🚀 CRITICAL: For multi-step, results are sent immediately after each step in agentService
              // If alreadySent is true, skip sending here to avoid duplicates
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`✅ [Multi-step] Results already sent immediately after each step - skipping duplicate sending`);
                console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
                return; // Exit early - everything already sent
              }
              
              // Send any generated media (image/video/audio/poll) with captions
              let mediaSent = false;
              
              // Debug: Check multi-step status
              console.log(`🔍 [Debug] multiStep: ${agentResult.multiStep}, text length: ${agentResult.text?.length || 0}, hasImage: ${!!agentResult.imageUrl}`);
              
              // Multi-step: Send text FIRST, then media
              if (agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
                let cleanText = agentResult.text
                  .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs (image URLs should not be in text)
                  .replace(/\[image\]/gi, '')
                  .replace(/\[video\]/gi, '')
                  .replace(/\[audio\]/gi, '')
                  .replace(/\[תמונה\]/gi, '')
                  .replace(/\[וידאו\]/gi, '')
                  .replace(/\[אודיו\]/gi, '')
                  .trim();
                if (cleanText) {
                  await sendTextMessage(chatId, cleanText);
                  console.log(`📤 [Multi-step] Text sent first (${cleanText.length} chars)`);
                } else {
                  console.warn(`⚠️ [Multi-step] Text exists but cleanText is empty`);
                }
              } else {
                console.warn(`⚠️ [Multi-step] Text not sent - multiStep: ${agentResult.multiStep}, text: ${!!agentResult.text}, trimmed: ${!!agentResult.text?.trim()}`);
              }
              
              if (agentResult.imageUrl) {
                // CRITICAL: For multi-step with alreadySent=true, image was already sent in agentService
                // Only send here if NOT multi-step or if alreadySent is false
                if (agentResult.multiStep && agentResult.alreadySent) {
                  console.log(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
                } else {
                  console.log(`📸 [Agent] Sending generated image: ${agentResult.imageUrl}`);
                  
                  let caption = '';
                  
                  // Multi-step: Use imageCaption if exists (LLM should return it in correct language)
                  if (agentResult.multiStep) {
                    // For multi-step, use imageCaption if it exists
                    // LLM is responsible for returning caption in correct language
                    caption = (agentResult.imageCaption && agentResult.imageCaption.trim()) || '';
                    if (caption) {
                      console.log(`📤 [Multi-step] Image sent with caption: "${caption.substring(0, 50)}..."`);
                    } else {
                      console.log(`📤 [Multi-step] Image sent after text (no caption)`);
                    }
                  } else {
                    // Single-step: Images support captions - use them!
                    // CRITICAL: If multiple tools were used, don't mix outputs!
                    // Only use imageCaption (specific) or text if it's the ONLY output
                    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);
                    
                    if (multipleTools) {
                      // Multiple tools → use ONLY imageCaption (specific to this image)
                      caption = agentResult.imageCaption || '';
                      console.log(`ℹ️ Multiple tools detected - using imageCaption only to avoid mixing outputs`);
                    } else {
                      // Single tool → can use general text as fallback
                      caption = agentResult.imageCaption || agentResult.text || '';
                    }
                    
                    // Clean the caption: remove URLs, markdown links, and technical markers
                    caption = caption
                      .replace(/\[.*?\]\(https?:\/\/[^\)]+\)/g, '') // Remove markdown links
                      .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
                      .replace(/\[image\]/gi, '') // Remove [image] markers
                      .replace(/\[video\]/gi, '') // Remove [video] markers
                      .replace(/\[audio\]/gi, '') // Remove [audio] markers
                      .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                      .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                      .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                      .replace(/התמונה.*?נוצרה בהצלחה!/gi, '') // Remove success messages
                      .replace(/הוידאו.*?נוצר בהצלחה!/gi, '')
                      .replace(/✅/g, '')
                      .trim();
                  }
                  
                  await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption);
                  mediaSent = true;
                }
              }
              
              // For multi-step, video is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping video send - already sent in multi-step`);
              } else if (agentResult.videoUrl) {
                console.log(`🎬 [Agent] Sending generated video: ${agentResult.videoUrl}`);
                // Videos don't support captions well - send as file, text separately
                await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '');
                mediaSent = true;
                
                // If there's meaningful text (description/revised prompt), send it separately
                if (agentResult.text && agentResult.text.trim()) {
                  let videoDescription = agentResult.text
                    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs
                    .replace(/\[image\]/gi, '') // Remove [image] markers
                    .replace(/\[video\]/gi, '') // Remove [video] markers
                    .replace(/\[audio\]/gi, '') // Remove [audio] markers
                    .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                    .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                    .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                    .trim();
                  if (videoDescription && videoDescription.length > 2) {
                    await sendTextMessage(chatId, videoDescription);
                  }
                }
              }
              
              // For multi-step, audio is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping audio send - already sent in multi-step`);
              } else if (agentResult.audioUrl) {
                console.log(`🎵 [Agent] Sending generated audio: ${agentResult.audioUrl}`);
                // Audio doesn't support captions - send as file only
                const fullAudioUrl = agentResult.audioUrl.startsWith('http') 
                  ? agentResult.audioUrl 
                  : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
                mediaSent = true;
                
                // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
                // No need for textual descriptions like "הנה הקלטה קולית..."
              }
              
              // For multi-step, poll is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping poll send - already sent in multi-step`);
              } else if (agentResult.poll) {
                console.log(`📊 [Agent] Sending poll: ${agentResult.poll.question}`);
                // Convert options to Green API format
                const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
                await sendPoll(chatId, agentResult.poll.question, pollOptions, false);
                mediaSent = true;
              }
              
              // For multi-step, location is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping location send - already sent in multi-step`);
              } else if (agentResult.latitude && agentResult.longitude) {
                console.log(`📍 [Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
                await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '');
                mediaSent = true;
                // Send location info as separate text message
                if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
                  await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`);
                }
              }
              
              // Single-step: If no media was sent and it's not multi-step, send text response (אם יש)
              // Multi-step text was already sent above
              if (!agentResult.multiStep && !mediaSent && agentResult.text && agentResult.text.trim()) {
                const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);
                
                if (!multipleTools) {
                  // Single tool → safe to send text
                  const cleanText = cleanAgentText(agentResult.text);
                  if (cleanText) {
                    await sendTextMessage(chatId, cleanText);
                  }
                } else {
                  console.log(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
                }
              }
              
              // 🔁 פוסט-עיבוד: אם המשתמש ביקש גם טקסט וגם תמונה, אבל האג'נט החזיר רק טקסט – ניצור תמונה משלימה
              try {
                const userText = normalized.userText || '';
                
                // זיהוי בקשה לטקסט (ספר/כתוב/תאר/תגיד/אמור/describe/tell/write)
                const wantsText = /(ספר|תספר|כתוב|תכתוב|תכתבי|תכתבו|תאר|תארי|תארו|הסבר|תסביר|תסבירי|תגיד|תגידי|תאמר|תאמרי|ברכה|בדיחה|סיפור|טקסט|describe|tell|write|say|story|joke|text)/i.test(userText);
                
                // זיהוי בקשה לתמונה (תמונה/ציור/צייר/איור/image/picture/draw)
                const wantsImage = /(תמונה|תמונות|ציור|ציורית|צייר|ציירי|ציירו|תצייר|תציירי|תציירו|אייר|איירי|איירו|איור|איורים|image|images|picture|pictures|photo|photos|drawing|draw|illustration|art|poster|thumbnail)/i.test(userText);
                
                const imageAlreadyGenerated = !!agentResult.imageUrl;
                const hasTextResponse = agentResult.text && agentResult.text.trim().length > 0;
                
                if (wantsText && wantsImage && !imageAlreadyGenerated && hasTextResponse) {
                  console.log('🎯 [Agent Post] Multi-step text+image request detected, but no image was generated. Creating image from text response...');
                  
                  // נבנה פרומפט לתמונה שמבוססת על הטקסט שהבוט כבר החזיר (למשל בדיחה)
                  const baseText = agentResult.text.trim();
                  const imagePrompt = `צור תמונה שממחישה בצורה ברורה ומצחיקה את הטקסט הבא (אל תכתוב טקסט בתמונה): """${baseText}"""`;
                  
                  // קריאה שנייה לאג'נט – הפעם בקשת תמונה פשוטה בלבד
                  const imageResult = await executeAgentQuery(imagePrompt, chatId, {
                    input: {
                      ...normalized,
                      userText: imagePrompt
                    },
                    lastCommand: null,
                    maxIterations: 4
                  });
                  
                  if (imageResult && imageResult.success && imageResult.imageUrl) {
                    console.log(`📸 [Agent Post] Sending complementary image generated from text: ${imageResult.imageUrl}`);
                    
                    const caption = (imageResult.imageCaption || '').trim();
                    await sendFileByUrl(
                      chatId,
                      imageResult.imageUrl,
                      `agent_image_${Date.now()}.png`,
                      caption
                    );
                  } else {
                    console.warn('⚠️ [Agent Post] Failed to generate complementary image for text+image request');
                  }
                }
              } catch (postError) {
                console.error('❌ [Agent Post] Error while handling text+image multi-step fallback:', postError.message);
              }
              
              // 🧠 CRITICAL: Save bot's response to conversation history for continuity!
              // This allows the bot to see its own previous responses in future requests
              if (agentResult.text && agentResult.text.trim()) {
                await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
                console.log(`💾 [Agent] Saved bot response to conversation history`);
              }
              
              console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
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
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}
/**
 * Handle outgoing WhatsApp message (commands sent by you)
 */
async function handleOutgoingMessage(webhookData) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;
    
    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      console.log(`✏️ Edited message (outgoing) - using unique ID for reprocessing: ${messageId}`);
    }
    
    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      console.log(`🔄 Duplicate outgoing message detected, skipping: ${messageId}`);
      return;
    }
    
    // Mark message as processed
    processedMessages.add(messageId);
    
    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";
    
    // Handle text messages (regular, extended, quoted, and edited)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    } else if (messageData.typeMessage === 'quotedMessage') {
      // When replying to a message, the text is in extendedTextMessageData
      messageText = messageData.extendedTextMessageData?.text;
      // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      if (!messageText) {
        messageText = messageData.fileMessageData?.caption || 
                     messageData.imageMessageData?.caption || 
                     messageData.videoMessageData?.caption ||
                     messageData.stickerMessageData?.caption;
      }
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected (outgoing): "${messageText}"`);
    } else if (messageData.typeMessage === 'imageMessage') {
      // 🆕 Extract caption from image messages
      messageText = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    } else if (messageData.typeMessage === 'videoMessage') {
      // 🆕 Extract caption from video messages
      messageText = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    } else if (messageData.typeMessage === 'stickerMessage') {
      // 🆕 Extract caption from sticker messages (rare but possible)
      messageText = messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption;
    }
    
    // Enhanced logging for outgoing messages
    console.log(`📤 Outgoing from ${senderName}:`);
    console.log(`   Message Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    console.log(`   messageText extracted: ${messageText ? `"${messageText.substring(0, 100)}"` : 'NULL/UNDEFINED'}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'stickerMessage') {
      const caption = messageData.fileMessageData?.caption;
      console.log(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
    }
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
      }
      if (messageData.quotedMessage.caption) {
        console.log(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
      }
    }
    
    // Unified intent router for outgoing when text starts with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        const chatId = senderData.chatId;
        const senderId = senderData.sender;
        const senderName = senderData.senderName || senderId;
        const senderContactName = senderData.senderContactName || "";
        const chatName = senderData.chatName || "";

        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        // Only process quotedMessage if typeMessage is 'quotedMessage' (actual reply)
        // Don't process if it's just extendedTextMessage with leftover quotedMessage metadata
        const quotedMessage = messageData.quotedMessage;
        
        // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
        // Check if this is a REAL quote (reply) or just a media message with caption
        // Logic:
        // - If caption exists AND matches/starts with the text → It's a NEW media message (not a quote)
        // - If caption doesn't exist OR doesn't match → It's a REAL quote
        const quotedCaption = quotedMessage?.caption;
        const extractedText = messageData.extendedTextMessageData?.text; // Don't shadow messageText!
        // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
        const captionMatchesText = quotedCaption && extractedText && 
                                  (quotedCaption === extractedText || 
                                   quotedCaption.startsWith(extractedText) ||
                                   extractedText.startsWith(quotedCaption));
        
        const isActualQuote = messageData.typeMessage === 'quotedMessage' && 
                             quotedMessage && 
                             quotedMessage.stanzaId &&
                             extractedText &&
                             !captionMatchesText; // It's a quote if text doesn't match caption
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        let imageUrl = null;
        let videoUrl = null;
        let audioUrl = null;
        
        // 🆕 Extract URLs for direct media messages (imageMessage/videoMessage/audioMessage)
        if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage') {
          imageUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.imageMessageData?.downloadUrl ||
                    messageData.stickerMessageData?.downloadUrl;
          console.log(`📸 Outgoing: Direct image message, downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'videoMessage') {
          videoUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.videoMessageData?.downloadUrl;
          console.log(`🎥 Outgoing: Direct video message, downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'audioMessage') {
          audioUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.audioMessageData?.downloadUrl;
          console.log(`🎵 Outgoing: Direct audio message, downloadUrl: ${audioUrl ? 'found' : 'NOT FOUND'}`);
        }
        
        if (isActualQuote) {
          console.log(`🔗 Outgoing: Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
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
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself
          console.log(`📸 Outgoing: Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
            hasImage = true;
            // Try all possible locations for downloadUrl
            imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!imageUrl) {
              console.log('⚠️ Outgoing: downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                imageUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.imageMessageData?.downloadUrl;
                console.log(`✅ Outgoing: downloadUrl fetched from getMessage: ${imageUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Outgoing: Failed to fetch downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`📸 Outgoing: Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
          } else if (quotedMessage.typeMessage === 'videoMessage') {
            hasVideo = true;
            videoUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.videoMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.videoMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!videoUrl) {
              console.log('⚠️ Outgoing: Video downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                videoUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.videoMessageData?.downloadUrl;
                console.log(`✅ Outgoing: Video downloadUrl fetched from getMessage: ${videoUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Outgoing: Failed to fetch video downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`🎥 Outgoing: Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
          }
        }

        // Prepare quoted context for Agent (if quoted message exists) - Outgoing
        let quotedContext = null;
        if (isActualQuote && quotedMessage) {
          quotedContext = {
            type: quotedMessage.typeMessage || 'unknown',
            text: quotedMessage.textMessage || quotedMessage.caption || '',
            hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
            hasVideo: quotedMessage.typeMessage === 'videoMessage',
            hasAudio: quotedMessage.typeMessage === 'audioMessage',
            imageUrl: imageUrl || null,
            videoUrl: videoUrl || null,
            audioUrl: audioUrl || null, // Include audio URL if available
            stanzaId: quotedMessage.stanzaId
          };
        }

        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // 🆕 Pass media URLs to Agent
          videoUrl: videoUrl, // 🆕 Pass media URLs to Agent
          audioUrl: audioUrl, // 🆕 Pass media URLs to Agent
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            // Outgoing bypasses authorization in existing logic, but router still expects booleans
            media_creation: true,
            group_creation: true,
            voice_allowed: true
          }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling - OUTGOING) ═══════════════════
        // All outgoing requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT - OUTGOING] Processing request with Gemini Function Calling');
        
        const { routeToAgent } = require('../services/agentRouter');
        
        try {
            // 🧠 CRITICAL: Save user message to conversation history BEFORE processing
            // This ensures continuity and allows the bot to see the full conversation
            await conversationManager.addMessage(chatId, 'user', normalized.userText);
            console.log(`💾 [Agent - Outgoing] Saved user message to conversation history`);
            
            const agentResult = await routeToAgent(normalized, chatId);
            
            if (agentResult.success) {
              // Send any generated media (image/video/audio/poll) with captions
              let mediaSent = false;
              
              // Debug: Check multi-step status
              console.log(`🔍 [Debug - Outgoing] multiStep: ${agentResult.multiStep}, text length: ${agentResult.text?.length || 0}, hasImage: ${!!agentResult.imageUrl}`);
              
              // Multi-step: Send text FIRST, then media
              if (agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
                let cleanText = agentResult.text
                  .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs (image URLs should not be in text)
                  .replace(/\[image\]/gi, '')
                  .replace(/\[video\]/gi, '')
                  .replace(/\[audio\]/gi, '')
                  .replace(/\[תמונה\]/gi, '')
                  .replace(/\[וידאו\]/gi, '')
                  .replace(/\[אודיו\]/gi, '')
                  .trim();
                if (cleanText) {
                  await sendTextMessage(chatId, cleanText);
                  console.log(`📤 [Multi-step - Outgoing] Text sent first (${cleanText.length} chars)`);
                } else {
                  console.warn(`⚠️ [Multi-step - Outgoing] Text exists but cleanText is empty`);
                }
              } else {
                console.warn(`⚠️ [Multi-step - Outgoing] Text not sent - multiStep: ${agentResult.multiStep}, text: ${!!agentResult.text}, trimmed: ${!!agentResult.text?.trim()}`);
              }
              
              if (agentResult.imageUrl) {
                console.log(`📸 [Agent - Outgoing] Sending generated image: ${agentResult.imageUrl}`);
                
                let caption = '';
                
                // Multi-step: Use imageCaption if exists (LLM should return it in correct language)
                if (agentResult.multiStep) {
                  // For multi-step, use imageCaption if it exists
                  // LLM is responsible for returning caption in correct language
                  caption = (agentResult.imageCaption && agentResult.imageCaption.trim()) || '';
                  if (caption) {
                    console.log(`📤 [Multi-step - Outgoing] Image sent with caption: "${caption.substring(0, 50)}..."`);
                  } else {
                    console.log(`📤 [Multi-step - Outgoing] Image sent after text (no caption)`);
                  }
                } else {
                  // Single-step: Images support captions - use them!
                  // CRITICAL: If multiple tools were used, don't mix outputs!
                  // Only use imageCaption (specific) or text if it's the ONLY output
                  const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);
                  
                  if (multipleTools) {
                    // Multiple tools → use ONLY imageCaption (specific to this image)
                    caption = agentResult.imageCaption || '';
                    console.log(`ℹ️ Multiple tools detected - using imageCaption only to avoid mixing outputs`);
                  } else {
                    // Single tool → can use general text as fallback
                    caption = agentResult.imageCaption || agentResult.text || '';
                  }
                  
                  // Clean the caption: remove URLs, markdown links, and technical markers
                  caption = caption
                    .replace(/\[.*?\]\(https?:\/\/[^\)]+\)/g, '') // Remove markdown links
                    .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
                    .replace(/\[image\]/gi, '') // Remove [image] markers
                    .replace(/\[video\]/gi, '') // Remove [video] markers
                    .replace(/\[audio\]/gi, '') // Remove [audio] markers
                    .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                    .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                    .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                    .replace(/התמונה.*?נוצרה בהצלחה!/gi, '') // Remove success messages
                    .replace(/הוידאו.*?נוצר בהצלחה!/gi, '')
                    .replace(/✅/g, '')
                    .trim();
                }
                
                await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption);
                mediaSent = true;
              }
              
              // For multi-step, video is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent - Outgoing] Skipping video send - already sent in multi-step`);
              } else if (agentResult.videoUrl) {
                console.log(`🎬 [Agent - Outgoing] Sending generated video: ${agentResult.videoUrl}`);
                // Videos don't support captions well - send as file, text separately
                await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '');
                mediaSent = true;
                
                // If there's meaningful text (description/revised prompt), send it separately
                if (agentResult.text && agentResult.text.trim()) {
                  let videoDescription = agentResult.text
                    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs
                    .replace(/\[image\]/gi, '') // Remove [image] markers
                    .replace(/\[video\]/gi, '') // Remove [video] markers
                    .replace(/\[audio\]/gi, '') // Remove [audio] markers
                    .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                    .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                    .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                    .trim();
                  if (videoDescription && videoDescription.length > 2) {
                    await sendTextMessage(chatId, videoDescription);
                  }
                }
              }
              
              // For multi-step, audio is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent - Outgoing] Skipping audio send - already sent in multi-step`);
              } else if (agentResult.audioUrl) {
                console.log(`🎵 [Agent - Outgoing] Sending generated audio: ${agentResult.audioUrl}`);
                // Audio doesn't support captions - send as file only
                const fullAudioUrl = agentResult.audioUrl.startsWith('http') 
                  ? agentResult.audioUrl 
                  : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
                mediaSent = true;
                
                // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
                // No need for textual descriptions like "הנה הקלטה קולית..."
              }
              
              // For multi-step, poll is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent - Outgoing] Skipping poll send - already sent in multi-step`);
              } else if (agentResult.poll) {
                console.log(`📊 [Agent - Outgoing] Sending poll: ${agentResult.poll.question}`);
                // Convert options to Green API format
                const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
                await sendPoll(chatId, agentResult.poll.question, pollOptions, false);
                mediaSent = true;
              }
              
              // For multi-step, location is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent - Outgoing] Skipping location send - already sent in multi-step`);
              } else if (agentResult.latitude && agentResult.longitude) {
                console.log(`📍 [Agent - Outgoing] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
                await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '');
                mediaSent = true;
                // Send location info as separate text message
                if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
                  await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`);
                }
              }
              
              // Single-step: If no media was sent and it's not multi-step, send text response (אם יש)
              // Multi-step text was already sent above
              if (!agentResult.multiStep && !mediaSent && agentResult.text && agentResult.text.trim()) {
                const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);
                
                if (!multipleTools) {
                  // Single tool → safe to send text
                  const cleanText = cleanAgentText(agentResult.text);
                  if (cleanText) {
                    await sendTextMessage(chatId, cleanText);
                  }
                } else {
                  console.log(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
                }
              }
              
              // 🧠 CRITICAL: Save bot's response to conversation history for continuity!
              // This allows the bot to see its own previous responses in future requests
              if (agentResult.text && agentResult.text.trim()) {
                await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
                console.log(`💾 [Agent - Outgoing] Saved bot response to conversation history`);
              }
              
              console.log(`✅ [Agent - Outgoing] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
            } else {
              await sendTextMessage(chatId, `❌ שגיאה: ${agentResult.error || 'לא הצלחתי לעבד את הבקשה'}`);
            }
            return; // Exit early - no need for regular flow
            
          } catch (agentError) {
            console.error('❌ [Agent - Outgoing] Error:', agentError);
            await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${agentError.message}`);
            return;
          }
        

      } catch (error) {
        console.error('❌ Command execution error (outgoing):', error.message || error);
        await sendTextMessage(chatId, `❌ שגיאה בביצוע הפקודה: ${error.message || error}`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling outgoing message:', error.message || error);
  }
}
/**
 * Process image edit message asynchronously (no await from webhook)
 */
function processImageEditAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageEdit(imageData).catch(async error => {
    console.error('❌ Error in async image edit processing:', error.message || error);
    try {
      await sendTextMessage(imageData.chatId, `❌ שגיאה בעריכת התמונה: ${error.message || error}`);
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

/**
 * Process image-to-video message asynchronously (no await from webhook)
 */
function processImageToVideoAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageToVideo(imageData).catch(async error => {
    console.error('❌ Error in async image-to-video processing:', error.message || error);
    try {
      await sendTextMessage(imageData.chatId, `❌ שגיאה ביצירת וידאו מהתמונה: ${error.message || error}`);
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

/**
 * Process voice message asynchronously (no await from webhook)
 */
function processVoiceMessageAsync(voiceData) {
  // Run in background without blocking webhook response
  handleVoiceMessage(voiceData).catch(error => {
    console.error('❌ Error in async voice processing:', error.message || error);
  });
}

/**
 * Process video-to-video message asynchronously (no await from webhook)
 */
function processVideoToVideoAsync(videoData) {
  // Run in background without blocking webhook response
  handleVideoToVideo(videoData).catch(async error => {
    console.error('❌ Error in async video-to-video processing:', error.message || error);
    try {
      await sendTextMessage(videoData.chatId, `❌ שגיאה בעיבוד הווידאו: ${error.message || error}`);
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

/**
 * Handle image edit with AI (Gemini or OpenAI)
 */
// Media handler functions are now imported from services/whatsapp/mediaHandlers.js
/**
 * Handle management commands (non-AI commands that don't go through router)
 */
async function handleManagementCommand(command, chatId, senderId, senderName, senderContactName, chatName) {
  try {
    switch (command.type) {
      case 'clear_all_conversations': {
        await conversationManager.clearAllConversations();
        await sendTextMessage(chatId, '✅ כל ההיסטוריות נוקו בהצלחה');
        console.log(`🗑️ All conversation histories cleared by ${senderName}`);
        break;
      }

      case 'show_history': {
        const history = await conversationManager.getConversationHistory(chatId);
        if (history && history.length > 0) {
          let historyText = '📜 **היסטוריית שיחה:**\n\n';
          history.forEach((msg, i) => {
            const role = msg.role === 'user' ? '👤' : '🤖';
            historyText += `${role} ${msg.content}\n\n`;
          });
          await sendTextMessage(chatId, historyText);
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה');
        }
        break;
      }

      case 'media_creation_status': {
        const authorizedUsers = await authStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת מדיה:**\n\n';
          authorizedUsers.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText);
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת מדיה');
        }
        break;
      }

      case 'voice_transcription_status': {
        const allowList = await conversationManager.getVoiceAllowList();
        if (allowList && allowList.length > 0) {
          let statusText = '✅ **משתמשים מורשים לתמלול:**\n\n';
          allowList.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText);
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים לתמלול');
        }
        break;
      }

      case 'group_creation_status': {
        const authorizedUsers = await groupAuthStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת קבוצות:**\n\n';
          authorizedUsers.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText);
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת קבוצות');
        }
        break;
      }

      case 'sync_contacts': {
        try {
          await sendTextMessage(chatId, '📇 מעדכן רשימת אנשי קשר...');
          
          // Fetch contacts from Green API
          const { getContacts } = require('../services/greenApiService');
          const contacts = await getContacts();
          
          if (!contacts || contacts.length === 0) {
            await sendTextMessage(chatId, '⚠️ לא נמצאו אנשי קשר');
            return;
          }
          
          // Sync to database
          const syncResult = await conversationManager.syncContacts(contacts);
          
          const resultMessage = `✅ עדכון אנשי קשר הושלם!
📊 סטטיסטיקה:
• חדשים: ${syncResult.inserted}
• עודכנו: ${syncResult.updated}  
• סה"כ: ${syncResult.total}
💾 כל אנשי הקשר נשמרו במסד הנתונים`;
          
          await sendTextMessage(chatId, resultMessage);
          console.log(`✅ Contacts synced successfully by ${senderName}`);
        } catch (error) {
          console.error('❌ Error syncing contacts:', error);
          await sendTextMessage(chatId, `❌ שגיאה בעדכון אנשי קשר: ${error.message}`);
        }
        break;
      }

      case 'add_media_authorization': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasAdded = await authStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת מדיה`);
            console.log(`✅ Added ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) to media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת מדיה`);
          }
        } catch (error) {
          console.error('❌ Error in add_media_authorization:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהוספת הרשאה: ${error.message}`);
        }
        break;
      }

      case 'remove_media_authorization': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasRemoved = await authStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת מדיה`);
            console.log(`✅ Removed ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) from media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת מדיה`);
          }
        } catch (error) {
          console.error('❌ Error in remove_media_authorization:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהסרת הרשאה: ${error.message}`);
        }
        break;
      }

      case 'add_group_authorization': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת קבוצות`);
            console.log(`✅ Added ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) to group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת קבוצות`);
          }
        } catch (error) {
          console.error('❌ Error in add_group_authorization:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהוספת הרשאה: ${error.message}`);
        }
        break;
      }

      case 'remove_group_authorization': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasRemoved = await groupAuthStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת קבוצות`);
            console.log(`✅ Removed ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) from group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת קבוצות`);
          }
        } catch (error) {
          console.error('❌ Error in remove_group_authorization:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהסרת הרשאה: ${error.message}`);
        }
        break;
      }

      case 'include_in_transcription': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasAdded = await conversationManager.addToVoiceAllowList(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים לתמלול`);
            console.log(`✅ Added ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) to voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים לתמלול`);
          }
        } catch (error) {
          console.error('❌ Error in include_in_transcription:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהוספת הרשאת תמלול: ${error.message}`);
        }
        break;
      }

      case 'exclude_from_transcription': {
        try {
          const { findContactByName } = require('../services/groupService');
          
          // Use fuzzy search to find exact contact/group name
          await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`);
          const foundContact = await findContactByName(command.contactName);
          
          if (!foundContact) {
            await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`);
            break;
          }
          
          // Use the exact contact name found in DB
          const exactName = foundContact.contactName;
          const entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
          await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`);
          
          const wasRemoved = await conversationManager.removeFromVoiceAllowList(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים לתמלול`);
            console.log(`✅ Removed ${exactName} ${foundContact.isGroup ? '(group)' : '(contact)'} (searched: ${command.contactName}) from voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים לתמלול`);
          }
        } catch (error) {
          console.error('❌ Error in exclude_from_transcription:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהסרת הרשאת תמלול: ${error.message}`);
        }
        break;
      }

      case 'add_group_authorization_current': {
        try {
          // Auto-detect contact/group name from current chat
          const isGroupChat = chatId && chatId.endsWith('@g.us');
          const isPrivateChat = chatId && chatId.endsWith('@c.us');
          
          let targetName = '';
          if (isGroupChat) {
            targetName = chatName || senderName;
          } else if (isPrivateChat) {
            targetName = senderContactName || chatName || senderName;
          } else {
            await sendTextMessage(chatId, '❌ לא ניתן לזהות את השיחה הנוכחית');
            break;
          }
          
          await sendTextMessage(chatId, `📝 מזהה אוטומטית: "${targetName}"`);
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(targetName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${targetName} נוסף לרשימת המורשים ליצירת קבוצות`);
            console.log(`✅ Added ${targetName} (auto-detected from current chat) to group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${targetName} כבר נמצא ברשימת המורשים ליצירת קבוצות`);
          }
        } catch (error) {
          console.error('❌ Error in add_group_authorization_current:', error);
          await sendTextMessage(chatId, `❌ שגיאה בהוספת הרשאה: ${error.message}`);
        }
        break;
      }

      default:
        console.log(`⚠️ Unknown management command type: ${command.type}`);
        await sendTextMessage(chatId, `⚠️ Unknown management command type: ${command.type}`);
    }
  } catch (error) {
    console.error(`❌ Error handling management command ${command.type}:`, error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד הפקודה: ${error.message || error}`);
  }
}

module.exports = router;