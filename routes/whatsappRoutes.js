const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile, getChatHistory, getMessage, sendPoll } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const { cleanPromptFromProviders } = require('../utils/promptCleaner');
const { generateTextResponse: generateOpenAIResponse, generateImageForWhatsApp: generateOpenAIImage, editImageForWhatsApp: editOpenAIImage } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp, analyzeVideoWithText, generateVideoForWhatsApp, generateVideoFromImageForWhatsApp, generateChatSummary, parseMusicRequest, parseTextToSpeechRequest, translateText, generateCreativePoll } = require('../services/geminiService');
const { generateTextResponse: generateGrokResponse, generateImageForWhatsApp: generateGrokImage } = require('../services/grokService');
const { generateVideoFromImageForWhatsApp: generateKlingVideoFromImage, generateVideoFromVideoForWhatsApp: generateRunwayVideoFromVideo, generateVideoWithTextForWhatsApp: generateKlingVideoFromText } = require('../services/replicateService');
const { generateMusicWithLyrics } = require('../services/musicService');
const speechService = require('../services/speechService');
const { voiceService } = require('../services/voiceService');
const { audioConverterService } = require('../services/audioConverterService');
const { creativeAudioService } = require('../services/creativeAudioService');
const conversationManager = require('../services/conversationManager');
const { routeIntent } = require('../services/intentRouter');
const authStore = require('../store/authStore');
const groupAuthStore = require('../store/groupAuthStore');
const fs = require('fs');
const path = require('path');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Last command cache per chat - for retry functionality
// Structure: { chatId: { tool: 'gemini_image', args: { prompt: '...' }, timestamp: 123456 } }
const lastCommandCache = new Map();

// Chat history limit for context retrieval
const CHAT_HISTORY_LIMIT = 30;

// Voice transcription and media authorization are managed through PostgreSQL database

/**
 * Clean sensitive/large data from objects for logging
 * Removes base64 thumbnails and truncates long strings
 */
function cleanForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Create a deep copy to avoid modifying the original
  const cleaned = JSON.parse(JSON.stringify(obj));
  
  function cleanObject(o) {
    for (const key in o) {
      if (o[key] && typeof o[key] === 'object') {
        cleanObject(o[key]);
      } else if (key === 'jpegThumbnail' || key === 'thumbnail') {
        // Replace base64 thumbnails with a short indicator
        if (typeof o[key] === 'string' && o[key].length > 100) {
          o[key] = `[base64 thumbnail: ${o[key].length} chars]`;
        }
      } else if (key === 'vcard' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long vCard fields (contact cards with base64 photos)
        o[key] = `[vCard: ${o[key].length} chars, starts with: ${o[key].substring(0, 100)}...]`;
      } else if ((key === 'downloadUrl' || key === 'url') && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long URLs
        o[key] = `[URL: ${o[key].length} chars, starts with: ${o[key].substring(0, 80)}...]`;
      } else if (key === 'data' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long base64 data fields
        o[key] = `[base64 data: ${o[key].length} chars, starts with: ${o[key].substring(0, 50)}...]`;
      }
    }
  }
  
  cleanObject(cleaned);
  return cleaned;
}

/**
 * Save last executed command for retry functionality
 * @param {string} chatId - Chat ID
 * @param {Object} decision - Router decision object
 * @param {Object} options - Additional options (imageUrl, videoUrl, normalized)
 */
function saveLastCommand(chatId, decision, options = {}) {
  // Don't save retry, clarification, or denial commands
  if (['retry_last_command', 'ask_clarification', 'deny_unauthorized'].includes(decision.tool)) {
    return;
  }
  
  lastCommandCache.set(chatId, {
    tool: decision.tool,
    args: decision.args,
    imageUrl: options.imageUrl || null,
    videoUrl: options.videoUrl || null,
    normalized: options.normalized || null,
    timestamp: Date.now()
  });
  
  console.log(`💾 Saved last command for ${chatId}: ${decision.tool}`);
}

/**
 * Format chat history messages for including as context in prompts
 * @param {Array} messages - Array of messages from getChatHistory
 * @returns {string} - Formatted messages string
 */
function formatChatHistoryForContext(messages) {
  if (!messages || messages.length === 0) {
    return '';
  }
  
  let formattedMessages = '';
  messages.forEach((msg, index) => {
    const timestamp = new Date(msg.timestamp * 1000).toLocaleString('he-IL');
    
    // Use WhatsApp display name only (chatName), fallback to phone number
    let sender = 'משתמש';
    if (msg.chatName) {
      sender = msg.chatName;
    } else if (msg.sender) {
      // Extract phone number from sender ID (e.g., "972543995202@c.us" -> "972543995202")
      const phoneMatch = msg.sender.match(/^(\d+)@/);
      sender = phoneMatch ? phoneMatch[1] : msg.sender;
    }
    
    const messageText = msg.textMessage || msg.caption || '[מדיה]';
    
    formattedMessages += `${index + 1}. ${timestamp} - ${sender}: ${messageText}\n`;
  });
  
  return formattedMessages;
}

/**
 * Check if user is authorized for media creation (images, videos, music)
 * @param {Object} senderData - WhatsApp sender data from Green API
 * @returns {Promise<boolean>} - True if user is authorized
 */
async function isAuthorizedForMediaCreation(senderData) {
  return await authStore.isAuthorizedForMediaCreation(senderData);
}

/**
 * Check if user is authorized for group creation
 * @param {Object} senderData - WhatsApp sender data from Green API
 * @returns {Promise<boolean>} - True if user is authorized
 */
async function isAuthorizedForGroupCreation(senderData) {
  return await groupAuthStore.isAuthorizedForGroupCreation(senderData);
}

/**
 * Check if command requires media creation authorization
 * @param {string} commandType - Command type
 * @returns {boolean} - True if command requires authorization
 */
function requiresMediaAuthorization(commandType) {
  const mediaCommands = [
    'gemini_image',
    'openai_image',
    'grok_image', 
    'veo3_video',
    'kling_text_to_video',
    'kling_image_to_video',
    'veo3_image_to_video',
    'runway_video_to_video',
    'music_generation',
    'text_to_speech',
    'gemini_image_edit',
    'openai_image_edit'
  ];
  return mediaCommands.includes(commandType);
}

/**
 * Check if a command is an admin/management command (should only work from outgoing messages)
 * @param {string} commandType - Command type
 * @returns {boolean} - True if command is admin-only
 */
function isAdminCommand(commandType) {
  const adminCommands = [
    'include_in_transcription',
    'exclude_from_transcription',
    'add_media_authorization',
    'remove_media_authorization',
    'voice_transcription_status',
    'media_creation_status',
    'add_group_authorization',
    'remove_group_authorization',
    'group_creation_status',
    'clear_all_conversations',
    'sync_contacts',
    // New admin shortcuts without explicit name
    'add_media_authorization_current',
    'add_group_authorization_current',
    'include_in_transcription_current'
  ];
  return adminCommands.includes(commandType);
}

/**
 * Send unauthorized access message
 * @param {string} chatId - WhatsApp chat ID
 * @param {string} feature - Feature name (for logging)
 */
async function sendUnauthorizedMessage(chatId, feature) {
  const message = '🔒 סליחה, אין לך הרשאה להשתמש בתכונה זו. פנה למנהל המערכת.';
  await sendTextMessage(chatId, message);
  console.log(`🚫 Unauthorized access attempt to ${feature}`);
}

// Clean up old processed messages and last command cache every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
  // Clean up old last commands (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [chatId, command] of lastCommandCache.entries()) {
    if (command.timestamp < oneHourAgo) {
      lastCommandCache.delete(chatId);
    }
  }
  if (lastCommandCache.size > 0) {
    console.log(`🧹 Cleaned up old commands from cache (${lastCommandCache.size} remaining)`);
  }
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
async function sendAck(chatId, command) {
  let ackMessage = '';
  
  switch (command.type) {
    // ═══════════════════ CHAT ═══════════════════
    case 'gemini_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Gemini...';
      break;
    case 'openai_chat':
      ackMessage = '💬 קיבלתי. מעבד עם OpenAI...';
      break;
    case 'grok_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Grok...';
      break;
      
    // ═══════════════════ IMAGE GENERATION ═══════════════════
    case 'gemini_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Gemini...';
      break;
    case 'openai_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם OpenAI...';
      break;
    case 'grok_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Grok...';
      break;
      
    // ═══════════════════ VIDEO GENERATION ═══════════════════
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Veo 3.1...';
      break;
    case 'kling_text_to_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Kling AI...';
      break;
    case 'veo3_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה! יוצר וידאו עם Veo 3.1...';
      break;
    case 'kling_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה! יוצר וידאו עם Kling AI...';
      break;
    case 'runway_video_to_video':
      ackMessage = '🎬 קיבלתי את הווידאו! עובד עליו עם RunwayML Gen4...';
      break;
      
    // ═══════════════════ AUDIO & VOICE ═══════════════════
    case 'text_to_speech':
      ackMessage = '🗣️ קיבלתי! מייצר דיבור עם ElevenLabs...';
      break;
    case 'voice_processing':
      ackMessage = '🎤 קיבלתי את ההקלטה! מעבד תמלול, שיבוט קול ותשובה...';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי! מייצר קול עם ElevenLabs...';
      break;
    case 'creative_voice_processing':
      ackMessage = '🎨 קיבלתי את ההקלטה! מתחיל עיבוד יצירתי עם אפקטים ומוזיקה...';
      break;
      
    // ═══════════════════ MUSIC ═══════════════════
    case 'music_generation':
      ackMessage = '🎵 קיבלתי! מתחיל יצירת שיר עם Suno AI... 🎶';
      break;
      
    // ═══════════════════ UTILITIES ═══════════════════
    case 'chat_summary':
      ackMessage = '📝 קיבלתי! מכין סיכום השיחה עם Gemini...';
      break;
    
    case 'retry_last_command':
      ackMessage = '🔄 קיבלתי! מריץ שוב את הפקודה האחרונה...';
      break;
    
    case 'create_poll':
      ackMessage = '📊 קיבלתי! יוצר סקר יצירתי עם חרוזים...';
      break;
      
    default:
      return; // No ACK needed for this command
  }
  
  try {
    await sendTextMessage(chatId, ackMessage);
    console.log(`✅ ACK sent for ${command.type}`);
  } catch (error) {
    console.error('❌ Error sending ACK:', error.message || error);
  }
}

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
    console.log('📱 Green API webhook received:');
    console.log(`   Type: ${webhookData.typeWebhook || 'unknown'}`);
    console.log(`   Message Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);
    console.log(`   Full Payload:`, JSON.stringify(cleanForLogging(webhookData), null, 2));

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
    
    // For media messages (image/video), fetch the original message to get downloadUrl
    if (quotedType === 'imageMessage' || quotedType === 'videoMessage') {
      console.log(`📸 Quoted ${quotedType}, fetching original message...`);
      
      // getMessage returns the full message with proper downloadUrl
      const originalMessage = await getMessage(chatId, quotedMessage.stanzaId);
      
      if (!originalMessage) {
        throw new Error('Failed to fetch quoted message');
      }
      
      // Extract download URL from the original message
      // Try multiple possible locations in the response structure
      let downloadUrl = null;
      
      if (quotedType === 'imageMessage') {
        downloadUrl = originalMessage.downloadUrl || 
                     originalMessage.fileMessageData?.downloadUrl || 
                     originalMessage.imageMessageData?.downloadUrl ||
                     originalMessage.messageData?.fileMessageData?.downloadUrl ||
                     originalMessage.messageData?.imageMessageData?.downloadUrl;
      } else if (quotedType === 'videoMessage') {
        downloadUrl = originalMessage.downloadUrl || 
                     originalMessage.fileMessageData?.downloadUrl || 
                     originalMessage.videoMessageData?.downloadUrl ||
                     originalMessage.messageData?.fileMessageData?.downloadUrl ||
                     originalMessage.messageData?.videoMessageData?.downloadUrl;
      }
      
      if (!downloadUrl) {
        console.log('⚠️ No downloadUrl found in originalMessage structure:');
        console.log(JSON.stringify(cleanForLogging(originalMessage), null, 2));
        throw new Error(`No downloadUrl found for quoted ${quotedType}. Cannot process media from bot's own messages yet.`);
      }
      
      console.log(`✅ Found downloadUrl for quoted ${quotedType}`);
      
      // Return the URL directly - let the handler functions download when needed
      return {
        hasImage: quotedType === 'imageMessage',
        hasVideo: quotedType === 'videoMessage',
        prompt: currentPrompt, // Use current prompt as the instruction
        imageUrl: quotedType === 'imageMessage' ? downloadUrl : null,
        videoUrl: quotedType === 'videoMessage' ? downloadUrl : null
      };
    }
    
    // For other types, just use current prompt
    console.log(`⚠️ Unsupported quoted message type: ${quotedType}, using current prompt only`);
    return {
      hasImage: false,
      hasVideo: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null
    };
    
  } catch (error) {
    console.error('❌ Error handling quoted message:', error.message);
    
    // If it's a downloadUrl error for bot's own messages, return a clear error
    if (error.message.includes('Cannot process media from bot')) {
      return {
        hasImage: false,
        hasVideo: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        error: '⚠️ לא יכול לעבד תמונות/וידאו שהבוט שלח. שלח את המדיה מחדש או צטט הודעה ממשתמש אחר.'
      };
    }
    
    // For other errors, fallback to current prompt only
    return {
      hasImage: false,
      hasVideo: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null
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
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected: "${messageText}"`);
    }
    
    // Enhanced logging for incoming messages
    console.log(`📱 Incoming from ${senderName}:`);
    console.log(`   Message Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    console.log(`   messageText extracted: ${messageText ? `"${messageText.substring(0, 100)}"` : 'NULL/UNDEFINED'}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
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
    }
    
    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        const quotedMessage = messageData.quotedMessage;
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let imageUrl = null;
        let videoUrl = null;
        
        if (quotedMessage && quotedMessage.stanzaId) {
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
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
        }
        
        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage',
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
            // group_creation and voice_allowed will be checked only when needed (lazy evaluation)
            group_creation: null,
            voice_allowed: null
          },
          // Pass sender data for lazy authorization checks
          senderData: { senderContactName, chatName, senderName, chatId }
        };

        const decision = await routeIntent(normalized);

        // Router-based direct execution - call services directly
        const rawPrompt = decision.args?.prompt || finalPrompt;
        // Clean prompt from provider mentions before sending to services
        const prompt = cleanPromptFromProviders(rawPrompt);
        
        try {
          switch (decision.tool) {
            case 'retry_last_command': {
              // Check if there's a quoted message with a command
              if (quotedMessage && quotedMessage.stanzaId) {
                console.log('🔄 Retry with quoted message - extracting command from quoted message');
                
                // Extract the command from the quoted message
                let quotedText = null;
                if (quotedMessage.typeMessage === 'textMessage' || quotedMessage.typeMessage === 'extendedTextMessage') {
                  quotedText = quotedMessage.textMessage || quotedMessage.extendedTextMessage?.text;
                } else if (quotedMessage.typeMessage === 'imageMessage') {
                  quotedText = quotedMessage.fileMessageData?.caption || quotedMessage.imageMessageData?.caption;
                } else if (quotedMessage.typeMessage === 'videoMessage') {
                  quotedText = quotedMessage.fileMessageData?.caption || quotedMessage.videoMessageData?.caption;
                }
                
                // Check if quoted message has a command (starts with #)
                if (quotedText && /^#\s+/.test(quotedText.trim())) {
                  console.log(`🔄 Found command in quoted message: "${quotedText.substring(0, 50)}..."`);
                  // Re-process the quoted message as if it's a new message
                  // We'll handle the quoted message using existing logic
                  const quotedResult = await handleQuotedMessage(quotedMessage, '', chatId);
                  
                  if (quotedResult.error) {
                    await sendTextMessage(chatId, quotedResult.error);
                    return;
                  }
                  
                  // Re-route with the quoted message content
                  const retryNormalized = {
                    userText: quotedText,
                    hasImage: quotedResult.hasImage,
                    hasVideo: quotedResult.hasVideo,
                    hasAudio: false,
                    chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
                    language: 'he',
                    authorizations: {
                      media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
                      group_creation: null,
                      voice_allowed: null
                    },
                    senderData: { senderContactName, chatName, senderName, chatId }
                  };
                  
                  const retryDecision = await routeIntent(retryNormalized);
                  console.log(`🔄 Retry routing decision: ${retryDecision.tool}`);
                  
                  // Save this as the last command for future retries
                  lastCommandCache.set(chatId, {
                    tool: retryDecision.tool,
                    args: retryDecision.args,
                    normalized: retryNormalized,
                    imageUrl: quotedResult.imageUrl,
                    videoUrl: quotedResult.videoUrl,
                    timestamp: Date.now()
                  });
                  
                  // Continue with normal execution (don't return here, fall through to execute the command)
                  // Re-assign decision to retryDecision so it executes
                  Object.assign(decision, retryDecision);
                  // Also update imageUrl/videoUrl for media commands
                  imageUrl = quotedResult.imageUrl;
                  videoUrl = quotedResult.videoUrl;
                  hasImage = quotedResult.hasImage;
                  hasVideo = quotedResult.hasVideo;
                } else {
                  await sendTextMessage(chatId, 'ℹ️ ההודעה המצוטטת לא מכילה פקודה. צטט הודעה שמתחילה ב-"#"');
                  return;
                }
              } else {
                // No quoted message - retry last command from cache
                const lastCommand = lastCommandCache.get(chatId);
                
                if (!lastCommand) {
                  await sendTextMessage(chatId, 'ℹ️ אין פקודה קודמת לביצוע מחדש. נסה לשלוח פקודה חדשה.');
                  return;
                }
                
                console.log(`🔄 Retrying last command: ${lastCommand.tool}`);
                
                // Re-assign decision to last command
                Object.assign(decision, {
                  tool: lastCommand.tool,
                  args: lastCommand.args,
                  reason: 'Retry last command'
                });
                
                // Restore media URLs if they exist
                if (lastCommand.imageUrl) {
                  imageUrl = lastCommand.imageUrl;
                  hasImage = true;
                }
                if (lastCommand.videoUrl) {
                  videoUrl = lastCommand.videoUrl;
                  hasVideo = true;
                }
                
                // Update timestamp for cleanup
                lastCommand.timestamp = Date.now();
              }
              // Don't return - fall through to execute the command
              break;
            }
            
            case 'ask_clarification':
              await sendTextMessage(chatId, 'ℹ️ לא ברור מה לבצע. תוכל לחדד בבקשה?');
              return;
              
            case 'deny_unauthorized':
              if (decision.args?.feature && decision.args.feature !== 'voice') {
                await sendUnauthorizedMessage(chatId, decision.args.feature);
              }
              return;
              
            // ═══════════════════ CHAT (Text Generation) ═══════════════════
            case 'gemini_chat': {
              // Save command for retry (before execution)
              saveLastCommand(chatId, decision, { imageUrl, videoUrl, normalized });
              
              await sendAck(chatId, { type: 'gemini_chat' });
              
              // Check if this is image analysis (hasImage = true)
              if (normalized.hasImage) {
                // This is image analysis - use analyzeImageWithText
                const { analyzeImageWithText } = require('../services/geminiService');
                
                try {
                  // Get image URL (either from quoted message or current message)
                  const finalImageUrl = imageUrl || messageData.fileMessageData?.downloadUrl || messageData.imageMessageData?.downloadUrl;
                  if (!finalImageUrl) {
                    await sendTextMessage(chatId, '❌ לא הצלחתי לקבל את התמונה לניתוח');
                    return;
                  }
                  
                  // Download and convert to base64
                  const downloadedBuffer = await downloadFile(finalImageUrl);
                  const base64Image = downloadedBuffer.toString('base64');
                  
                  // Check if user wants to reference previous messages
                  let finalPrompt = prompt;
                  if (decision.args?.needsChatHistory) {
                    try {
                      console.log(`📜 User requested chat history context for image analysis, fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                      const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                      
                      if (chatHistory && chatHistory.length > 0) {
                        const formattedHistory = formatChatHistoryForContext(chatHistory);
                        finalPrompt = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                        console.log(`✅ Added ${chatHistory.length} messages as context to image analysis`);
                      }
                    } catch (historyError) {
                      console.error('❌ Error fetching chat history:', historyError);
                    }
                  }
                  
                  const result = await analyzeImageWithText(finalPrompt, base64Image);
                  if (result.success) {
                    await sendTextMessage(chatId, result.text);
                  } else {
                    await sendTextMessage(chatId, `❌ ${result.error}`);
                  }
                } catch (error) {
                  await sendTextMessage(chatId, `❌ שגיאה בניתוח התמונה: ${error.message}`);
                }
              } else if (normalized.hasVideo) {
                // This is video analysis - use analyzeVideoWithText
                const { analyzeVideoWithText } = require('../services/geminiService');
                
                try {
                  // Get video URL (either from quoted message or current message)
                  const finalVideoUrl = videoUrl || messageData.fileMessageData?.downloadUrl || messageData.videoMessageData?.downloadUrl;
                  if (!finalVideoUrl) {
                    await sendTextMessage(chatId, '❌ לא הצלחתי לקבל את הוידאו לניתוח');
                    return;
                  }
                  
                  // Download video buffer
                  const videoBuffer = await downloadFile(finalVideoUrl);
                  
                  // Check if user wants to reference previous messages
                  let finalPromptVideo = prompt;
                  if (decision.args?.needsChatHistory) {
                    try {
                      console.log(`📜 User requested chat history context for video analysis, fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                      const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                      
                      if (chatHistory && chatHistory.length > 0) {
                        const formattedHistory = formatChatHistoryForContext(chatHistory);
                        finalPromptVideo = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                        console.log(`✅ Added ${chatHistory.length} messages as context to video analysis`);
                      }
                    } catch (historyError) {
                      console.error('❌ Error fetching chat history:', historyError);
                    }
                  }
                  
                  const result = await analyzeVideoWithText(finalPromptVideo, videoBuffer);
                  if (result.success) {
                    await sendTextMessage(chatId, result.text);
                  } else {
                    await sendTextMessage(chatId, `❌ ${result.error}`);
                  }
                } catch (error) {
                  await sendTextMessage(chatId, `❌ שגיאה בניתוח הוידאו: ${error.message}`);
                }
              } else {
                // Regular text chat
                let finalPrompt = prompt;
                
                // Check if user wants to reference previous messages in the chat/group
                if (decision.args?.needsChatHistory) {
                  try {
                    console.log(`📜 User requested chat history context, fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                    const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                    
                    if (chatHistory && chatHistory.length > 0) {
                      const formattedHistory = formatChatHistoryForContext(chatHistory);
                      
                      // Prepend chat history to the prompt
                      finalPrompt = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                      console.log(`✅ Added ${chatHistory.length} messages as context to prompt`);
                    } else {
                      console.log('⚠️ No chat history available, proceeding without context');
                    }
                  } catch (historyError) {
                    console.error('❌ Error fetching chat history:', historyError);
                    // Continue without history if fetch fails
                  }
                }
                
                const contextMessages = await conversationManager.getConversationHistory(chatId);
                await conversationManager.addMessage(chatId, 'user', finalPrompt);
                const result = await generateGeminiResponse(finalPrompt, contextMessages);
                if (!result.error) {
                  await conversationManager.addMessage(chatId, 'assistant', result.text);
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              }
              return;
            }
            
            case 'openai_chat': {
              saveLastCommand(chatId, decision, { normalized });
              await sendAck(chatId, { type: 'openai_chat' });
              const contextMessages = await conversationManager.getConversationHistory(chatId);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateOpenAIResponse(prompt, contextMessages);
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              } else {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              }
              return;
            }
            
            case 'grok_chat': {
              saveLastCommand(chatId, decision, { normalized });
              await sendAck(chatId, { type: 'grok_chat' });
              // Note: Grok doesn't use conversation history (causes issues)
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGrokResponse(prompt, []);
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              } else {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              }
              return;
            }
            
            // ═══════════════════ IMAGE GENERATION ═══════════════════
            case 'gemini_image': {
              saveLastCommand(chatId, decision, { normalized });
              try {
                await sendAck(chatId, { type: 'gemini_image' });
                console.log('🎨 ACK sent for gemini_image, starting generation...');
                
                const imageResult = await generateImageForWhatsApp(prompt);
                console.log('🎨 Gemini image generation result:', imageResult.success ? 'SUCCESS' : 'FAILED');
                
                if (imageResult.success && imageResult.imageUrl) {
                  const fileName = `gemini_image_${Date.now()}.png`;
                  const caption = imageResult.description || '';
                  await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
                  console.log('🎨 Image sent successfully to WhatsApp');
                } else if (imageResult.textResponse) {
                  await sendTextMessage(chatId, imageResult.textResponse);
                  console.log('🎨 Text response sent instead of image');
                } else {
                  await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
                  console.log('🎨 Error message sent:', imageResult.error);
                }
              } catch (imageError) {
                console.error('❌ Error in gemini_image case:', imageError);
                await sendTextMessage(chatId, `❌ שגיאה ביצירת התמונה: ${imageError.message}`);
              }
              return;
            }
            
            case 'openai_image': {
              saveLastCommand(chatId, decision, { normalized });
              try {
                await sendAck(chatId, { type: 'openai_image' });
                console.log('🎨 ACK sent for openai_image, starting generation...');
                
                const imageResult = await generateOpenAIImage(prompt);
                console.log('🎨 OpenAI image generation result:', imageResult.success ? 'SUCCESS' : 'FAILED');
                
                if (imageResult.success && imageResult.imageUrl) {
                  const fileName = `openai_image_${Date.now()}.png`;
                  const caption = imageResult.description || '';
                  await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
                  console.log('🎨 OpenAI image sent successfully to WhatsApp');
                } else {
                  await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
                  console.log('🎨 OpenAI error message sent:', imageResult.error);
                }
              } catch (imageError) {
                console.error('❌ Error in openai_image case:', imageError);
                await sendTextMessage(chatId, `❌ שגיאה ביצירת התמונה: ${imageError.message}`);
              }
              return;
            }
            
            case 'grok_image': {
              saveLastCommand(chatId, decision, { normalized });
              try {
                // Grok doesn't have image generation - fallback to Gemini
                await sendAck(chatId, { type: 'grok_image' });
                console.log('🎨 ACK sent for grok_image (fallback to Gemini), starting generation...');
                
                const imageResult = await generateImageForWhatsApp(prompt);
                console.log('🎨 Grok->Gemini image generation result:', imageResult.success ? 'SUCCESS' : 'FAILED');
                
                if (imageResult.success && imageResult.imageUrl) {
                  const fileName = `gemini_image_${Date.now()}.png`;
                  await sendFileByUrl(chatId, imageResult.imageUrl, fileName, imageResult.description || '');
                  console.log('🎨 Grok->Gemini image sent successfully to WhatsApp');
                } else {
                  await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
                  console.log('🎨 Grok->Gemini error message sent:', imageResult.error);
                }
              } catch (imageError) {
                console.error('❌ Error in grok_image case:', imageError);
                await sendTextMessage(chatId, `❌ שגיאה ביצירת התמונה: ${imageError.message}`);
              }
              return;
            }
            
            // ═══════════════════ VIDEO GENERATION ═══════════════════
            case 'veo3_video': {
              await sendAck(chatId, { type: 'veo3_video' });
              const videoResult = await generateVideoForWhatsApp(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                await sendFileByUrl(chatId, videoResult.videoUrl, `veo3_video_${Date.now()}.mp4`, '');
              } else {
                await sendTextMessage(chatId, `❌ ${videoResult.error || 'לא הצלחתי ליצור וידאו'}`);
              }
              return;
            }
            
            case 'kling_text_to_video': {
              await sendAck(chatId, { type: 'kling_text_to_video' });
              const videoResult = await generateKlingVideoFromText(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                const fileName = videoResult.fileName || `kling_video_${Date.now()}.mp4`;
                await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
              } else {
                await sendTextMessage(chatId, `❌ ${videoResult.error || 'לא הצלחתי ליצור וידאו'}`);
              }
              return;
            }
            
            // ═══════════════════ IMAGE/VIDEO EDITING ═══════════════════
            case 'veo3_image_to_video':
            case 'kling_image_to_video':
              saveLastCommand(chatId, decision, { imageUrl, normalized });
              // Use imageUrl (from quoted message or current message)
              if (hasImage) {
                const service = decision.tool === 'veo3_image_to_video' ? 'veo3' : 'kling';
                const finalImageUrl = imageUrl || (messageData.fileMessageData || messageData.imageMessageData)?.downloadUrl;
                processImageToVideoAsync({
                  chatId, senderId, senderName,
                  imageUrl: finalImageUrl,
                  prompt: prompt,
                  service: service
                });
              }
              return;
              
            case 'image_edit':
              saveLastCommand(chatId, decision, { imageUrl, normalized });
              // Use imageUrl (from quoted message or current message)
              if (hasImage) {
                const service = decision.args?.service || 'gemini';
                const finalImageUrl = imageUrl || (messageData.fileMessageData || messageData.imageMessageData)?.downloadUrl;
                processImageEditAsync({
                  chatId, senderId, senderName,
                  imageUrl: finalImageUrl,
                  prompt: decision.args.prompt || prompt,
                  service: service
                });
              }
              return;
              
            case 'video_to_video':
              saveLastCommand(chatId, decision, { videoUrl, normalized });
              // Use videoUrl (from quoted message or current message)
              if (hasVideo) {
                const finalVideoUrl = videoUrl || (messageData.fileMessageData || messageData.videoMessageData)?.downloadUrl;
                processVideoToVideoAsync({
                  chatId, senderId, senderName,
                  videoUrl: finalVideoUrl,
                  prompt: decision.args?.prompt || prompt
                });
              }
              return;
            
            // ═══════════════════ TEXT-TO-SPEECH ═══════════════════
            case 'text_to_speech': {
              await sendAck(chatId, { type: 'text_to_speech' });
              
              // Parse the TTS request to check if translation is needed
              const originalText = decision.args?.text || prompt;
              const parseResult = await parseTextToSpeechRequest(originalText);
              
              let textToSpeak = parseResult.text;
              let targetLanguageCode = parseResult.languageCode;
              
              // If translation is needed, translate the text first
              if (parseResult.needsTranslation && parseResult.targetLanguage) {
                console.log(`🌐 Translation requested to ${parseResult.targetLanguage}`);
                const translationResult = await translateText(parseResult.text, parseResult.targetLanguage);
                
                if (translationResult.success) {
                  textToSpeak = translationResult.translatedText;
                  console.log(`✅ Using translated text: "${textToSpeak}"`);
                } else {
                  await sendTextMessage(chatId, `❌ ${translationResult.error}`);
                  return;
                }
              } else {
                // No translation needed - detect language from original text
                targetLanguageCode = voiceService.detectLanguage(textToSpeak);
              }
              
              // Get appropriate voice for the target language
              const voiceResult = await voiceService.getVoiceForLanguage(targetLanguageCode);
              if (voiceResult.error) {
                await sendTextMessage(chatId, `❌ שגיאה בבחירת קול: ${voiceResult.error}`);
                return;
              }
              
              const voiceId = voiceResult.voiceId;
              const ttsResult = await voiceService.textToSpeech(voiceId, textToSpeak, {
                modelId: 'eleven_v3',
                outputFormat: 'mp3_44100_128',
                languageCode: targetLanguageCode
              });
              
              if (!ttsResult.error) {
                const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');
                if (conversionResult.success) {
                  await sendFileByUrl(chatId, getStaticFileUrl(conversionResult.fileName), conversionResult.fileName, '');
                } else {
                  const fallbackUrl = ttsResult.audioUrl.startsWith('http') ? ttsResult.audioUrl : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
                  await sendFileByUrl(chatId, fallbackUrl, `tts_${Date.now()}.mp3`, '');
                }
              } else {
                await sendTextMessage(chatId, `❌ ${ttsResult.error}`);
              }
              return;
            }
            
            // ═══════════════════ MUSIC GENERATION ═══════════════════
            case 'music_generation': {
              // Parse music request to check if video is requested
              const musicParsing = await parseMusicRequest(prompt);
              const cleanMusicPrompt = musicParsing.cleanPrompt || prompt;
              const wantsVideo = musicParsing.wantsVideo || false;
              
              // Send customized ACK based on whether video is requested
              const ackMsg = wantsVideo 
                ? '🎵🎬 קיבלתי! מתחיל יצירת שיר עם קליפ/וידאו באמצעות Suno AI... 🎶'
                : '🎵 קיבלתי! מתחיל יצירת שיר עם Suno AI... 🎶';
              await sendTextMessage(chatId, ackMsg);
              
              const musicResult = await generateMusicWithLyrics(cleanMusicPrompt, {
                callbackUrl: null,
                whatsappContext: { chatId, senderId, senderName },
                makeVideo: wantsVideo
              });
              if (musicResult.error) {
                await sendTextMessage(chatId, `❌ ${musicResult.error}`);
              } else if (musicResult.message) {
                await sendTextMessage(chatId, musicResult.message);
              }
              return;
            }
            
            // ═══════════════════ POLL CREATION ═══════════════════
            case 'create_poll': {
              saveLastCommand(chatId, decision, { normalized });
              await sendAck(chatId, { type: 'create_poll' });
              
              // Extract topic from prompt (remove "צור סקר על/בנושא" etc.)
              let topic = prompt
                .replace(/^(צור|יצר|הכן|create|make)\s+(סקר|poll)\s+(על|בנושא|about)?\s*/i, '')
                .trim();
              
              if (!topic || topic.length < 2) {
                topic = prompt; // Use full prompt if extraction failed
              }
              
              const pollResult = await generateCreativePoll(topic);
              
              if (!pollResult.success) {
                await sendTextMessage(chatId, `❌ ${pollResult.error}`);
                return;
              }
              
              // Send the poll using Green API
              try {
                const pollOptions = [
                  { optionName: pollResult.option1 },
                  { optionName: pollResult.option2 }
                ];
                
                await sendPoll(chatId, pollResult.question, pollOptions, false);
                console.log(`✅ Poll sent successfully to ${chatId}`);
              } catch (pollError) {
                console.error('❌ Error sending poll:', pollError);
                await sendTextMessage(chatId, `❌ שגיאה בשליחת הסקר: ${pollError.message}`);
              }
              return;
            }
            
            // ═══════════════════ CHAT SUMMARY ═══════════════════
            case 'chat_summary': {
              await sendAck(chatId, { type: 'chat_summary' });
              const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
              if (!chatHistory || chatHistory.length === 0) {
                await sendTextMessage(chatId, '📝 אין מספיק הודעות בשיחה');
                return;
              }
              const summaryResult = await generateChatSummary(chatHistory);
              if (!summaryResult.error) {
                await sendTextMessage(chatId, `📝 **סיכום השיחה:**\n\n${summaryResult.text}`);
              } else {
                await sendTextMessage(chatId, `❌ ${summaryResult.error}`);
              }
              return;
            }
            
            // ═══════════════════ HELP / COMMAND LIST ═══════════════════
            case 'show_help': {
              const helpText = `
🤖 **מערכת AI מתקדמת**

**פקודות AI (מתחילות ב-"# "):**
• # היי - שיחה עם Gemini
• # צור תמונה של... - יצירת תמונה
• # צור וידאו של... - יצירת וידאו
• # צור שיר על... - יצירת מוזיקה
• # המר לדיבור: טקסט - Text-to-Speech
• # סכם שיחה - סיכום השיחה
• # צור סקר על/בנושא... - יצירת סקר עם חרוזים
• # נסה שוב / # שוב - ביצוע מחדש פקודה אחרונה
• # צור/פתח/הקם קבוצה בשם "שם" עם שם1, שם2 - יצירת קבוצה
• (אופציה) + עם תמונה של... - הוספת תמונת פרופיל
• תמונה + # ערוך... - עריכת תמונה
• וידאו + # ערוך... - עריכת וידאו
• הודעה קולית - תמלול ותשובה קולית

**פקודות ניהול:**
• הצג היסטוריה - הצגת היסטוריית השיחה
• סטטוס יצירה - הרשאות יצירת מדיה
• הוסף ליצירה [שם] - הוסף הרשאת מדיה
• הסר מיצירה [שם] - הסר הרשאת מדיה
• סטטוס קבוצות - הרשאות יצירת קבוצות
• הוסף לקבוצות [שם] - הוסף הרשאת קבוצות
• הסר מקבוצות [שם] - הסר הרשאת קבוצות
• עדכן אנשי קשר - סנכרון אנשי קשר
              `;
              await sendTextMessage(chatId, helpText.trim());
              return;
            }
            
            // ═══════════════════ IMAGE/VIDEO GENERATION FROM TEXT ═══════════════════
            case 'veo3_image_to_video':
            case 'kling_image_to_video': {
              // These require an image - check if one was provided via quoted message
              if (hasImage && imageUrl) {
                const service = decision.tool === 'veo3_image_to_video' ? 'veo3' : 'kling';
                console.log(`🎬 ${service} image-to-video request from text command (incoming)`);
                processImageToVideoAsync({
                  chatId, senderId, senderName,
                  imageUrl: imageUrl,
                  prompt: prompt,
                  service: service
                });
              } else {
                await sendTextMessage(chatId, '❌ פקודה זו דורשת תמונה. אנא ענה על הודעה עם תמונה או שלח תמונה עם caption.');
              }
              return;
            }
            
            case 'veo3_video':
            case 'kling_text_to_video': {
              const service = decision.tool === 'veo3_video' ? 'veo3' : 'kling';
              console.log(`🎬 ${service} text-to-video request (incoming)`);
              await sendAck(chatId, { type: decision.tool });
              
              // Text-to-video
              const videoGenFunction = service === 'veo3' ? generateVideoForWhatsApp : generateKlingVideoFromText;
              const result = await videoGenFunction(prompt);
              
              if (result.error) {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              } else if (result.success && result.videoUrl) {
                const fullUrl = result.videoUrl.startsWith('http') ? result.videoUrl : getStaticFileUrl(result.videoUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullUrl, result.fileName, result.description || prompt);
              }
              return;
            }
            
            // ═══════════════════ CREATE GROUP ═══════════════════
            case 'create_group': {
              try {
                await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...');
                
                const { parseGroupCreationPrompt, resolveParticipants } = require('../services/groupService');
                const { createGroup, setGroupPicture } = require('../services/greenApiService');
                const { generateImageForWhatsApp } = require('../services/geminiService');
                
                // Step 1: Parse the prompt to extract group name, participants, and picture description
                await sendTextMessage(chatId, '🔍 מנתח את הבקשה...');
                const parsed = await parseGroupCreationPrompt(prompt);
                
                let statusMsg = `📋 שם הקבוצה: "${parsed.groupName}"\n👥 מחפש ${parsed.participants.length} משתתפים...`;
                if (parsed.groupPicture) {
                  statusMsg += `\n🎨 תמונה: ${parsed.groupPicture}`;
                }
                await sendTextMessage(chatId, statusMsg);
                
                // Step 2: Resolve participant names to WhatsApp IDs
                const resolution = await resolveParticipants(parsed.participants);
                
                // Check if we found all participants
                if (resolution.notFound.length > 0) {
                  let errorMsg = `⚠️ לא מצאתי את המשתתפים הבאים:\n`;
                  resolution.notFound.forEach(name => {
                    errorMsg += `• ${name}\n`;
                  });
                  errorMsg += `\n💡 טיפ: וודא שהשמות נכונים או הרץ "עדכן אנשי קשר" לסנכרון אנשי קשר`;
                  
                  if (resolution.resolved.length === 0) {
                    await sendTextMessage(chatId, errorMsg + '\n\n❌ לא נמצאו משתתפים - ביטול יצירת קבוצה');
                    return;
                  }
                  
                  await sendTextMessage(chatId, errorMsg);
                }
                
                // Step 3: Show found participants
                if (resolution.resolved.length > 0) {
                  let foundMsg = `✅ נמצאו ${resolution.resolved.length} משתתפים:\n`;
                  resolution.resolved.forEach(p => {
                    foundMsg += `• ${p.searchName} → ${p.contactName}\n`;
                  });
                  await sendTextMessage(chatId, foundMsg);
                }
                
                // Step 4: Create the group
                await sendTextMessage(chatId, '🔨 יוצר את הקבוצה...');
                
                // Filter out the current user (group creator) - WhatsApp adds them automatically
                const participantIds = resolution.resolved
                  .map(p => p.contactId)
                  .filter(id => id !== senderId); // Remove group creator from participants list
                
                if (participantIds.length === 0) {
                  await sendTextMessage(chatId, '⚠️ לא נמצאו משתתפים נוספים (חוץ ממך). צריך לפחות משתתף אחד נוסף ליצירת קבוצה.');
                  return;
                }
                
                console.log(`👥 Final participants (excluding creator ${senderId}): ${participantIds.join(', ')}`);
                const groupResult = await createGroup(parsed.groupName, participantIds);
                
                // Step 5: Generate and set group picture if requested
                if (parsed.groupPicture && groupResult.chatId) {
                  try {
                    await sendTextMessage(chatId, `🎨 יוצר תמונת פרופיל לקבוצה...\n"${parsed.groupPicture}"`);
                    
                    // Generate image with Gemini
                    const imageResult = await generateImageForWhatsApp(parsed.groupPicture);
                    
                    if (imageResult.success && imageResult.fileName) {
                      // Read the generated image file
                      const fs = require('fs');
                      const path = require('path');
                      const imagePath = path.join(__dirname, '..', 'public', 'tmp', imageResult.fileName);
                      const imageBuffer = fs.readFileSync(imagePath);
                      
                      // Set as group picture
                      await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...');
                      const pictureResult = await setGroupPicture(groupResult.chatId, imageBuffer);
                      
                      if (pictureResult.setGroupPicture) {
                        await sendTextMessage(chatId, '✅ תמונת הקבוצה הועלתה בהצלחה!');
                      } else {
                        await sendTextMessage(chatId, `⚠️ לא הצלחתי להעלות תמונה: ${pictureResult.reason || 'סיבה לא ידועה'}`);
                      }
                      
                      // Clean up the image file
                      try {
                        fs.unlinkSync(imagePath);
                        console.log(`🧹 Cleaned up group picture file: ${imageResult.fileName}`);
                      } catch (cleanupError) {
                        console.warn('⚠️ Could not clean up group picture file:', cleanupError.message);
                      }
                    } else {
                      await sendTextMessage(chatId, `⚠️ לא הצלחתי ליצור תמונה: ${imageResult.error || 'שגיאה לא ידועה'}`);
                    }
                  } catch (pictureError) {
                    console.error('❌ Error setting group picture:', pictureError);
                    await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה אבל לא הצלחתי להוסיף תמונה: ${pictureError.message}`);
                  }
                }
                
                // Step 6: Success!
                const successMsg = `✅ הקבוצה "${parsed.groupName}" נוצרה בהצלחה! 🎉\n\n👥 ${participantIds.length + 1} משתתפים בקבוצה (כולל אתה)`;
                await sendTextMessage(chatId, successMsg);
                
                console.log(`✅ Group created successfully by ${senderName}: "${parsed.groupName}" with ${participantIds.length} other participants${parsed.groupPicture ? ' (with picture)' : ''}`);
                
              } catch (error) {
                console.error('❌ Error creating group:', error);
                await sendTextMessage(chatId, `❌ שגיאה ביצירת הקבוצה: ${error.message}\n\n💡 וודא שהפורמט נכון, לדוגמה:\n# צור/פתח/הקם קבוצה בשם "שם הקבוצה" עם שם1, שם2, שם3\n# צור קבוצה בשם "שם" עם שם1, שם2 עם תמונה של חתול`);
              }
              return;
            }
            
            case 'voice_processing':
            case 'creative_voice_processing':
              // Voice messages are handled by separate block below
              break;
              
            default:
              console.log(`⚠️ Unknown tool from router: ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unknown tool from router: ${decision.tool}`);
              break;
          }
        } catch (toolError) {
          console.error(`❌ Error executing tool ${decision.tool}:`, toolError);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${toolError.message || toolError}`);
        }
      } catch (routerError) {
        console.error('❌ Intent router error:', routerError.message || routerError);
        await sendTextMessage(chatId, `❌ שגיאה בניתוב הבקשה: ${routerError.message || routerError}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Handle IMAGE messages with caption starting with "# "
    // ═══════════════════════════════════════════════════════════════
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      if (/^#\s+/.test(caption.trim())) {
        try {
          const normalized = {
            userText: caption.trim(),
            hasImage: true,
            hasVideo: false,
            hasAudio: false,
            chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
            language: 'he',
            authorizations: {
              media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
              // group_creation will be checked only if user requests group creation (lazy evaluation)
              group_creation: null,
              voice_allowed: false
            },
            // Pass sender data for lazy authorization checks
            senderData: { senderContactName, chatName, senderName, chatId }
          };

          const decision = await routeIntent(normalized);
          const prompt = normalized.userText.replace(/^#\s+/, '').trim();

          // Handle router decision for images
          switch (decision.tool) {
            case 'deny_unauthorized':
              await sendUnauthorizedMessage(chatId, decision.args?.feature || 'media');
              return;
              
            case 'image_edit': {
              const service = decision.args?.service || 'gemini';
              console.log(`🎨 ${service} image edit request (via router)`);
              processImageEditAsync({
                chatId, senderId, senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args?.prompt || prompt,
                service: service
              });
              return;
            }
            
            case 'veo3_video':
            case 'veo3_image_to_video':
            case 'kling_text_to_video':
            case 'kling_image_to_video': {
              const service = (decision.tool === 'veo3_video' || decision.tool === 'veo3_image_to_video') ? 'veo3' : 'kling';
              console.log(`🎬 ${service} image-to-video request (via router)`);
              processImageToVideoAsync({
                chatId, senderId, senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args?.prompt || prompt,
                service: service
              });
              return;
            }
            
            case 'gemini_chat': {
              await sendAck(chatId, { type: 'gemini_chat' });
              // Image analysis - use analyzeImageWithText
              const { analyzeImageWithText } = require('../services/geminiService');
              try {
                // Download and convert image to base64
                const imageBuffer = await downloadFile(imageData.downloadUrl);
                const base64Image = imageBuffer.toString('base64');
                
                const result = await analyzeImageWithText(prompt, base64Image);
                if (result.success) {
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              } catch (error) {
                await sendTextMessage(chatId, `❌ שגיאה בניתוח התמונה: ${error.message}`);
              }
              return;
            }
            
            default:
              console.log(`⚠️ Unexpected tool for image: ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unexpected tool for image: ${decision.tool}`);
              return;
          }
        } catch (error) {
          console.error('❌ Error routing image message:', error);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד התמונה: ${error.message || error}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // Handle VIDEO messages with caption starting with "# "
    // ═══════════════════════════════════════════════════════════════
    else if (messageData.typeMessage === 'videoMessage') {
      const videoData = messageData.fileMessageData || messageData.videoMessageData;
      const caption = videoData?.caption || '';
      
      if (/^#\s+/.test(caption.trim())) {
        try {
          const normalized = {
            userText: caption.trim(),
            hasImage: false,
            hasVideo: true,
            hasAudio: false,
            chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
            language: 'he',
            authorizations: {
              media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
              // group_creation will be checked only if user requests group creation (lazy evaluation)
              group_creation: null,
              voice_allowed: false
            },
            // Pass sender data for lazy authorization checks
            senderData: { senderContactName, chatName, senderName, chatId }
          };

          const decision = await routeIntent(normalized);
          const prompt = normalized.userText.replace(/^#\s+/, '').trim();

          // Handle router decision for videos
          switch (decision.tool) {
            case 'deny_unauthorized':
              await sendUnauthorizedMessage(chatId, decision.args?.feature || 'media');
              return;
              
            case 'gemini_chat': {
              await sendAck(chatId, { type: 'gemini_chat' });
              // Video analysis - use analyzeVideoWithText
              const { analyzeVideoWithText } = require('../services/geminiService');
              try {
                // Download video buffer
                const videoBuffer = await downloadFile(videoData.downloadUrl);
                
                const result = await analyzeVideoWithText(prompt, videoBuffer);
                if (result.success) {
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              } catch (error) {
                await sendTextMessage(chatId, `❌ שגיאה בניתוח הוידאו: ${error.message}`);
              }
              return;
            }
            
            case 'video_to_video': {
              console.log(`🎬 RunwayML Gen4 video-to-video request (via router)`);
              processVideoToVideoAsync({
                chatId, senderId, senderName,
                videoUrl: videoData.downloadUrl,
                prompt: decision.args?.prompt || prompt
              });
              return;
            }
            
            default:
              console.log(`⚠️ Unexpected tool for video: ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unexpected tool for video: ${decision.tool}`);
              return;
          }
        } catch (error) {
          console.error('❌ Error routing video message:', error);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד הווידאו: ${error.message || error}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // Handle voice messages for voice-to-voice processing
    // ═══════════════════════════════════════════════════════════════
    else if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage') {
      const audioData = messageData.fileMessageData || messageData.audioMessageData;
      
      console.log(`🎤 Voice message received`);
      
      try {
        // Check if sender is authorized for voice transcription
        // Checks both group AND individual sender (if in group)
        const isAuthorized = await conversationManager.isAuthorizedForVoiceTranscription({ senderContactName, chatName, senderName, chatId });
        
        if (!isAuthorized) {
          console.log(`🚫 Voice processing not allowed - not authorized`);
          // Silently ignore unauthorized voice messages (no reply)
          return;
        }
        
        console.log(`✅ Voice processing authorized - proceeding with voice-to-voice flow`);
      } catch (dbError) {
        console.error('❌ Error checking voice transcription authorization:', dbError);
        console.log(`🔇 Skipping voice processing due to database error`);
        return;
      }
      
      // Process voice-to-voice asynchronously
      processVoiceMessageAsync({
        chatId,
        senderId,
        senderName,
        audioUrl: audioData.downloadUrl
      });
    } else if (messageText && !messageText.startsWith('#')) {
      // Non-"#" text messages - handle management commands only
      const command = parseTextCommand(messageText);
      if (command) {
        await handleManagementCommand(command, chatId, senderId, senderName, senderContactName, chatName);
      } else {
        console.log(`ℹ️ Text message without '# ' prefix - ignored (not a management command)`);
      }
    } else {
      console.log(`ℹ️ Unsupported message type: ${messageData.typeMessage}`);
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
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected (outgoing): "${messageText}"`);
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
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
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
        const quotedMessage = messageData.quotedMessage;
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let imageUrl = null;
        let videoUrl = null;
        
        if (quotedMessage && quotedMessage.stanzaId) {
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
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
        }

        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage',
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            // Outgoing bypasses authorization in existing logic, but router still expects booleans
            media_creation: true,
            group_creation: true,
            voice_allowed: true
          }
        };

        const decision = await routeIntent(normalized);
        const rawPrompt = decision.args?.prompt || finalPrompt;
        // Clean prompt from provider mentions before sending to services
        const prompt = cleanPromptFromProviders(rawPrompt);

        // Router-based direct execution for outgoing messages (same as incoming)
        try {
          switch (decision.tool) {
            // ═══════════════════ CHAT ═══════════════════
            case 'gemini_chat': {
              await sendAck(chatId, { type: 'gemini_chat' });
              
              // Check if this is image analysis (hasImage = true)
              if (normalized.hasImage) {
                // This is image analysis - use analyzeImageWithText
                const { analyzeImageWithText } = require('../services/geminiService');
                
                try {
                  // Get image URL (either from quoted message or current message)
                  const finalImageUrl = imageUrl || messageData.fileMessageData?.downloadUrl || messageData.imageMessageData?.downloadUrl;
                  if (!finalImageUrl) {
                    await sendTextMessage(chatId, '❌ לא הצלחתי לקבל את התמונה לניתוח');
                    return;
                  }
                  
                  // Download and convert to base64
                  const downloadedBuffer = await downloadFile(finalImageUrl);
                  const base64Image = downloadedBuffer.toString('base64');
                  
                  // Check if user wants to reference previous messages
                  let finalPromptOutgoingImage = prompt;
                  if (decision.args?.needsChatHistory) {
                    try {
                      console.log(`📜 User requested chat history context for image analysis (outgoing), fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                      const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                      
                      if (chatHistory && chatHistory.length > 0) {
                        const formattedHistory = formatChatHistoryForContext(chatHistory);
                        finalPromptOutgoingImage = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                        console.log(`✅ Added ${chatHistory.length} messages as context to image analysis (outgoing)`);
                      }
                    } catch (historyError) {
                      console.error('❌ Error fetching chat history:', historyError);
                    }
                  }
                  
                  const result = await analyzeImageWithText(finalPromptOutgoingImage, base64Image);
                  if (result.success) {
                    await sendTextMessage(chatId, result.text);
                  } else {
                    await sendTextMessage(chatId, `❌ ${result.error}`);
                  }
                } catch (error) {
                  await sendTextMessage(chatId, `❌ שגיאה בניתוח התמונה: ${error.message}`);
                }
              } else if (normalized.hasVideo) {
                // This is video analysis - use analyzeVideoWithText
                const { analyzeVideoWithText } = require('../services/geminiService');
                
                try {
                  // Get video URL (either from quoted message or current message)
                  const finalVideoUrl = videoUrl || messageData.fileMessageData?.downloadUrl || messageData.videoMessageData?.downloadUrl;
                  if (!finalVideoUrl) {
                    await sendTextMessage(chatId, '❌ לא הצלחתי לקבל את הוידאו לניתוח');
                    return;
                  }
                  
                  // Download video buffer
                  const videoBuffer = await downloadFile(finalVideoUrl);
                  
                  // Check if user wants to reference previous messages
                  let finalPromptOutgoingVideo = prompt;
                  if (decision.args?.needsChatHistory) {
                    try {
                      console.log(`📜 User requested chat history context for video analysis (outgoing), fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                      const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                      
                      if (chatHistory && chatHistory.length > 0) {
                        const formattedHistory = formatChatHistoryForContext(chatHistory);
                        finalPromptOutgoingVideo = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                        console.log(`✅ Added ${chatHistory.length} messages as context to video analysis (outgoing)`);
                      }
                    } catch (historyError) {
                      console.error('❌ Error fetching chat history:', historyError);
                    }
                  }
                  
                  const result = await analyzeVideoWithText(finalPromptOutgoingVideo, videoBuffer);
                  if (result.success) {
                    await sendTextMessage(chatId, result.text);
                  } else {
                    await sendTextMessage(chatId, `❌ ${result.error}`);
                  }
                } catch (error) {
                  await sendTextMessage(chatId, `❌ שגיאה בניתוח הוידאו: ${error.message}`);
                }
              } else {
                // Regular text chat
                let finalPromptOutgoing = prompt;
                
                // Check if user wants to reference previous messages in the chat/group
                if (decision.args?.needsChatHistory) {
                  try {
                    console.log(`📜 User requested chat history context (outgoing), fetching last ${CHAT_HISTORY_LIMIT} messages...`);
                    const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
                    
                    if (chatHistory && chatHistory.length > 0) {
                      const formattedHistory = formatChatHistoryForContext(chatHistory);
                      
                      // Prepend chat history to the prompt
                      finalPromptOutgoing = `להלן ההודעות האחרונות בשיחה/קבוצה:\n\n${formattedHistory}\n\nבהתבסס על ההודעות לעיל, ${prompt}`;
                      console.log(`✅ Added ${chatHistory.length} messages as context to prompt (outgoing)`);
                    } else {
                      console.log('⚠️ No chat history available, proceeding without context');
                    }
                  } catch (historyError) {
                    console.error('❌ Error fetching chat history:', historyError);
                    // Continue without history if fetch fails
                  }
                }
                
                const contextMessages = await conversationManager.getConversationHistory(chatId);
                await conversationManager.addMessage(chatId, 'user', finalPromptOutgoing);
                const result = await generateGeminiResponse(finalPromptOutgoing, contextMessages);
                if (!result.error) {
                  await conversationManager.addMessage(chatId, 'assistant', result.text);
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              }
              return;
            }
            case 'openai_chat': {
              await sendAck(chatId, { type: 'openai_chat' });
              const contextMessages = await conversationManager.getConversationHistory(chatId);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateOpenAIResponse(prompt, contextMessages);
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              }
              return;
            }
            case 'grok_chat': {
              await sendAck(chatId, { type: 'grok_chat' });
              // Note: Grok doesn't use conversation history (causes issues)
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGrokResponse(prompt, []);
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              }
              return;
            }
            
            // ═══════════════════ IMAGE GENERATION ═══════════════════
            case 'gemini_image': {
              await sendAck(chatId, { type: 'gemini_image' });
              const imageResult = await generateImageForWhatsApp(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `gemini_image_${Date.now()}.png`, imageResult.description || '');
              } else {
                await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
              }
              return;
            }
            case 'openai_image': {
              await sendAck(chatId, { type: 'openai_image' });
              const imageResult = await generateOpenAIImage(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `openai_image_${Date.now()}.png`, imageResult.description || '');
              } else {
                await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
              }
              return;
            }
            case 'grok_image': {
              await sendAck(chatId, { type: 'grok_image' });
              const imageResult = await generateGrokImage(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `grok_image_${Date.now()}.png`, imageResult.description || '');
              } else {
                await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
              }
              return;
            }
            
            // ═══════════════════ VIDEO GENERATION ═══════════════════
            case 'veo3_video': {
              await sendAck(chatId, { type: 'veo3_video' });
              const videoResult = await generateVideoForWhatsApp(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                await sendFileByUrl(chatId, videoResult.videoUrl, `veo3_video_${Date.now()}.mp4`, '');
              } else {
                await sendTextMessage(chatId, `❌ ${videoResult.error || 'לא הצלחתי ליצור וידאו'}`);
              }
              return;
            }
            case 'kling_text_to_video': {
              await sendAck(chatId, { type: 'kling_text_to_video' });
              const videoResult = await generateKlingVideoFromText(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                await sendFileByUrl(chatId, videoResult.videoUrl, videoResult.fileName || `kling_video_${Date.now()}.mp4`, '');
              } else {
                await sendTextMessage(chatId, `❌ ${videoResult.error || 'לא הצלחתי ליצור וידאו'}`);
              }
              return;
            }
            
            // ═══════════════════ IMAGE/VIDEO EDITING ═══════════════════
            case 'image_edit':
              if (hasImage) {
                const service = decision.args?.service || 'gemini';
                const finalImageUrl = imageUrl || (messageData.fileMessageData || messageData.imageMessageData)?.downloadUrl;
                processImageEditAsync({
                  chatId, senderId, senderName,
                  imageUrl: finalImageUrl,
                  prompt: decision.args.prompt || prompt,
                  service: service
                });
              }
              return;
              
            case 'video_to_video':
              if (hasVideo) {
                const finalVideoUrl = videoUrl || (messageData.fileMessageData || messageData.videoMessageData)?.downloadUrl;
                processVideoToVideoAsync({
                  chatId, senderId, senderName,
                  videoUrl: finalVideoUrl,
                  prompt: decision.args?.prompt || prompt
                });
              }
              return;
            
            // ═══════════════════ TEXT-TO-SPEECH ═══════════════════
            case 'text_to_speech': {
              await sendAck(chatId, { type: 'text_to_speech' });
              
              // Parse the TTS request to check if translation is needed
              const originalText = decision.args?.text || prompt;
              const parseResult = await parseTextToSpeechRequest(originalText);
              
              let textToSpeak = parseResult.text;
              let targetLanguageCode = parseResult.languageCode;
              
              // If translation is needed, translate the text first
              if (parseResult.needsTranslation && parseResult.targetLanguage) {
                console.log(`🌐 Translation requested to ${parseResult.targetLanguage}`);
                const translationResult = await translateText(parseResult.text, parseResult.targetLanguage);
                
                if (translationResult.success) {
                  textToSpeak = translationResult.translatedText;
                  console.log(`✅ Using translated text: "${textToSpeak}"`);
                } else {
                  await sendTextMessage(chatId, `❌ ${translationResult.error}`);
                  return;
                }
              } else {
                // No translation needed - detect language from original text
                targetLanguageCode = voiceService.detectLanguage(textToSpeak);
              }
              
              // Get appropriate voice for the target language
              const voiceResult = await voiceService.getVoiceForLanguage(targetLanguageCode);
              if (voiceResult.error) {
                await sendTextMessage(chatId, `❌ שגיאה בבחירת קול: ${voiceResult.error}`);
                return;
              }
              
              const voiceId = voiceResult.voiceId;
              const ttsResult = await voiceService.textToSpeech(voiceId, textToSpeak, {
                modelId: 'eleven_v3',
                outputFormat: 'mp3_44100_128',
                languageCode: targetLanguageCode
              });
              
              if (!ttsResult.error) {
                const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');
                if (conversionResult.success) {
                  await sendFileByUrl(chatId, getStaticFileUrl(conversionResult.fileName), conversionResult.fileName, '');
                } else {
                  const fallbackUrl = ttsResult.audioUrl.startsWith('http') ? ttsResult.audioUrl : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
                  await sendFileByUrl(chatId, fallbackUrl, `tts_${Date.now()}.mp3`, '');
                }
              } else {
                await sendTextMessage(chatId, `❌ ${ttsResult.error}`);
              }
              return;
            }
            
            // ═══════════════════ MUSIC GENERATION ═══════════════════
            case 'music_generation': {
              // Parse music request to check if video is requested
              const musicParsing = await parseMusicRequest(prompt);
              const cleanMusicPrompt = musicParsing.cleanPrompt || prompt;
              const wantsVideo = musicParsing.wantsVideo || false;
              
              // Send customized ACK based on whether video is requested
              const ackMsg = wantsVideo 
                ? '🎵🎬 קיבלתי! מתחיל יצירת שיר עם קליפ/וידאו באמצעות Suno AI... 🎶'
                : '🎵 קיבלתי! מתחיל יצירת שיר עם Suno AI... 🎶';
              await sendTextMessage(chatId, ackMsg);
              
              const musicResult = await generateMusicWithLyrics(cleanMusicPrompt, {
                callbackUrl: null,
                whatsappContext: { chatId, senderId, senderName },
                makeVideo: wantsVideo
              });
              if (musicResult.error) {
                await sendTextMessage(chatId, `❌ ${musicResult.error}`);
              } else if (musicResult.message) {
                await sendTextMessage(chatId, musicResult.message);
              }
              return;
            }
            
            // ═══════════════════ CHAT SUMMARY ═══════════════════
            case 'chat_summary': {
              await sendAck(chatId, { type: 'chat_summary' });
              const chatHistory = await getChatHistory(chatId, CHAT_HISTORY_LIMIT);
              if (chatHistory && chatHistory.length > 0) {
                const summaryResult = await generateChatSummary(chatHistory);
                if (!summaryResult.error) {
                  await sendTextMessage(chatId, `📝 **סיכום השיחה:**\n\n${summaryResult.text}`);
                }
              }
              return;
            }
            
            // ═══════════════════ HELP / COMMAND LIST ═══════════════════
            case 'show_help': {
              const helpText = `
🤖 **מערכת AI מתקדמת**

**פקודות AI (מתחילות ב-"# "):**
• # היי - שיחה עם Gemini
• # צור תמונה של... - יצירת תמונה
• # צור וידאו של... - יצירת וידאו
• # צור שיר על... - יצירת מוזיקה
• # המר לדיבור: טקסט - Text-to-Speech
• # סכם שיחה - סיכום השיחה
• # צור סקר על/בנושא... - יצירת סקר עם חרוזים
• # נסה שוב / # שוב - ביצוע מחדש פקודה אחרונה
• # צור/פתח/הקם קבוצה בשם "שם" עם שם1, שם2 - יצירת קבוצה
• (אופציה) + עם תמונה של... - הוספת תמונת פרופיל
• תמונה + # ערוך... - עריכת תמונה
• וידאו + # ערוך... - עריכת וידאו
• הודעה קולית - תמלול ותשובה קולית

**פקודות ניהול:**
• הצג היסטוריה - הצגת היסטוריית השיחה
• סטטוס יצירה - הרשאות יצירת מדיה
• הוסף ליצירה [שם] - הוסף הרשאת מדיה
• הסר מיצירה [שם] - הסר הרשאת מדיה
• סטטוס קבוצות - הרשאות יצירת קבוצות
• הוסף לקבוצות [שם] - הוסף הרשאת קבוצות
• הסר מקבוצות [שם] - הסר הרשאת קבוצות
• עדכן אנשי קשר - סנכרון אנשי קשר
              `;
              await sendTextMessage(chatId, helpText.trim());
              return;
            }
            
            // ═══════════════════ IMAGE/VIDEO GENERATION FROM TEXT ═══════════════════
            case 'veo3_image_to_video':
            case 'kling_image_to_video': {
              // These require an image - check if one was provided via quoted message
              if (hasImage && imageUrl) {
                const service = decision.tool === 'veo3_image_to_video' ? 'veo3' : 'kling';
                console.log(`🎬 ${service} image-to-video request from text command (outgoing)`);
                processImageToVideoAsync({
                  chatId, senderId, senderName,
                  imageUrl: imageUrl,
                  prompt: prompt,
                  service: service
                });
              } else {
                await sendTextMessage(chatId, '❌ פקודה זו דורשת תמונה. אנא ענה על הודעה עם תמונה או שלח תמונה עם caption.');
              }
              return;
            }
            
            case 'veo3_video':
            case 'kling_text_to_video': {
              const service = decision.tool === 'veo3_video' ? 'veo3' : 'kling';
              console.log(`🎬 ${service} text-to-video request (outgoing)`);
              await sendAck(chatId, { type: decision.tool });
              
              // Text-to-video
              const videoGenFunction = service === 'veo3' ? generateVideoForWhatsApp : generateKlingVideoFromText;
              const result = await videoGenFunction(prompt);
              
              if (result.error) {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              } else if (result.success && result.videoUrl) {
                const fullUrl = result.videoUrl.startsWith('http') ? result.videoUrl : getStaticFileUrl(result.videoUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullUrl, result.fileName, result.description || prompt);
              }
              return;
            }
            
            // ═══════════════════ CREATE GROUP (OUTGOING) ═══════════════════
            case 'create_group': {
              try {
                await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...');
                
                const { parseGroupCreationPrompt, resolveParticipants } = require('../services/groupService');
                const { createGroup, setGroupPicture } = require('../services/greenApiService');
                const { generateImageForWhatsApp } = require('../services/geminiService');
                
                // Step 1: Parse the prompt to extract group name, participants, and picture description
                await sendTextMessage(chatId, '🔍 מנתח את הבקשה...');
                const parsed = await parseGroupCreationPrompt(prompt);
                
                let statusMsg = `📋 שם הקבוצה: "${parsed.groupName}"\n👥 מחפש ${parsed.participants.length} משתתפים...`;
                if (parsed.groupPicture) {
                  statusMsg += `\n🎨 תמונה: ${parsed.groupPicture}`;
                }
                await sendTextMessage(chatId, statusMsg);
                
                // Step 2: Resolve participant names to WhatsApp IDs
                const resolution = await resolveParticipants(parsed.participants);
                
                // Check if we found all participants
                if (resolution.notFound.length > 0) {
                  let errorMsg = `⚠️ לא מצאתי את המשתתפים הבאים:\n`;
                  resolution.notFound.forEach(name => {
                    errorMsg += `• ${name}\n`;
                  });
                  errorMsg += `\n💡 טיפ: וודא שהשמות נכונים או הרץ "עדכן אנשי קשר" לסנכרון אנשי קשר`;
                  
                  if (resolution.resolved.length === 0) {
                    await sendTextMessage(chatId, errorMsg + '\n\n❌ לא נמצאו משתתפים - ביטול יצירת קבוצה');
                    return;
                  }
                  
                  await sendTextMessage(chatId, errorMsg);
                }
                
                // Step 3: Show found participants
                if (resolution.resolved.length > 0) {
                  let foundMsg = `✅ נמצאו ${resolution.resolved.length} משתתפים:\n`;
                  resolution.resolved.forEach(p => {
                    foundMsg += `• ${p.searchName} → ${p.contactName}\n`;
                  });
                  await sendTextMessage(chatId, foundMsg);
                }
                
                // Step 4: Create the group
                await sendTextMessage(chatId, '🔨 יוצר את הקבוצה...');
                
                // Filter out the current user (group creator) - WhatsApp adds them automatically
                const participantIds = resolution.resolved
                  .map(p => p.contactId)
                  .filter(id => id !== senderId); // Remove group creator from participants list
                
                if (participantIds.length === 0) {
                  await sendTextMessage(chatId, '⚠️ לא נמצאו משתתפים נוספים (חוץ ממך). צריך לפחות משתתף אחד נוסף ליצירת קבוצה.');
                  return;
                }
                
                console.log(`👥 Final participants (excluding creator ${senderId}): ${participantIds.join(', ')}`);
                const groupResult = await createGroup(parsed.groupName, participantIds);
                
                // Step 5: Generate and set group picture if requested
                if (parsed.groupPicture && groupResult.chatId) {
                  try {
                    await sendTextMessage(chatId, `🎨 יוצר תמונת פרופיל לקבוצה...\n"${parsed.groupPicture}"`);
                    
                    // Generate image with Gemini
                    const imageResult = await generateImageForWhatsApp(parsed.groupPicture);
                    
                    if (imageResult.success && imageResult.fileName) {
                      // Read the generated image file
                      const fs = require('fs');
                      const path = require('path');
                      const imagePath = path.join(__dirname, '..', 'public', 'tmp', imageResult.fileName);
                      const imageBuffer = fs.readFileSync(imagePath);
                      
                      // Set as group picture
                      await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...');
                      const pictureResult = await setGroupPicture(groupResult.chatId, imageBuffer);
                      
                      if (pictureResult.setGroupPicture) {
                        await sendTextMessage(chatId, '✅ תמונת הקבוצה הועלתה בהצלחה!');
                      } else {
                        await sendTextMessage(chatId, `⚠️ לא הצלחתי להעלות תמונה: ${pictureResult.reason || 'סיבה לא ידועה'}`);
                      }
                      
                      // Clean up the image file
                      try {
                        fs.unlinkSync(imagePath);
                        console.log(`🧹 Cleaned up group picture file: ${imageResult.fileName}`);
                      } catch (cleanupError) {
                        console.warn('⚠️ Could not clean up group picture file:', cleanupError.message);
                      }
                    } else {
                      await sendTextMessage(chatId, `⚠️ לא הצלחתי ליצור תמונה: ${imageResult.error || 'שגיאה לא ידועה'}`);
                    }
                  } catch (pictureError) {
                    console.error('❌ Error setting group picture:', pictureError);
                    await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה אבל לא הצלחתי להוסיף תמונה: ${pictureError.message}`);
                  }
                }
                
                // Step 6: Success!
                const successMsg = `✅ הקבוצה "${parsed.groupName}" נוצרה בהצלחה! 🎉\n\n👥 ${participantIds.length + 1} משתתפים בקבוצה (כולל אתה)`;
                await sendTextMessage(chatId, successMsg);
                
                console.log(`✅ Group created successfully by ${senderName}: "${parsed.groupName}" with ${participantIds.length} other participants${parsed.groupPicture ? ' (with picture)' : ''}`);
                
              } catch (error) {
                console.error('❌ Error creating group (outgoing):', error);
                await sendTextMessage(chatId, `❌ שגיאה ביצירת הקבוצה: ${error.message}\n\n💡 וודא שהפורמט נכון, לדוגמה:\n# צור/פתח/הקם קבוצה בשם "שם הקבוצה" עם שם1, שם2, שם3\n# צור קבוצה בשם "שם" עם שם1, שם2 עם תמונה של חתול`);
              }
              return;
            }
            
            default:
              console.log(`⚠️ Unknown tool from router (outgoing): ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unknown tool from router (outgoing): ${decision.tool}`);
              break;
          }
        } catch (toolError) {
          console.error(`❌ Error executing tool ${decision.tool} (outgoing):`, toolError);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${toolError.message || toolError}`);
        }
      } catch (routerError) {
        console.error('❌ Intent router (outgoing text) error:', routerError.message || routerError);
        await sendTextMessage(chatId, `❌ שגיאה בניתוב הבקשה: ${routerError.message || routerError}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Handle IMAGE messages with caption starting with "# " (OUTGOING)
    // ═══════════════════════════════════════════════════════════════
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      if (/^#\s+/.test(caption.trim())) {
        try {
          // Extract the prompt (remove "# " prefix)
          const basePrompt = caption.trim().replace(/^#\s+/, '').trim();
          
          // Check if this is a quoted/replied message
          const quotedMessage = messageData.quotedMessage;
          let finalPrompt = basePrompt;
          let hasImage = true; // Current message is image
          let hasVideo = false;
          let imageUrl = imageData.downloadUrl; // Start with current image
          let videoUrl = null;
          
          if (quotedMessage && quotedMessage.stanzaId) {
            console.log(`🔗 Outgoing Image: Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
            
            // Handle quoted message - merge content
            const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
            
            // Check if there was an error processing the quoted message
            if (quotedResult.error) {
              await sendTextMessage(chatId, quotedResult.error);
              return;
            }
            
            finalPrompt = quotedResult.prompt;
            // Note: hasImage stays true for current message, but we might override with quoted
            if (quotedResult.hasImage || quotedResult.hasVideo) {
              // Quoted message has media - use that instead
              hasImage = quotedResult.hasImage;
              hasVideo = quotedResult.hasVideo;
              imageUrl = quotedResult.imageUrl;
              videoUrl = quotedResult.videoUrl;
            }
          }
          
          const normalized = {
            userText: `# ${finalPrompt}`,
            hasImage: hasImage,
            hasVideo: hasVideo,
            hasAudio: false,
            chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
            language: 'he',
            authorizations: { media_creation: true, group_creation: true, voice_allowed: true } // Outgoing = admin
          };

          const decision = await routeIntent(normalized);
          const prompt = normalized.userText.replace(/^#\s+/, '').trim();

          switch (decision.tool) {
            case 'image_edit': {
              const service = decision.args?.service || 'gemini';
              console.log(`🎨 ${service} image edit request (outgoing, via router)`);
              processImageEditAsync({
                chatId, senderId, senderName,
                imageUrl: imageUrl, // Use the URL (either from current message or quoted)
                prompt: decision.args?.prompt || prompt,
                service: service
              });
              return;
            }
            
            case 'veo3_video':
            case 'veo3_image_to_video':
            case 'kling_text_to_video':
            case 'kling_image_to_video': {
              const service = (decision.tool === 'veo3_video' || decision.tool === 'veo3_image_to_video') ? 'veo3' : 'kling';
              console.log(`🎬 ${service} image-to-video request (outgoing, via router)`);
              processImageToVideoAsync({
                chatId, senderId, senderName,
                imageUrl: imageUrl, // Use the URL (either from current message or quoted)
                prompt: decision.args?.prompt || prompt,
                service: service
              });
              return;
            }
            
            case 'gemini_chat': {
              await sendAck(chatId, { type: 'gemini_chat' });
              // Image analysis - use analyzeImageWithText
              const { analyzeImageWithText } = require('../services/geminiService');
              try {
                // Download the image from URL
                const imageBuffer = await downloadFile(imageUrl);
                const base64Image = imageBuffer.toString('base64');
                
                const result = await analyzeImageWithText(prompt, base64Image);
                if (result.success) {
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              } catch (error) {
                await sendTextMessage(chatId, `❌ שגיאה בניתוח התמונה: ${error.message}`);
              }
              return;
            }
            
            default:
              console.log(`⚠️ Unexpected tool for image (outgoing): ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unexpected tool for image (outgoing): ${decision.tool}`);
              return;
          }
        } catch (error) {
          console.error('❌ Error routing outgoing image message:', error);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד התמונה: ${error.message || error}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // Handle VIDEO messages with caption starting with "# " (OUTGOING)
    // ═══════════════════════════════════════════════════════════════
    else if (messageData.typeMessage === 'videoMessage') {
      const videoData = messageData.fileMessageData || messageData.videoMessageData;
      const caption = videoData?.caption || '';
      
      if (/^#\s+/.test(caption.trim())) {
        try {
          // Extract the prompt (remove "# " prefix)
          const basePrompt = caption.trim().replace(/^#\s+/, '').trim();
          
          // Check if this is a quoted/replied message
          const quotedMessage = messageData.quotedMessage;
          let finalPrompt = basePrompt;
          let hasImage = false;
          let hasVideo = true; // Current message is video
          let imageUrl = null;
          let videoUrl = videoData.downloadUrl; // Start with current video
          
          if (quotedMessage && quotedMessage.stanzaId) {
            console.log(`🔗 Outgoing Video: Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
            
            // Handle quoted message - merge content
            const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
            
            // Check if there was an error processing the quoted message
            if (quotedResult.error) {
              await sendTextMessage(chatId, quotedResult.error);
              return;
            }
            
            finalPrompt = quotedResult.prompt;
            // Note: hasVideo stays true for current message, but we might override with quoted
            if (quotedResult.hasImage || quotedResult.hasVideo) {
              // Quoted message has media - use that instead
              hasImage = quotedResult.hasImage;
              hasVideo = quotedResult.hasVideo;
              imageUrl = quotedResult.imageUrl;
              videoUrl = quotedResult.videoUrl;
            }
          }
          
          const normalized = {
            userText: `# ${finalPrompt}`,
            hasImage: hasImage,
            hasVideo: hasVideo,
            hasAudio: false,
            chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
            language: 'he',
            authorizations: { media_creation: true, group_creation: true, voice_allowed: true } // Outgoing = admin
          };

          const decision = await routeIntent(normalized);
          const prompt = decision.args?.prompt || finalPrompt;

          switch (decision.tool) {
            case 'gemini_chat': {
              await sendAck(chatId, { type: 'gemini_chat' });
              // Video analysis - use analyzeVideoWithText
              const { analyzeVideoWithText } = require('../services/geminiService');
              try {
                // Download the video from URL
                const videoBuffer = await downloadFile(videoUrl);
                
                const result = await analyzeVideoWithText(prompt, videoBuffer);
                if (result.success) {
                  await sendTextMessage(chatId, result.text);
                } else {
                  await sendTextMessage(chatId, `❌ ${result.error}`);
                }
              } catch (error) {
                await sendTextMessage(chatId, `❌ שגיאה בניתוח הוידאו: ${error.message}`);
              }
              return;
            }
            
            case 'video_to_video': {
              console.log(`🎬 RunwayML Gen4 video-to-video request (outgoing, via router)`);
              processVideoToVideoAsync({
                chatId, senderId, senderName,
                videoUrl: videoUrl, // Use the URL (either from current message or quoted)
                prompt: decision.args?.prompt || prompt
              });
              return;
            }
            
            default:
              console.log(`⚠️ Unexpected tool for video (outgoing): ${decision.tool}`);
              await sendTextMessage(chatId, `⚠️ Unexpected tool for video (outgoing): ${decision.tool}`);
              return;
          }
        } catch (error) {
          console.error('❌ Error routing outgoing video message:', error);
          await sendTextMessage(chatId, `❌ שגיאה בעיבוד הווידאו: ${error.message || error}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // Handle voice messages - but skip processing for outgoing messages
    // ═══════════════════════════════════════════════════════════════
    else if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage') {
      const audioData = messageData.fileMessageData || messageData.audioMessageData;
      
      console.log(`🎤 Outgoing voice message received - skipping voice processing (only process incoming voice messages)`);
      // Don't process outgoing voice messages to avoid unwanted transcription
    } else if (messageText) {
      // Handle admin shortcut commands that use current contact (no explicit name)
      const trimmed = messageText.trim();
      if (trimmed === 'הוסף ליצירה') {
        // Resolve current contact name using same priority logic as auth store
        const isGroupChat = chatId && chatId.endsWith('@g.us');
        const isPrivateChat = chatId && chatId.endsWith('@c.us');
        let contactName = '';
        if (isGroupChat) {
          contactName = senderData.chatName || senderName;
        } else if (isPrivateChat) {
          if (senderData.senderContactName && senderData.senderContactName.trim()) {
            contactName = senderData.senderContactName;
          } else if (senderData.chatName && senderData.chatName.trim()) {
            contactName = senderData.chatName;
          } else {
            contactName = senderName;
          }
        } else {
          contactName = senderData.senderContactName || senderData.chatName || senderName;
        }

        if (!contactName || !contactName.trim()) {
          console.warn('⚠️ Could not resolve contact name for add to media authorization');
        } else {
          const wasAdded = await authStore.addAuthorizedUser(contactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${contactName} נוסף לרשימת המורשים ליצירת מדיה`);
            console.log(`✅ Added ${contactName} to media creation authorization (current chat) by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${contactName} כבר נמצא ברשימת המורשים ליצירת מדיה`);
          }
        }
        return; // Stop further processing for this message
      }

      if (trimmed === 'הוסף לתמלול') {
        // Resolve current contact name as above
        const isGroupChat = chatId && chatId.endsWith('@g.us');
        const isPrivateChat = chatId && chatId.endsWith('@c.us');
        let contactName = '';
        if (isGroupChat) {
          contactName = senderData.chatName || senderName;
        } else if (isPrivateChat) {
          if (senderData.senderContactName && senderData.senderContactName.trim()) {
            contactName = senderData.senderContactName;
          } else if (senderData.chatName && senderData.chatName.trim()) {
            contactName = senderData.chatName;
          } else {
            contactName = senderName;
          }
        } else {
          contactName = senderData.senderContactName || senderData.chatName || senderName;
        }

        if (!contactName || !contactName.trim()) {
          console.warn('⚠️ Could not resolve contact name for add to transcription');
        } else {
          const wasAdded = await conversationManager.addToVoiceAllowList(contactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${contactName} נוסף לרשימת המורשים לתמלול`);
            console.log(`✅ Added ${contactName} to voice allow list (current chat) by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${contactName} כבר נמצא ברשימת המורשים לתמלול`);
          }
        }
        return; // Stop further processing for this message
      }

      if (trimmed === 'הסר מיצירה') {
        // Resolve current contact name
        const isGroupChat = chatId && chatId.endsWith('@g.us');
        const isPrivateChat = chatId && chatId.endsWith('@c.us');
        let contactName = '';
        if (isGroupChat) {
          contactName = senderData.chatName || senderName;
        } else if (isPrivateChat) {
          if (senderData.senderContactName && senderData.senderContactName.trim()) {
            contactName = senderData.senderContactName;
          } else if (senderData.chatName && senderData.chatName.trim()) {
            contactName = senderData.chatName;
          } else {
            contactName = senderName;
          }
        } else {
          contactName = senderData.senderContactName || senderData.chatName || senderName;
        }

        if (!contactName || !contactName.trim()) {
          console.warn('⚠️ Could not resolve contact name for remove from media authorization');
        } else {
          const wasRemoved = await authStore.removeAuthorizedUser(contactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${contactName} הוסר מרשימת המורשים ליצירת מדיה`);
            console.log(`✅ Removed ${contactName} from media creation authorization (current chat) by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${contactName} לא נמצא ברשימת המורשים ליצירת מדיה`);
          }
        }
        return; // Stop further processing for this message
      }

      if (trimmed === 'הסר מתמלול') {
        // Resolve current contact name
        const isGroupChat = chatId && chatId.endsWith('@g.us');
        const isPrivateChat = chatId && chatId.endsWith('@c.us');
        let contactName = '';
        if (isGroupChat) {
          contactName = senderData.chatName || senderName;
        } else if (isPrivateChat) {
          if (senderData.senderContactName && senderData.senderContactName.trim()) {
            contactName = senderData.senderContactName;
          } else if (senderData.chatName && senderData.chatName.trim()) {
            contactName = senderData.chatName;
          } else {
            contactName = senderName;
          }
        } else {
          contactName = senderData.senderContactName || senderData.chatName || senderName;
        }

        if (!contactName || !contactName.trim()) {
          console.warn('⚠️ Could not resolve contact name for remove from transcription');
        } else {
          const wasRemoved = await conversationManager.removeFromVoiceAllowList(contactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${contactName} הוסר מרשימת המורשים לתמלול`);
            console.log(`✅ Removed ${contactName} from voice allow list (current chat) by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${contactName} לא נמצא ברשימת המורשים לתמלול`);
          }
        }
        return; // Stop further processing for this message
      }

      // Non-"#" text messages - handle management commands only
      const command = parseTextCommand(messageText);
      if (command) {
        await handleManagementCommand(command, chatId, senderId, senderName, senderContactName, chatName);
      } else {
        console.log(`ℹ️ Outgoing text message without '# ' prefix - ignored (not a management command)`);
      }
    } else {
      console.log(`ℹ️ Unsupported outgoing message type: ${messageData.typeMessage}`);
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
 * Process creative voice message asynchronously (no await from webhook) - COMMENTED OUT FOR VOICE-TO-VOICE PROCESSING
 */
/*
function processCreativeVoiceAsync(voiceData) {
  // Run in background without blocking webhook response
  handleCreativeVoiceMessage(voiceData).catch(async error => {
    console.error('❌ Error in async creative voice processing:', error.message || error);
    try {
      await sendTextMessage(voiceData.chatId, `❌ שגיאה בעיבוד ההקלטה: ${error.message || error}`);
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}
*/

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
async function handleImageEdit({ chatId, senderId, senderName, imageUrl, prompt, service }) {
  console.log(`🎨 Processing ${service} image edit request from ${senderName}`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini' 
      ? '🎨 קיבלתי את התמונה. מיד מעבד אותה עם Gemini...'
      : '🖼️ קיבלתי את התמונה. מיד מעבד אותה עם OpenAI...';
    await sendTextMessage(chatId, ackMessage);
    
    // Note: Image editing commands do NOT add to conversation history
    
    if (!imageUrl) {
      throw new Error('No image URL provided');
    }
    
    // Download the image
    const imageBuffer = await downloadFile(imageUrl);
    
    const base64Image = imageBuffer.toString('base64');
    
    // Edit image with selected AI service
    let editResult;
    if (service === 'gemini') {
      editResult = await editImageForWhatsApp(prompt, base64Image);
    } else if (service === 'openai') {
      editResult = await editOpenAIImage(prompt, base64Image);
    }
    
    if (editResult.success) {
      let sentSomething = false;
      
      // Send text response if available
      if (editResult.description && editResult.description.trim()) {
        await sendTextMessage(chatId, editResult.description);
        
        // Note: Image editing results do NOT add to conversation history
        
        console.log(`✅ ${service} edit text response sent to ${senderName}: ${editResult.description}`);
        sentSomething = true;
      }
      
      // Send image if available (even if we already sent text)
      if (editResult.imageUrl) {
        const fileName = editResult.fileName || `${service}_edit_${Date.now()}.png`;
        
        await sendFileByUrl(chatId, editResult.imageUrl, fileName, '');
        
        console.log(`✅ ${service} edited image sent to ${senderName}`);
        sentSomething = true;
      }
      
      // If nothing was sent, it means we have success but no content
      if (!sentSomething) {
        await sendTextMessage(chatId, '✅ העיבוד הושלם בהצלחה');
        console.log(`✅ ${service} edit completed but no content to send to ${senderName}`);
      }
    } else {
      const errorMsg = editResult.error || 'לא הצלחתי לערוך את התמונה. נסה שוב מאוחר יותר.';
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
      console.log(`❌ ${service} image edit failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${service} image editing:`, error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעריכת התמונה: ${error.message || error}`);
  }
}

/**
 * Handle image-to-video with Veo 3 or Kling
 */
async function handleImageToVideo({ chatId, senderId, senderName, imageUrl, prompt, service = 'veo3' }) {
  const serviceName = service === 'veo3' ? 'Veo 3' : 'Kling 2.1 Master';
  console.log(`🎬 Processing ${serviceName} image-to-video request from ${senderName}`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'veo3' 
      ? '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Veo 3...'
      : '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Kling 2.1...';
    await sendTextMessage(chatId, ackMessage);
    
    // Note: Image-to-video commands do NOT add to conversation history
    
    if (!imageUrl) {
      throw new Error('No image URL provided');
    }
    
    // Download the image
    const imageBuffer = await downloadFile(imageUrl);
    
    // Generate video with selected service
    let videoResult;
    if (service === 'veo3') {
      videoResult = await generateVideoFromImageForWhatsApp(prompt, imageBuffer);
    } else {
      videoResult = await generateKlingVideoFromImage(imageBuffer, prompt);
    }
    
    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `${service}_image_video_${Date.now()}.mp4`;
      
      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
      
      // Add AI response to conversation history
      await conversationManager.addMessage(chatId, 'assistant', `וידאו נוצר מתמונה (${serviceName}): ${videoResult.description || 'וידאו חדש'}`);
      
      console.log(`✅ ${serviceName} image-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || `לא הצלחתי ליצור וידאו מהתמונה עם ${serviceName}. נסה שוב מאוחר יותר.`;
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
      console.log(`❌ ${serviceName} image-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${serviceName} image-to-video:`, error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה ביצירת הוידאו מהתמונה: ${error.message || error}`);
  }
}

/**
 * Handle video-to-video with RunwayML Gen4
 */
async function handleVideoToVideo({ chatId, senderId, senderName, videoUrl, prompt }) {
  console.log(`🎬 Processing RunwayML Gen4 video-to-video request from ${senderName}`);
  
  try {
    // Send immediate ACK
    await sendAck(chatId, { type: 'runway_video_to_video' });
    
    // Note: Video-to-video commands do NOT add to conversation history
    
    if (!videoUrl) {
      throw new Error('No video URL provided');
    }
    
    // Download the video
    const videoBuffer = await downloadFile(videoUrl);
    
    // Generate video with RunwayML Gen4
    const videoResult = await generateRunwayVideoFromVideo(videoBuffer, prompt);
    
    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `runway_video_${Date.now()}.mp4`;
      
      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
      
      // Note: Video-to-video results do NOT add to conversation history
      
      console.log(`✅ RunwayML Gen4 video-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || 'לא הצלחתי לעבד את הווידאו. נסה שוב מאוחר יותר.';
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
      console.log(`❌ RunwayML Gen4 video-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error('❌ Error in RunwayML Gen4 video-to-video:', error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד הווידאו: ${error.message || error}`);
  }
}

/**
 * Handle creative voice message processing - COMMENTED OUT FOR VOICE-TO-VOICE PROCESSING
 * Flow: Download → Creative Effects → Convert to Opus → Send
 */
/*
async function handleCreativeVoiceMessage({ chatId, senderId, senderName, audioUrl }) {
  console.log(`🎨 Processing creative voice request from ${senderName}`);
  
  try {
    // Send immediate ACK
    await sendAck(chatId, { type: 'creative_voice_processing' });
    
    // Step 1: Download audio file
    console.log(`📥 Step 1: Downloading audio file...`);
    const audioBuffer = await downloadFile(audioUrl);
    console.log(`✅ Step 1 complete: Downloaded ${audioBuffer.length} bytes`);
    
    // Step 2: Apply creative effects
    console.log(`🎨 Step 2: Applying creative effects...`);
    const creativeResult = await creativeAudioService.processVoiceCreatively(audioBuffer, 'mp3');
    
    if (!creativeResult.success) {
      console.error('❌ Creative processing failed:', creativeResult.error);
      await sendTextMessage(chatId, `❌ סליחה, לא הצלחתי לעבד את ההקלטה: ${creativeResult.error}`);
      return;
    }
    
    console.log(`✅ Step 2 complete: Applied ${creativeResult.description}`);
    
    // Step 3: Convert to Opus and save
    console.log(`🔄 Step 3: Converting to Opus format...`);
    const conversionResult = await audioConverterService.convertAndSaveAsOpus(creativeResult.audioBuffer, 'mp3');
    
    if (!conversionResult.success) {
      console.error('❌ Opus conversion failed:', conversionResult.error);
      // Fallback: send as regular MP3
      const fileName = `creative_${Date.now()}.mp3`;
      const tempPath = path.join(__dirname, '..', 'public', 'tmp', fileName);
      fs.writeFileSync(tempPath, creativeResult.audioBuffer);
      const fullAudioUrl = getStaticFileUrl(fileName);
      await sendFileByUrl(chatId, fullAudioUrl, fileName, '');
    } else {
      // Send as voice note with Opus format
      const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
      
      // Verify file exists before sending
      const filePath = path.join(__dirname, '..', 'public', 'tmp', conversionResult.fileName);
      if (!fs.existsSync(filePath)) {
        console.error(`❌ Opus file not found: ${filePath}`);
        await sendTextMessage(chatId, `❌ סליחה, קובץ האודיו לא נמצא. נסה שוב.`);
        return;
      }
      
      console.log(`📁 Opus file verified: ${filePath} (${fs.statSync(filePath).size} bytes)`);
      console.log(`🔗 Full URL: ${fullAudioUrl}`);
      
      await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '');
      console.log(`✅ Creative voice sent as voice note: ${conversionResult.fileName}`);
    }
    
    // Send effect description
    await sendTextMessage(chatId, `🎨 עיבוד יצירתי הושלם!\n\n${creativeResult.description}`);
    
    console.log(`✅ Creative voice processing complete for ${senderName}`);

  } catch (error) {
    console.error('❌ Error in creative voice processing:', error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד היצירתי של ההקלטה: ${error.message || error}`);
  }
}
*/

/**
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl }) {
  console.log(`🎤 Processing voice-to-voice request from ${senderName}`);
  
  try {
    // No ACK - user should only receive the final voice response
    
    // Step 1: Download audio file
    const audioBuffer = await downloadFile(audioUrl);
    
    // Step 2: Speech-to-Text transcription
    console.log(`🔄 Step 1: Transcribing speech...`);
    const transcriptionOptions = {
      model: 'scribe_v1',
      language: null, // Auto-detect
      removeNoise: true,
      removeFiller: true,
      optimizeLatency: 0,
      format: 'ogg' // WhatsApp audio format
    };
    
    const transcriptionResult = await speechService.speechToText(audioBuffer, transcriptionOptions);
    
    if (transcriptionResult.error) {
      console.error('❌ Transcription failed:', transcriptionResult.error);
      // We don't know the language yet, so use Hebrew as default for error messages
      await sendTextMessage(chatId, `❌ סליחה, לא הצלחתי לתמלל את ההקלטה: ${transcriptionResult.error}`);
      return;
    }

    const transcribedText = transcriptionResult.text;
    console.log(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);
    console.log(`📝 Transcription complete`);

    // Use our own language detection on the transcribed text for consistency
    const originalLanguage = voiceService.detectLanguage(transcribedText);
    console.log(`🌐 STT detected: ${transcriptionResult.detectedLanguage}, Our detection: ${originalLanguage}`);

    // Don't send transcription to user - they should only receive the final voice response

    // Step 2: Create Instant Voice Clone
    console.log(`🔄 Step 2: Creating voice clone...`);
    
    const voiceCloneOptions = {
      name: `WhatsApp Voice Clone ${Date.now()}`,
      description: `Voice clone from WhatsApp audio`,
      removeBackgroundNoise: true,
      labels: JSON.stringify({
        accent: originalLanguage === 'he' ? 'hebrew' : 'natural',
        use_case: 'conversational',
        quality: 'high',
        style: 'natural',
        language: originalLanguage
      })
    };
    
    const voiceCloneResult = await voiceService.createInstantVoiceClone(audioBuffer, voiceCloneOptions);
    
    if (voiceCloneResult.error) {
      console.error('❌ Voice cloning failed:', voiceCloneResult.error);
      await sendTextMessage(chatId, `❌ סליחה, לא הצלחתי ליצור שיבוט קול: ${voiceCloneResult.error}`);
      return;
    }

    const voiceId = voiceCloneResult.voiceId;
    const detectedLanguage = transcriptionResult.detectedLanguage || 'he';
    console.log(`✅ Step 2 complete: Voice cloned (ID: ${voiceId}), Language: ${detectedLanguage}`);

    // Step 3: Generate Gemini response in the same language as the original
    console.log(`🔄 Step 3: Generating Gemini response in ${originalLanguage}...`);
    
    // Create language-aware prompt for Gemini
    const languageInstruction = originalLanguage === 'he' 
      ? '' // Hebrew is default, no need for special instruction
      : originalLanguage === 'en' 
        ? 'Please respond in English. ' 
        : originalLanguage === 'ar' 
          ? 'يرجى الرد باللغة العربية. '
          : originalLanguage === 'ru' 
            ? 'Пожалуйста, отвечайте на русском языке. '
            : originalLanguage === 'es' 
              ? 'Por favor responde en español. '
              : originalLanguage === 'fr' 
                ? 'Veuillez répondre en français. '
                : originalLanguage === 'de' 
                  ? 'Bitte antworten Sie auf Deutsch. '
                  : `Please respond in the same language as this message. `;
    
    const geminiPrompt = languageInstruction + transcribedText;
    // Voice processing doesn't need conversation history - treat each voice message independently
    const geminiResult = await generateGeminiResponse(geminiPrompt, []);
    
    // Add user message to conversation AFTER getting Gemini response to avoid duplication
    await conversationManager.addMessage(chatId, 'user', `הקלטה קולית: ${transcribedText}`);
    
    if (geminiResult.error) {
      console.error('❌ Gemini generation failed:', geminiResult.error);
      const errorMessage = originalLanguage === 'he' 
        ? `❌ סליחה, לא הצלחתי ליצור תגובה: ${geminiResult.error}`
        : `❌ Sorry, I couldn't generate a response: ${geminiResult.error}`;
      await sendTextMessage(chatId, errorMessage);
      
      // Clean up voice clone before returning
      try {
        await voiceService.deleteVoice(voiceId);
        console.log(`🧹 Voice clone ${voiceId} deleted (cleanup after Gemini error)`);
      } catch (cleanupError) {
        console.warn('⚠️ Could not delete voice clone:', cleanupError.message);
      }
      return;
    }

    const geminiResponse = geminiResult.text;
    console.log(`✅ Step 3 complete: Gemini response generated`);
    
    // Add AI response to conversation history
    await conversationManager.addMessage(chatId, 'assistant', geminiResponse);

    // Step 4: Text-to-Speech with cloned voice
    console.log(`🔄 Step 4: Converting text to speech with cloned voice...`);
    
    // Use the original language for TTS to maintain consistency throughout the flow
    const responseLanguage = originalLanguage; // Force same language as original
    console.log(`🌐 Language consistency enforced:`);
    console.log(`   - Original (from user): ${originalLanguage}`);
    console.log(`   - TTS (forced same): ${responseLanguage}`);
    
    const ttsOptions = {
      modelId: 'eleven_v3', // Use the most advanced model
      outputFormat: 'mp3_44100_128', // ElevenLabs doesn't support ogg_vorbis
      languageCode: responseLanguage
    };

    const ttsResult = await voiceService.textToSpeech(voiceId, geminiResponse, ttsOptions);
    
    if (ttsResult.error) {
      console.error('❌ Text-to-speech failed:', ttsResult.error);
      // If TTS fails, send error message (don't send the Gemini response as text)
      const errorMessage = originalLanguage === 'he' 
        ? '❌ סליחה, לא הצלחתי ליצור תגובה קולית. נסה שוב.'
        : '❌ Sorry, I couldn\'t generate voice response. Please try again.';
      await sendTextMessage(chatId, errorMessage);
      
      // Clean up voice clone before returning
      try {
        await voiceService.deleteVoice(voiceId);
        console.log(`🧹 Voice clone ${voiceId} deleted (cleanup after TTS error)`);
      } catch (cleanupError) {
        console.warn('⚠️ Could not delete voice clone:', cleanupError.message);
      }
      return;
    }

    console.log(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

    // Step 5: Convert and send voice response back to user as voice note
    console.log(`🔄 Converting voice-to-voice to Opus format for voice note...`);
    const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');
    
    if (!conversionResult.success) {
      console.error('❌ Audio conversion failed:', conversionResult.error);
      // Fallback: send as regular MP3 file
      const fullAudioUrl = ttsResult.audioUrl.startsWith('http') 
        ? ttsResult.audioUrl 
        : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
      await sendFileByUrl(chatId, fullAudioUrl, `voice_${Date.now()}.mp3`, '');
    } else {
      // Send as voice note with Opus format
      const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
      await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '');
      console.log(`✅ Voice-to-voice sent as voice note: ${conversionResult.fileName}`);
    }
    
    console.log(`✅ Voice-to-voice processing complete for ${senderName}`);

    // Cleanup: Delete the cloned voice (optional - ElevenLabs has limits)
    try {
      await voiceService.deleteVoice(voiceId);
      console.log(`🧹 Cleanup: Voice ${voiceId} deleted`);
    } catch (cleanupError) {
      console.warn('⚠️ Voice cleanup failed:', cleanupError.message);
    }

  } catch (error) {
    console.error('❌ Error in voice-to-voice processing:', error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד ההקלטה הקולית: ${error.message || error}`);
  }
}

// ════════════════════════════════════════════════════════════════
// LEGACY FUNCTION handleTextMessage - REMOVED
// All functionality moved to router-based direct execution (lines 279-510)
// Management commands handled in handleOutgoingMessage (lines 1022+)
// ════════════════════════════════════════════════════════════════

/**
 * Parse text message to extract MANAGEMENT COMMANDS ONLY
 * All AI commands (chat, image, video, music, TTS) now go through router with "# " prefix
 */
function parseTextCommand(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  text = text.trim();

  // ═══════════════════ MANAGEMENT COMMANDS ONLY ═══════════════════
  // All AI commands (chat, image, video, music, TTS) now go through router with "# " prefix
  
  // Clear conversation history (admin command)
  if (text === 'נקה היסטוריה') {
    return { type: 'clear_all_conversations' };
  }

  // Show history
  if (text === 'הצג היסטוריה') {
    return { type: 'show_history' };
  }

  // Media creation status
  if (text === 'סטטוס יצירה') {
    return { type: 'media_creation_status' };
  }

  // Voice transcription controls
  if (text === 'סטטוס תמלול') {
    return { type: 'voice_transcription_status' };
  }

  // Group creation status
  if (text === 'סטטוס קבוצות') {
    return { type: 'group_creation_status' };
  }

  // Sync contacts from Green API
  if (text === 'עדכן אנשי קשר') {
    return { type: 'sync_contacts' };
  }

  // Media creation authorization commands
  if (text.startsWith('הוסף ליצירה ')) {
    const contactName = text.substring('הוסף ליצירה '.length).trim();
    if (contactName) {
      return { 
        type: 'add_media_authorization', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  if (text.startsWith('הסר מיצירה ')) {
    const contactName = text.substring('הסר מיצירה '.length).trim();
    if (contactName) {
      return { 
        type: 'remove_media_authorization', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  // Group creation authorization commands
  if (text.startsWith('הוסף לקבוצות ')) {
    const contactName = text.substring('הוסף לקבוצות '.length).trim();
    if (contactName) {
      return { 
        type: 'add_group_authorization', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  if (text.startsWith('הסר מקבוצות ')) {
    const contactName = text.substring('הסר מקבוצות '.length).trim();
    if (contactName) {
      return { 
        type: 'remove_group_authorization', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  // Shortcut: "הוסף לקבוצות" without name - infer from current chat
  if (text === 'הוסף לקבוצות') {
    return { 
      type: 'add_group_authorization_current',
      originalMessage: text 
    };
  }

  // Voice transcription exclude list management
  if (text.startsWith('הסר מתמלול ')) {
    const contactName = text.substring('הסר מתמלול '.length).trim();
    if (contactName) {
      return { 
        type: 'exclude_from_transcription', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  if (text.startsWith('הוסף לתמלול ')) {
    const contactName = text.substring('הוסף לתמלול '.length).trim();
    if (contactName) {
      return { 
        type: 'include_in_transcription', 
        contactName: contactName,
        originalMessage: text 
      };
    }
  }

  return null;
}

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
