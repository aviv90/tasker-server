const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile, getChatHistory } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const { generateTextResponse: generateOpenAIResponse, generateImageForWhatsApp: generateOpenAIImage, editImageForWhatsApp: editOpenAIImage } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp, generateVideoForWhatsApp, generateVideoFromImageForWhatsApp, generateChatSummary } = require('../services/geminiService');
const { generateTextResponse: generateGrokResponse } = require('../services/grokService');
const { generateVideoFromImageForWhatsApp: generateKlingVideoFromImage, generateVideoFromVideoForWhatsApp: generateRunwayVideoFromVideo, generateVideoWithTextForWhatsApp: generateKlingVideoFromText } = require('../services/replicateService');
const { generateMusicWithLyrics } = require('../services/musicService');
const speechService = require('../services/speechService');
const { voiceService } = require('../services/voiceService');
const { audioConverterService } = require('../services/audioConverterService');
const { creativeAudioService } = require('../services/creativeAudioService');
const conversationManager = require('../services/conversationManager');
const { routeIntent } = require('../services/intentRouter');
const authStore = require('../store/authStore');
const fs = require('fs');
const path = require('path');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Voice transcription and media authorization are managed through PostgreSQL database

/**
 * Check if user is authorized for media creation (images, videos, music)
 * @param {Object} senderData - WhatsApp sender data from Green API
 * @returns {Promise<boolean>} - True if user is authorized
 */
async function isAuthorizedForMediaCreation(senderData) {
  return await authStore.isAuthorizedForMediaCreation(senderData);
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
    'clear_all_conversations',
    // New admin shortcuts without explicit name
    'add_media_authorization_current',
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

// Clean up old processed messages every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
async function sendAck(chatId, command) {
  let ackMessage = '';
  
  switch (command.type) {
    case 'gemini_image':
      ackMessage = '🎨 קיבלתי. מיד מעבד עם Gemini...';
      break;
    case 'openai_image':
      ackMessage = '🖼️ קיבלתי. מיד מעבד עם OpenAI...';
      break;
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי. מיד יוצר וידאו עם Veo 3...';
      break;
    case 'veo3_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Veo 3...';
      break;
    case 'kling_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Kling 2.1...';
      break;
    case 'voice_processing':
      ackMessage = '🎤 קיבלתי את ההקלטה. מתחיל עיבוד קולי עם ElevenLabs + Gemini...';
      break;
    case 'runway_video_to_video':
      ackMessage = '🎬 קיבלתי את הווידאו. מיד עובד עליו עם RunwayML Gen4...';
      break;
    case 'kling_text_to_video':
      ackMessage = '🎬 מתחיל יצירת וידאו עם Kling 2.1 Master...';
      break;
    case 'chat_summary':
      ackMessage = '📝 מכין סיכום של השיחה עם Gemini...';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי. מיד יוצר קול עם ElevenLabs...';
      break;
    case 'music_generation':
      ackMessage = '🎵 קיבלתי. מתחיל יצירת שיר עם Suno...';
      break;
    case 'text_to_speech':
      ackMessage = '🗣️ קיבלתי. מיד יוצר דיבור עם ElevenLabs...';
      break;
    case 'grok_image':
      ackMessage = '🎨 קיבלתי. מיד יוצר תמונה עם Grok...';
      break;
    case 'creative_voice_processing':
      ackMessage = '🎨 קיבלתי את ההקלטה. מתחיל עיבוד יצירתי עם אפקטים ומוזיקה...';
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
 * 
 * 🚨 BACKWARD COMPATIBILITY RULE:
 * Any new WhatsApp functionality MUST maintain backward compatibility
 * with Tasker Android polling system (/api/start-task + /api/task-status).
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
    // Log full webhook payload (all fields)
    try {
      console.log('📱 Green API webhook received (full payload):');
      console.log(`📱 Webhook received: ${webhookData.typeMessage || 'unknown'}`);
    } catch (e) {
      console.log('📱 Green API webhook received (payload logging failed), raw object follows:');
      console.log(webhookData);
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
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(webhookData) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    const messageId = webhookData.idMessage;
    
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
    
    console.log(`📱 ${senderName}: ${messageData.typeMessage}`);
    
    // Handle text messages (both regular and extended)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    }
    
    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        const normalized = {
          userText: messageText.trim(),
          hasImage: messageData.typeMessage === 'imageMessage',
          hasVideo: messageData.typeMessage === 'videoMessage',
          hasAudio: messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage',
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
            voice_allowed: await conversationManager.isInVoiceAllowList((() => {
              const isGroupChat = chatId && chatId.endsWith('@g.us');
              const isPrivateChat = chatId && chatId.endsWith('@c.us');
              if (isGroupChat) return chatName || senderName;
              if (isPrivateChat) return (senderContactName && senderContactName.trim()) ? senderContactName : (chatName && chatName.trim()) ? chatName : senderName;
              return senderContactName || chatName || senderName;
            })())
          }
        };

        const decision = await routeIntent(normalized);

        // Map router output to existing flow for backward compatibility
        const prompt = normalized.userText.replace(/^#\s+/, '').trim();
        switch (decision.tool) {
          case 'ask_clarification':
            await sendTextMessage(chatId, 'ℹ️ לא ברור מה לבצע. תוכל לחדד בבקשה?');
            return;
          case 'deny_unauthorized':
            // שמירה על התנהגות דיסקרטית: במדיה נחזיר הודעת הרשאה; בקול כבר שינינו לשקט
            if (decision.args?.feature && decision.args.feature !== 'voice') {
              await sendUnauthorizedMessage(chatId, decision.args.feature);
            }
            return;
          case 'gemini_chat':
          case 'openai_chat':
          case 'grok_chat':
            processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: prompt });
            return;
          case 'gemini_image':
          case 'openai_image':
          case 'grok_image': {
            // שימוש בפקודות טקסט קיימות, המיפוי יקרה בתוך handleTextMessage
            processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'gemini_image' ? '** ' : decision.tool === 'openai_image' ? '## ' : '++ ') + prompt });
            return;
          }
          case 'veo3_video':
          case 'kling_text_to_video': {
            processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'veo3_video' ? '#### ' : '### ') + prompt });
            return;
          }
          case 'image_edit': {
            // כדי להישאר תאימים לאחור, נשתמש בקידומות העריכה על תמונה מצורפת
            if (messageData.typeMessage === 'imageMessage') {
              const prefix = decision.args?.service === 'gemini' ? '* ' : '# ';
              const imageData = messageData.fileMessageData || messageData.imageMessageData;
              // מיחזור הלוגיקה הקיימת: הוספת כיתוב מלאכותי והמשך בנתיב הרגיל
              imageData.caption = prefix + decision.args.prompt;
              messageData.imageMessageData = imageData;
              // נפל דרך לבלוק הקיים של תמונות בעיבוד בהמשך
            }
            break; // נמשיך לעיבוד התמונות הקיים בהמשך הפונקציה
          }
          case 'video_to_video': {
            if (messageData.typeMessage === 'videoMessage') {
              const videoData = messageData.fileMessageData || messageData.videoMessageData;
              videoData.caption = '## ' + decision.args.prompt;
              messageData.videoMessageData = videoData;
            }
            break; // נמשיך לעיבוד הווידאו הקיים
          }
          case 'text_to_speech':
            processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: '*** ' + (decision.args?.text || prompt) });
            return;
          case 'chat_summary':
            processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: 'סכם שיחה' });
            return;
          case 'creative_voice_processing':
            // אם זו הודעה קולית, הבלוק של הקול בהמשך כבר יטפל
            break;
          default:
            // לא מזוהה – נשמור על מסלול ישן
            break;
        }
      } catch (routerError) {
        console.error('❌ Intent router error:', routerError.message || routerError);
        // בשגיאה, נמשיך לנתיב הישן
      }
    }

    // Handle image messages for image-to-image editing
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      console.log(`🖼️ Image message received with caption: "${caption}"`);

      // Intent router for image captions starting with "# "
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
              voice_allowed: false
            }
          };

          const decision = await routeIntent(normalized);
          const routedPrompt = normalized.userText.replace(/^#\s+/, '').trim();

          switch (decision.tool) {
            case 'deny_unauthorized':
              await sendUnauthorizedMessage(chatId, decision.args?.feature || 'media');
              return;
            case 'gemini_image':
            case 'openai_image':
            case 'grok_image':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'gemini_image' ? '** ' : decision.tool === 'openai_image' ? '## ' : '++ ') + routedPrompt });
              return;
            case 'veo3_video':
            case 'kling_text_to_video':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'veo3_video' ? '#### ' : '### ') + routedPrompt });
              return;
            case 'image_edit': {
              const prefix = decision.args?.service === 'gemini' ? '* ' : '# ';
              imageData.caption = prefix + decision.args.prompt;
              messageData.imageMessageData = imageData;
              // Fall through to legacy handlers below
              break;
            }
            case 'video_to_video':
              // For image message this doesn't apply; ask clarification
              await sendTextMessage(chatId, 'ℹ️ נשלחה תמונה, לא וידאו. תרצה לערוך את התמונה או ליצור תמונה/וידאו חדש?');
              return;
            case 'text_to_speech':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: '*** ' + (decision.args?.text || routedPrompt) });
              return;
            case 'chat_summary':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: 'סכם שיחה' });
              return;
            case 'gemini_chat':
            case 'openai_chat':
            case 'grok_chat':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: routedPrompt });
              return;
            case 'ask_clarification':
            default:
              await sendTextMessage(chatId, 'ℹ️ לא ברור מה לבצע עם התמונה. תוכל לחדד בבקשה?');
              return;
          }
        } catch (routerError) {
          console.error('❌ Intent router (image caption) error:', routerError.message || routerError);
          // Continue to legacy handling below
        }
      }
      
      // Check if caption starts with "### " for Veo 3 image-to-video
      if (caption.startsWith('### ')) {
        const prompt = caption.substring(4).trim(); // Remove "### "
        console.log(`🎬 Veo 3 image-to-video request with prompt: "${prompt}"`);
        
        // Check authorization for media creation
        if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
          await sendUnauthorizedMessage(chatId, 'video creation');
          return;
        }
        
        // Process Veo 3 image-to-video asynchronously
        processImageToVideoAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'veo3'
        });
      }
      // Check if caption starts with "## " for Kling image-to-video
      else if (caption.startsWith('## ')) {
        const prompt = caption.substring(3).trim(); // Remove "## "
        console.log(`🎬 Kling 2.1 image-to-video request with prompt: "${prompt}"`);
        
        // Check authorization for media creation
        if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
          await sendUnauthorizedMessage(chatId, 'video creation');
          return;
        }
        
        // Process Kling image-to-video asynchronously
        processImageToVideoAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'kling'
        });
      }
      // Check if caption starts with "*" for Gemini image editing
      else if (caption.startsWith('* ')) {
        const prompt = caption.substring(2).trim(); // Remove "* "
        console.log(`🎨 Gemini image edit request with prompt: "${prompt}"`);
        
        // Check authorization for media creation
        if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
          await sendUnauthorizedMessage(chatId, 'image editing');
          return;
        }
        
        // Process Gemini image editing asynchronously
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'gemini'
        });
      } 
      // Check if caption starts with "#" for OpenAI image editing
      else if (caption.startsWith('# ')) {
        const prompt = caption.substring(2).trim(); // Remove "# "
        console.log(`🖼️ OpenAI image edit request with prompt: "${prompt}"`);
        
        // Check authorization for media creation
        if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
          await sendUnauthorizedMessage(chatId, 'image editing');
          return;
        }
        
        // Process OpenAI image editing asynchronously
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'openai'
        });
      } else {
        console.log(`ℹ️ Image received but no command (use "### " for Veo 3 video, "## " for Kling video, "* " for Gemini edit, or "# " for OpenAI edit)`);
      }
    }
    // Handle video messages for video-to-video processing
    else if (messageData.typeMessage === 'videoMessage') {
      const videoData = messageData.fileMessageData || messageData.videoMessageData;
      const caption = videoData?.caption || '';
      
      console.log(`🎬 Video message received with caption: "${caption}"`);

      // Intent router for video captions starting with "# "
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
              voice_allowed: false
            }
          };

          const decision = await routeIntent(normalized);
          const routedPrompt = normalized.userText.replace(/^#\s+/, '').trim();

          switch (decision.tool) {
            case 'deny_unauthorized':
              await sendUnauthorizedMessage(chatId, decision.args?.feature || 'media');
              return;
            case 'video_to_video':
              // Rewrite caption to legacy prefix and fall through to legacy handlers
              videoData.caption = '## ' + routedPrompt;
              messageData.videoMessageData = videoData;
              break;
            case 'veo3_video':
            case 'kling_text_to_video':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'veo3_video' ? '#### ' : '### ') + routedPrompt });
              return;
            case 'image_edit':
              await sendTextMessage(chatId, 'ℹ️ נשלח וידאו, לא תמונה. תרצה לבצע עיבוד וידאו?');
              return;
            case 'gemini_image':
            case 'openai_image':
            case 'grok_image':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'gemini_image' ? '** ' : decision.tool === 'openai_image' ? '## ' : '++ ') + routedPrompt });
              return;
            case 'text_to_speech':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: '*** ' + (decision.args?.text || routedPrompt) });
              return;
            case 'chat_summary':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: 'סכם שיחה' });
              return;
            case 'gemini_chat':
            case 'openai_chat':
            case 'grok_chat':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: routedPrompt });
              return;
            case 'ask_clarification':
            default:
              await sendTextMessage(chatId, 'ℹ️ לא ברור מה לבצע עם הווידאו. תוכל לחדד בבקשה?');
              return;
          }
        } catch (routerError) {
          console.error('❌ Intent router (video caption) error:', routerError.message || routerError);
          // Continue to legacy handling below
        }
      }
      
      // Check if caption starts with "## " for RunwayML Gen4 video-to-video
      if (caption.startsWith('## ')) {
        const prompt = caption.substring(3).trim(); // Remove "## "
        console.log(`🎬 RunwayML Gen4 video-to-video request with prompt: "${prompt}"`);
        
        // Check authorization for media creation
        if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
          await sendUnauthorizedMessage(chatId, 'video editing');
          return;
        }
        
        // Process RunwayML video-to-video asynchronously
        processVideoToVideoAsync({
          chatId,
          senderId,
          senderName,
          videoUrl: videoData.downloadUrl,
          prompt: prompt
        });
      } else {
        console.log(`ℹ️ Video received but no command (use "## " for RunwayML Gen4 video-to-video)`);
      }
    }
    // Handle voice messages for creative audio processing
    else if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage') {
      const audioData = messageData.fileMessageData || messageData.audioMessageData;
      
      console.log(`🎤 Voice message received`);
      
      // Priority logic based on chat type:
      // Group chat (@g.us): only check chatName
      // Private chat (@c.us): check senderContactName first, then chatName, then senderName as fallback
      let contactName = "";
      const isGroupChat = chatId && chatId.endsWith('@g.us');
      const isPrivateChat = chatId && chatId.endsWith('@c.us');
      
      if (isGroupChat) {
        // Group chat - only use chatName
        contactName = chatName || senderName;
      } else if (isPrivateChat) {
        // Private chat - priority: senderContactName → chatName → senderName
        if (senderContactName && senderContactName.trim()) {
          contactName = senderContactName;
        } else if (chatName && chatName.trim()) {
          contactName = chatName;
        } else {
          contactName = senderName;
        }
      } else {
        // Fallback for unknown chat types
        contactName = senderContactName || chatName || senderName;
      }
      
      const chatType = isGroupChat ? 'group' : isPrivateChat ? 'private' : 'unknown';
      console.log(`🔍 Checking voice transcription for: "${contactName}" (chatType: ${chatType}, chatId: "${chatId}", senderContactName: "${senderContactName}", chatName: "${chatName}", senderName: "${senderName}")`);
      
      try {
        // Check if sender is in allow list (new logic: must be in allow list to process, like media creation)
        const isInAllowList = await conversationManager.isInVoiceAllowList(contactName);
        if (!isInAllowList) {
        console.log(`🚫 Creative voice processing not allowed for ${contactName} (not in allow list)`);
        // Silently ignore unauthorized voice messages (no reply)
        return;
        }
        
        console.log(`✅ Creative voice processing allowed for ${contactName} - proceeding with processing`);
      } catch (dbError) {
        console.error('❌ Error checking voice transcription settings:', dbError);
        console.log(`🔇 Skipping creative voice processing due to database error`);
        return;
      }
      
      // Process creative voice asynchronously
      processCreativeVoiceAsync({
        chatId,
        senderId,
        senderName,
        audioUrl: audioData.downloadUrl
      });
    } else if (messageText) {
      // Process text message asynchronously - don't await
      processTextMessageAsync({
        chatId,
        senderId,
        senderName,
        senderContactName,
        chatName,
        messageText: messageText.trim()
      });
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
    const messageId = webhookData.idMessage;
    
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
    
    console.log(`📤 ${senderName}: ${messageData.typeMessage}`);
    
    // Handle text messages (both regular and extended)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    }
    
    // Handle image messages for image-to-image editing
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      console.log(`🖼️ Outgoing image message received with caption: "${caption}"`);
      
      // Check if caption starts with "### " for Veo 3 image-to-video
      if (caption.startsWith('### ')) {
        const prompt = caption.substring(4).trim(); // Remove "### "
        console.log(`🎬 Outgoing Veo 3 image-to-video request with prompt: "${prompt}" (bypassing authorization)`);
        
        // Process Veo 3 image-to-video asynchronously (no authorization check for outgoing messages)
        processImageToVideoAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'veo3'
        });
      }
      // Check if caption starts with "## " for Kling image-to-video
      else if (caption.startsWith('## ')) {
        const prompt = caption.substring(3).trim(); // Remove "## "
        console.log(`🎬 Outgoing Kling 2.1 image-to-video request with prompt: "${prompt}" (bypassing authorization)`);
        
        // Process Kling image-to-video asynchronously (no authorization check for outgoing messages)
        processImageToVideoAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'kling'
        });
      }
      // Check if caption starts with "*" for Gemini image editing
      else if (caption.startsWith('* ')) {
        const prompt = caption.substring(2).trim(); // Remove "* "
        console.log(`🎨 Outgoing Gemini image edit request with prompt: "${prompt}" (bypassing authorization)`);
        
        // Process Gemini image editing asynchronously (no authorization check for outgoing messages)
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'gemini'
        });
      } 
      // Check if caption starts with "#" for OpenAI image editing
      else if (caption.startsWith('# ')) {
        const prompt = caption.substring(2).trim(); // Remove "# "
        console.log(`🖼️ Outgoing OpenAI image edit request with prompt: "${prompt}" (bypassing authorization)`);
        
        // Process OpenAI image editing asynchronously (no authorization check for outgoing messages)
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'openai'
        });
      } else {
        console.log(`ℹ️ Outgoing image received but no command (use "### " for Veo 3 video, "## " for Kling video, "* " for Gemini edit, or "# " for OpenAI edit)`);
      }
    }
    // Handle video messages for video-to-video processing
    else if (messageData.typeMessage === 'videoMessage') {
      const videoData = messageData.fileMessageData || messageData.videoMessageData;
      const caption = videoData?.caption || '';
      
      console.log(`🎬 Outgoing video message received with caption: "${caption}"`);
      
      // Check if caption starts with "## " for RunwayML Gen4 video-to-video
      if (caption.startsWith('## ')) {
        const prompt = caption.substring(3).trim(); // Remove "## "
        console.log(`🎬 Outgoing RunwayML Gen4 video-to-video request with prompt: "${prompt}" (bypassing authorization)`);
        
        // Process RunwayML video-to-video asynchronously (no authorization check for outgoing messages)
        processVideoToVideoAsync({
          chatId,
          senderId,
          senderName,
          videoUrl: videoData.downloadUrl,
          prompt: prompt
        });
      } else {
        console.log(`ℹ️ Outgoing video received but no command (use "## " for RunwayML Gen4 video-to-video)`);
      }
    }
    // Handle voice messages - but skip processing for outgoing messages
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

      // Process text message asynchronously - don't await
      processTextMessageAsync({
        chatId,
        senderId,
        senderName,
        senderContactName,
        chatName,
        messageText: messageText.trim()
      }, true); // isOutgoing = true
    } else {
      console.log(`ℹ️ Unsupported outgoing message type: ${messageData.typeMessage}`);
    }
  } catch (error) {
    console.error('❌ Error handling outgoing message:', error.message || error);
  }
}

/**
 * Process text message asynchronously (no await from webhook)
 */
function processTextMessageAsync(messageData, isOutgoing = false) {
  // Run in background without blocking webhook response
  handleTextMessage(messageData, isOutgoing).catch(error => {
    console.error('❌ Error in async message processing:', error.message || error);
  });
}

/**
 * Process image edit message asynchronously (no await from webhook)
 */
function processImageEditAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageEdit(imageData).catch(error => {
    console.error('❌ Error in async image edit processing:', error.message || error);
  });
}

/**
 * Process image-to-video message asynchronously (no await from webhook)
 */
function processImageToVideoAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageToVideo(imageData).catch(error => {
    console.error('❌ Error in async image-to-video processing:', error.message || error);
  });
}

/**
 * Process creative voice message asynchronously (no await from webhook)
 */
function processCreativeVoiceAsync(voiceData) {
  // Run in background without blocking webhook response
  handleCreativeVoiceMessage(voiceData).catch(error => {
    console.error('❌ Error in async creative voice processing:', error.message || error);
  });
}

/**
 * Process voice message asynchronously (no await from webhook) - COMMENTED OUT FOR CREATIVE PROCESSING
 */
/*
function processVoiceMessageAsync(voiceData) {
  // Run in background without blocking webhook response
  handleVoiceMessage(voiceData).catch(error => {
    console.error('❌ Error in async voice processing:', error.message || error);
  });
}
*/

/**
 * Process video-to-video message asynchronously (no await from webhook)
 */
function processVideoToVideoAsync(videoData) {
  // Run in background without blocking webhook response
  handleVideoToVideo(videoData).catch(error => {
    console.error('❌ Error in async video-to-video processing:', error.message || error);
  });
}

/**
 * Handle image edit with AI (Gemini or OpenAI)
 */
async function handleImageEdit({ chatId, senderId, senderName, imageUrl, prompt, service }) {
  console.log(`🎨 Processing ${service} image edit request from ${senderName}: "${prompt}"`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini' 
      ? '🎨 קיבלתי את התמונה. מיד מעבד אותה עם Gemini...'
      : '🖼️ קיבלתי את התמונה. מיד מעבד אותה עם OpenAI...';
    await sendTextMessage(chatId, ackMessage);
    
    // Note: Image editing commands do NOT add to conversation history
    
    // Download the image first
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
        const fileName = `${service}_edit_${Date.now()}.png`;
        
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
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעריכת התמונה.');
  }
}

/**
 * Handle image-to-video with Veo 3 or Kling
 */
async function handleImageToVideo({ chatId, senderId, senderName, imageUrl, prompt, service = 'veo3' }) {
  const serviceName = service === 'veo3' ? 'Veo 3' : 'Kling 2.1 Master';
  console.log(`🎬 Processing ${serviceName} image-to-video request from ${senderName}: "${prompt}"`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'veo3' 
      ? '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Veo 3...'
      : '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Kling 2.1...';
    await sendTextMessage(chatId, ackMessage);
    
    // Note: Image-to-video commands do NOT add to conversation history
    
    // Download the image first
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
    await sendTextMessage(chatId, `❌ סליחה, הייתה שגיאה ביצירת הוידאו מהתמונה עם ${serviceName}.`);
  }
}

/**
 * Handle video-to-video with RunwayML Gen4
 */
async function handleVideoToVideo({ chatId, senderId, senderName, videoUrl, prompt }) {
  console.log(`🎬 Processing RunwayML Gen4 video-to-video request from ${senderName}: "${prompt}"`);
  
  try {
    // Send immediate ACK
    await sendAck(chatId, { type: 'runway_video_to_video' });
    
    // Note: Video-to-video commands do NOT add to conversation history
    
    // Download the video first
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
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד הווידאו.');
  }
}

/**
 * Handle creative voice message processing
 * Flow: Download → Creative Effects → Convert to Opus → Send
 */
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
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד היצירתי של ההקלטה.');
  }
}

/**
 * Handle voice message with full voice-to-voice processing - COMMENTED OUT FOR CREATIVE PROCESSING
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
/*
async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl }) {
  console.log(`🎤 Processing voice-to-voice request from ${senderName}`);
  
  try {
    // Send immediate ACK
    await sendAck(chatId, { type: 'voice_processing' });
    
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
    console.log(`📝 Transcribed: "${transcribedText}"`);

    // Use our own language detection on the transcribed text for consistency
    const originalLanguage = voiceService.detectLanguage(transcribedText);
    console.log(`🌐 STT detected: ${transcriptionResult.detectedLanguage}, Our detection: ${originalLanguage}`);

    // Send transcription to user first - always in Hebrew for consistency
    const transcriptionMessage = `📝 תמלול ההודעה של ${senderName}: "${transcribedText}"`;
    
    await sendTextMessage(chatId, transcriptionMessage);

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
    console.log(`✅ Step 3 complete: Gemini generated ${geminiResponse.length} characters`);
    console.log(`💬 Gemini response: "${geminiResponse.substring(0, 100)}..."`);
    
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
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד ההקלטה הקולית.');
  }
}
*/

/**
 * Handle text message with AI chat functionality
 */
async function handleTextMessage({ chatId, senderId, senderName, senderContactName, chatName, messageText }, isOutgoing = false) {
  console.log(`💬 ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''} ${isOutgoing ? '(outgoing)' : ''}`);
  
  const command = parseTextCommand(messageText);
  
  if (!command) {
    return;
  }

  console.log(`🤖 ${command.type} ${isOutgoing ? '(outgoing)' : ''}`);

  // SECURITY: Admin commands can only be executed from outgoing messages (sent by you)
  if (isAdminCommand(command.type) && !isOutgoing) {
    console.log(`🚫 Admin command ${command.type} blocked - only works from outgoing messages`);
    // Silently ignore admin commands from incoming messages (no error message to user)
    return;
  }

  // Check authorization for media commands BEFORE sending ACK (skip for outgoing messages)
  // Management commands (transcription, media creation status, etc.) should work from outgoing messages
  if (!isOutgoing && requiresMediaAuthorization(command.type)) {
    if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, sender: senderId, chatId }))) {
      await sendUnauthorizedMessage(chatId, command.type);
      return;
    }
  }

  // Send immediate ACK for long-running commands (skip chat commands)
  if (command.type !== 'gemini_chat' && command.type !== 'openai_chat') {
    await sendAck(chatId, command);
  }

  try {
    switch (command.type) {
      case 'gemini_chat':
        console.log(`🤖 Processing Gemini chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          await conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const history = await conversationManager.getConversationHistory(chatId);
          
          // Generate Gemini response with history
          const geminiResponse = await generateGeminiResponse(command.prompt, history);
          
          if (geminiResponse.error) {
            await sendTextMessage(chatId, geminiResponse.error);
            console.log(`❌ Gemini error for ${senderName}: ${geminiResponse.error}`);
          } else {
            // Add AI response to conversation
            await conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
            await sendTextMessage(chatId, geminiResponse.text);
            console.log(`✅ Gemini chat completed for ${senderName} with history context (${history.length} messages)`);
          }
        } catch (geminiError) {
          console.error('❌ Error in Gemini chat:', geminiError.message || geminiError);
          await sendTextMessage(chatId, `❌ ${geminiError.message || geminiError}`);
        }
        break;

      case 'openai_chat':
        console.log(`🤖 Processing OpenAI chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          await conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const openaiHistory = await conversationManager.getConversationHistory(chatId);
          
          // Generate OpenAI response with history
          const openaiResponse = await generateOpenAIResponse(command.prompt, openaiHistory);
          
          if (openaiResponse.error) {
            await sendTextMessage(chatId, openaiResponse.error);
            console.log(`❌ OpenAI error for ${senderName}: ${openaiResponse.error}`);
          } else {
            // Add AI response to conversation
            await conversationManager.addMessage(chatId, 'assistant', openaiResponse.text);
            await sendTextMessage(chatId, openaiResponse.text);
            console.log(`✅ OpenAI chat completed for ${senderName} with history context (${openaiHistory.length} messages)`);
          }
        } catch (openaiError) {
          console.error('❌ Error in OpenAI chat:', openaiError.message || openaiError);
          await sendTextMessage(chatId, `❌ ${openaiError.message || openaiError}`);
        }
        break;

      case 'grok_chat':
        console.log(`🤖 Processing Grok chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          await conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const grokHistory = await conversationManager.getConversationHistory(chatId);
          
          // Generate Grok response with history
          const grokResponse = await generateGrokResponse(command.prompt, grokHistory);
          
          if (grokResponse.error) {
            await sendTextMessage(chatId, grokResponse.error);
            console.log(`❌ Grok error for ${senderName}: ${grokResponse.error}`);
          } else {
            // Add AI response to conversation
            await conversationManager.addMessage(chatId, 'assistant', grokResponse.text);
            await sendTextMessage(chatId, grokResponse.text);
            console.log(`✅ Grok chat completed for ${senderName} with history context (${grokHistory.length} messages)`);
          }
        } catch (grokError) {
          console.error('❌ Error in Grok chat:', grokError.message || grokError);
          await sendTextMessage(chatId, `❌ ${grokError.message || grokError}`);
        }
        break;

      case 'grok_image':
        console.log(`🖼️ Processing Grok image generation request from ${senderName}`);
        
        try {
          // Note: Image generation commands do NOT add to conversation history
          
          const { generateImageForWhatsApp: generateGrokImage } = require('../services/grokService');
          const grokImageResult = await generateGrokImage(command.prompt);
          
          if (!grokImageResult.success) {
            await sendTextMessage(chatId, grokImageResult.error || 'שגיאה ביצירת התמונה עם Grok');
          } else {
            // Send both image and text if available
            if (grokImageResult.imageUrl && grokImageResult.description) {
              await sendFileByUrl(chatId, grokImageResult.imageUrl, 'grok_image.png', '');
              await sendTextMessage(chatId, grokImageResult.description);
            } else if (grokImageResult.imageUrl) {
              await sendFileByUrl(chatId, grokImageResult.imageUrl, 'grok_image.png', '');
            } else if (grokImageResult.description) {
              await sendTextMessage(chatId, grokImageResult.description);
            } else {
              await sendTextMessage(chatId, '✅ התמונה נוצרה בהצלחה עם Grok');
            }
            
            console.log(`✅ Grok image sent to ${senderName}`);
          }
        } catch (grokImageError) {
          console.error('❌ Error in Grok image generation:', grokImageError.message || grokImageError);
          await sendTextMessage(chatId, `❌ שגיאה ביצירת תמונה עם Grok: ${grokImageError.message || grokImageError}`);
        }
        break;

      case 'openai_image':
        console.log(`🖼️ Processing OpenAI image generation request from ${senderName}`);
        
        try {
          // Note: Image generation commands do NOT add to conversation history
          
          // Generate image with OpenAI (WhatsApp format)
          const openaiImageResult = await generateOpenAIImage(command.prompt);
          
          if (openaiImageResult.success && openaiImageResult.imageUrl) {
            // Send the generated image with text as caption (if exists)
            const fileName = `openai_image_${Date.now()}.png`;
            const caption = openaiImageResult.description && openaiImageResult.description.length > 0 
              ? openaiImageResult.description 
              : '';
            
              await sendFileByUrl(chatId, openaiImageResult.imageUrl, fileName, caption);
              
              // Note: Image generation results do NOT add to conversation history
            
            console.log(`✅ OpenAI image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
          } else {
            const errorMsg = openaiImageResult.error || 'לא הצלחתי ליצור תמונה. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ OpenAI image generation failed for ${senderName}: ${errorMsg}`);
          }
        } catch (openaiImageError) {
          console.error('❌ Error in OpenAI image generation:', openaiImageError.message || openaiImageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;

      case 'gemini_image':
        console.log(`🎨 Processing Gemini image generation request from ${senderName}`);
        
        try {
          // Note: Image generation commands do NOT add to conversation history
          
          // Generate image with Gemini (WhatsApp format)
          const imageResult = await generateImageForWhatsApp(command.prompt);
          
          if (imageResult.success && imageResult.imageUrl) {
            // Send the generated image with text as caption
            const fileName = `gemini_image_${Date.now()}.png`;
            const caption = imageResult.description && imageResult.description.length > 0 
              ? imageResult.description 
              : '';
            
              await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
              
              // Note: Image generation results do NOT add to conversation history
            
            console.log(`✅ Gemini image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
          } else {
            // Check if Gemini returned text instead of image
            if (imageResult.textResponse) {
              console.log('📝 Gemini returned text instead of image, sending text response');
                await sendTextMessage(chatId, imageResult.textResponse);
                
                // Note: Image generation text responses do NOT add to conversation history
            } else {
              const errorMsg = imageResult.error || 'לא הצלחתי ליצור תמונה. נסה שוב מאוחר יותר.';
              await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
              console.log(`❌ Gemini image generation failed for ${senderName}: ${errorMsg}`);
            }
          }
        } catch (imageError) {
          console.error('❌ Error in Gemini image generation:', imageError.message || imageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;

      case 'veo3_video':
        console.log(`🎬 Processing Veo 3 video generation request from ${senderName}`);
        
        try {
          // Note: Video generation commands do NOT add to conversation history
          
          // Generate video with Veo 3 (WhatsApp format)
          const videoResult = await generateVideoForWhatsApp(command.prompt);
          
          if (videoResult.success && videoResult.videoUrl) {
            // Send the generated video without caption
            const fileName = `veo3_video_${Date.now()}.mp4`;
            
            await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
            
            // Note: Video generation results do NOT add to conversation history
            
            console.log(`✅ Veo 3 video sent to ${senderName}`);
          } else {
            const errorMsg = videoResult.error || 'לא הצלחתי ליצור וידאו. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ Veo 3 video generation failed for ${senderName}: ${errorMsg}`);
          }
        } catch (videoError) {
          console.error('❌ Error in Veo 3 video generation:', videoError.message || videoError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת הוידאו.');
        }
        break;

      case 'kling_text_to_video':
        console.log(`🎬 Processing Kling text-to-video generation request from ${senderName}`);
        
        try {
          // Note: Video generation commands do NOT add to conversation history
          
          // Generate video with Kling 2.1 Master (WhatsApp format)
          const videoResult = await generateKlingVideoFromText(command.prompt);
          
          if (videoResult.success && videoResult.videoUrl) {
            // Send the generated video without caption
            const fileName = videoResult.fileName || `kling_video_${Date.now()}.mp4`;
            
            await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
            
            // Note: Video generation results do NOT add to conversation history
            
            console.log(`✅ Kling text-to-video sent to ${senderName}`);
          } else {
            const errorMsg = videoResult.error || 'לא הצלחתי ליצור את הווידאו. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ Kling text-to-video failed for ${senderName}: ${errorMsg}`);
          }
        } catch (videoError) {
          console.error('❌ Error in Kling text-to-video generation:', videoError.message || videoError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת הווידאו עם Kling.');
        }
        break;

      case 'chat_summary':
        console.log(`📝 Processing chat summary request from ${senderName}`);
        
        try {
          // Get last 10 messages from Green API
          const chatHistory = await getChatHistory(chatId, 30);
          
          if (!chatHistory || chatHistory.length === 0) {
            await sendTextMessage(chatId, '📝 אין מספיק הודעות בשיחה כדי ליצור סיכום.');
            break;
          }
          
          // Generate summary with Gemini
          const summaryResult = await generateChatSummary(chatHistory);
          
          if (summaryResult.success && summaryResult.summary) {
            // Send the summary back to the chat
            await sendTextMessage(chatId, `📝 **סיכום השיחה:**\n\n${summaryResult.summary}`);
            
            // Add to conversation history
            await conversationManager.addMessage(chatId, 'user', 'בקשה לסיכום שיחה');
            await conversationManager.addMessage(chatId, 'assistant', `סיכום השיחה: ${summaryResult.summary}`);
            
            console.log(`✅ Chat summary sent to ${senderName}`);
          } else {
            const errorMsg = summaryResult.error || 'לא הצלחתי ליצור סיכום של השיחה.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ Chat summary failed for ${senderName}: ${errorMsg}`);
          }
        } catch (summaryError) {
          console.error('❌ Error in chat summary:', summaryError.message || summaryError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת סיכום השיחה.');
        }
        break;

      case 'command_list':
        console.log(`📜 Processing command list request from ${senderName}`);
        
        try {
          // Define path to the command list file
          const COMMAND_LIST_FILE = path.join(__dirname, '..', 'store', 'commandList.txt');
          
          // Check if file exists
          if (fs.existsSync(COMMAND_LIST_FILE)) {
            // Read the command list file
            const commandListContent = fs.readFileSync(COMMAND_LIST_FILE, 'utf8');
            
            // Send the command list to the user
            await sendTextMessage(chatId, commandListContent);
            console.log(`✅ Command list sent to ${senderName}`);
          } else {
            await sendTextMessage(chatId, '❌ רשימת הפקודות לא נמצאה. פנה למנהל המערכת.');
            console.log(`❌ Command list file not found: ${COMMAND_LIST_FILE}`);
          }
        } catch (commandListError) {
          console.error('❌ Error reading command list:', commandListError.message || commandListError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בטעינת רשימת הפקודות.');
        }
        break;

      case 'clear_all_conversations':
        console.log(`🗑️ Processing clear all conversations request from ${senderName}`);
        
        try {
          const deletedCount = await conversationManager.clearAllConversations();
          if (deletedCount > 0) {
            await sendTextMessage(chatId, `🗑️ כל היסטוריית השיחות נמחקה בהצלחה (${deletedCount} הודעות נמחקו)`);
            console.log(`✅ All conversations cleared by ${senderName}: ${deletedCount} messages deleted`);
          } else {
            await sendTextMessage(chatId, 'ℹ️ לא נמצאה היסטוריית שיחות למחיקה');
            console.log(`ℹ️ No conversations to clear (requested by ${senderName})`);
          }
        } catch (error) {
          console.error('❌ Error clearing all conversations:', error);
          await sendTextMessage(chatId, '❌ שגיאה במחיקת כל היסטוריית השיחות');
        }
        break;

      case 'show_history':
        const history = await conversationManager.getConversationHistory(chatId);
        if (history.length === 0) {
          await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה');
        } else {
          let historyText = '📋 היסטוריית השיחה:\n\n';
          history.forEach((msg, index) => {
            const role = msg.role === 'user' ? '👤 אתה' : '🤖 AI';
            historyText += `${index + 1}. ${role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n\n`;
          });
          await sendTextMessage(chatId, historyText);
        }
        break;

      case 'music_generation':
        console.log(`🎵 Processing music generation request from ${senderName}`);
        
        try {
          // Note: Music generation commands do NOT add to conversation history
          
          // Generate music with Suno (WhatsApp format)
          const musicResult = await generateMusicWithLyrics(command.prompt);
          
          // Debug: Log full metadata structure
          if (musicResult.metadata) {
            console.log('🎵 Suno metadata available:', musicResult.metadata ? 'yes' : 'no');
          }
          
          if (musicResult.error) {
            const errorMsg = musicResult.error || 'לא הצלחתי ליצור שיר. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ Music generation failed for ${senderName}: ${errorMsg}`);
          } else if (musicResult.audioBuffer && musicResult.result) {
            // Convert MP3 to Opus for voice note
            console.log(`🔄 Converting music to Opus format for voice note...`);
            const conversionResult = await audioConverterService.convertAndSaveAsOpus(musicResult.audioBuffer, 'mp3');
            
            if (!conversionResult.success) {
              console.error('❌ Audio conversion failed:', conversionResult.error);
              // Fallback: send as regular MP3 file
              const fileName = `suno_music_${Date.now()}.mp3`;
              const fullAudioUrl = musicResult.result.startsWith('http') 
                ? musicResult.result 
                : getStaticFileUrl(musicResult.result.replace('/static/', ''));
              await sendFileByUrl(chatId, fullAudioUrl, fileName, '');
            } else {
              // Send as voice note with Opus format
              const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
              await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '');
              console.log(`✅ Music sent as voice note: ${conversionResult.fileName}`);
            }
            
            // Send song information and lyrics as separate text message
            let songInfo = '';
            if (musicResult.metadata) {
              const meta = musicResult.metadata;
              
              songInfo = `🎵 **${meta.title || 'שיר חדש'}**\n`;
              if (meta.duration) songInfo += `⏱️ משך: ${Math.round(meta.duration)}s\n`;
              if (meta.model) songInfo += `🤖 מודל: ${meta.model}\n`;
              
              // Add lyrics if available - with better fallback logic
              if (meta.lyrics && meta.lyrics.trim()) {
                songInfo += `\n📝 **מילות השיר:**\n${meta.lyrics}`;
              } else if (meta.lyric && meta.lyric.trim()) {
                songInfo += `\n📝 **מילות השיר:**\n${meta.lyric}`;
              } else if (meta.prompt && meta.prompt.trim()) {
                songInfo += `\n📝 **מילות השיר:**\n${meta.prompt}`;
              } else if (meta.gptDescriptionPrompt && meta.gptDescriptionPrompt.trim()) {
                songInfo += `\n📝 **תיאור השיר:**\n${meta.gptDescriptionPrompt}`;
              } else {
                songInfo += `\n📝 **מילות השיר:** לא זמינות`;
              }
            } else {
              songInfo = `🎵 השיר מוכן!`;
              console.log('⚠️ No metadata available for song');
            }
            
            await sendTextMessage(chatId, songInfo);
            
            // Note: Music generation results do NOT add to conversation history
            
            console.log(`✅ Music sent to ${senderName}: ${musicResult.metadata?.title || 'Generated Music'}`);
          } else {
            await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת השיר.');
            console.log(`❌ Music generation failed for ${senderName}: No audio buffer or result path`);
          }
        } catch (musicError) {
          console.error('❌ Error in music generation:', musicError.message || musicError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת השיר.');
        }
        break;

      case 'text_to_speech':
        console.log(`🗣️ Processing text-to-speech request from ${senderName}`);
        
        try {
          // Note: Text-to-speech commands do NOT add to conversation history
          
          // Generate speech with random voice
          const ttsResult = await voiceService.textToSpeechWithRandomVoice(command.prompt);
          
          if (ttsResult.error) {
            const errorMsg = ttsResult.error || 'לא הצלחתי ליצור דיבור. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ TTS failed for ${senderName}: ${errorMsg}`);
          } else if (ttsResult.audioUrl) {
            // Convert TTS audio to Opus for voice note
            console.log(`🔄 Converting TTS to Opus format for voice note...`);
            const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');
            
            if (!conversionResult.success) {
              console.error('❌ Audio conversion failed:', conversionResult.error);
              // Fallback: send as regular MP3 file
              const fileName = `tts_${Date.now()}.mp3`;
              const fullAudioUrl = ttsResult.audioUrl.startsWith('http') 
                ? ttsResult.audioUrl 
                : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
              await sendFileByUrl(chatId, fullAudioUrl, fileName, '');
            } else {
              // Send as voice note with Opus format
              const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
              await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '');
              console.log(`✅ TTS sent as voice note: ${conversionResult.fileName}`);
            }
            
            // Note: Text-to-speech results do NOT add to conversation history
            
            console.log(`✅ TTS sent to ${senderName}: ${ttsResult.voiceInfo?.voiceName || 'Unknown voice'}`);
          } else {
            await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת הדיבור.');
            console.log(`❌ TTS failed for ${senderName}: No audio URL in result`);
          }
        } catch (ttsError) {
          console.error('❌ Error in text-to-speech:', ttsError.message || ttsError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת הדיבור.');
        }
        break;

      case 'help':
        const helpMessage = '🤖 Green API Bot Commands:\n\n✨ **הפקודות עובדות גם כשאתה שולח אותן!**\n💬 כל פקודה שתשלח תעבד וההתשובה תחזור לאותה שיחה\n\n💬 AI Chat:\n🔮 * [שאלה] - Gemini Chat\n🤖 # [שאלה] - OpenAI Chat\n🚀 + [שאלה] - Grok Chat\n\n🎨 יצירת תמונות:\n🖼️ ** [תיאור] - יצירת תמונה עם Gemini\n🖼️ ## [תיאור] - יצירת תמונה עם OpenAI\n\n🎬 יצירת וידאו:\n🎥 #### [תיאור] - יצירת וידאו עם Veo 3 (9:16, איכות מקסימלית)\n🎥 ### [תיאור] - יצירת וידאו עם Kling 2.1 Master (9:16)\n🎬 שלח תמונה עם כותרת: ### [תיאור] - וידאו מתמונה עם Veo 3\n🎬 שלח תמונה עם כותרת: ## [תיאור] - וידאו מתמונה עם Kling 2.1\n🎬 שלח וידאו עם כותרת: ## [תיאור] - עיבוד וידאו עם RunwayML Gen4\n\n🎵 יצירת מוזיקה:\n🎶 **** [תיאור] - יצירת שיר עם Suno (עד 20 דקות)\n📝 דוגמה: **** שיר עצוב על גשם בחורף\n🎵 השיר נשלח כ-voice note + מילות השיר בהודעת טקסט\n\n🗣️ יצירת דיבור:\n🎙️ *** [טקסט] - Text-to-Speech עם ElevenLabs (קול אקראי)\n📝 דוגמה: *** שלום, איך שלומך היום?\n🎤 הדיבור נשלח כ-voice note\n\n🎤 עיבוד קולי:\n🗣️ שלח הקלטה קולית - תמלול + תגובת AI + שיבוט קול\n📝 Flow: קול → תמלול → Gemini → קול חדש בקולך\n🎤 התגובה הקולית נשלחת כ-voice note\n⚠️ הודעות קוליות שלך לא מתעבדות (רק נכנסות)\n\n✨ עריכת תמונות:\n🎨 שלח תמונה עם כותרת: * [הוראות עריכה] - Gemini\n🖼️ שלח תמונה עם כותרת: # [הוראות עריכה] - OpenAI\n\n⚙️ ניהול שיחה:\n📝 סכם שיחה - סיכום 10 ההודעות האחרונות\n🗑️ /clear - מחיקת היסטוריה\n📝 /history - הצגת היסטוריה\n❓ /help - הצגת עזרה זו\n\n🔊 בקרת תמלול:\nℹ️ סטטוס תמלול - בדיקת מצב התמלול + רשימת מורשים\n✅ הוסף לתמלול <שם> - הוספת איש קשר לרשימת המורשים\n🚫 הסר מתמלול <שם> - הסרת איש קשר מרשימת המורשים\n\n💡 דוגמאות:\n* מה ההבדל בין AI לבין ML?\n# כתוב לי שיר על חתול\n+ מה אתה חושב על העתיד של AI?\n** חתול כתום שיושב על עץ\n#### שפן אומר Hi\n### חתול רוקד בגשם\n**** שיר רוק על אהבה\n*** שלום, איך שלומך היום?\n🎨 תמונה + כותרת: * הוסף כובע אדום\n🖼️ תמונה + כותרת: # הפוך רקע לכחול\n🎬 תמונה + כותרת: ### הנפש את התמונה עם Veo 3\n🎬 תמונה + כותרת: ## הנפש את התמונה עם Kling\n🎬 וידאו + כותרת: ## שפר את הווידאו ותוסיף אפקטים\n🎤 שלח הקלטה קולית לעיבוד מלא\n📝 סכם שיחה\n🚫 הסר מתמלול קרלוס\n✅ הוסף לתמלול דנה';

        await sendTextMessage(chatId, helpMessage);
        break;

      case 'media_creation_status':
        try {
          const status = await authStore.getStatus();
          const allowList = status.authorizedUsers;
          
          const statusIcon = status.closedByDefault ? '🔐' : '🔐';
          const statusText = status.closedByDefault ? 'סגור לכולם (ברירת מחדל)' : 'מוגבל למורשים';
          let statusMessage = `${statusIcon} סטטוס יצירת תוכן מולטימדיה: ${statusText}`;
          
          if (allowList.length > 0) {
            const allowedList = allowList.join('\n• ');
            statusMessage += `\n\n✅ אנשי קשר מורשים (${allowList.length}):\n• ${allowedList}`;
          } else {
            statusMessage += '\n\nℹ️ אין אנשי קשר מורשים (יצירה סגורה לכולם)';
          }
          
          statusMessage += '\n\n📋 פקודות ניהול:\n' +
            '• הוסף ליצירה [שם] - הוספת הרשאה\n' +
            '• הסר מיצירה [שם] - הסרת הרשאה\n' +
            '• סטטוס יצירה - הצגת מצב נוכחי';
          
          await sendTextMessage(chatId, statusMessage);
        } catch (error) {
          console.error('❌ Error getting media creation status:', error);
          await sendTextMessage(chatId, '❌ שגיאה בבדיקת סטטוס יצירת תוכן');
        }
        break;

      case 'voice_transcription_status':
        try {
          const allowList = await conversationManager.getVoiceAllowList();
          
          const statusIcon = '🔐';
          const statusText = allowList.length > 0 ? 'מוגבל למורשים' : 'סגור לכולם (ברירת מחדל)';
          let statusMessage = `${statusIcon} סטטוס תמלול הודעות קוליות: ${statusText}`;
          
          if (allowList.length > 0) {
            const allowedList = allowList.join('\n• ');
            statusMessage += `\n\n✅ אנשי קשר מורשים (${allowList.length}):\n• ${allowedList}`;
          } else {
            statusMessage += '\n\nℹ️ אין אנשי קשר מורשים (תמלול סגור לכולם)';
          }
          
          statusMessage += '\n\n📋 פקודות ניהול:\n' +
            '• הוסף לתמלול [שם] - הוספת הרשאה\n' +
            '• הסר מתמלול [שם] - הסרת הרשאה\n' +
            '• סטטוס תמלול - הצגת מצב נוכחי';
          
          await sendTextMessage(chatId, statusMessage);
          console.log(`ℹ️ Voice transcription status checked by ${senderName}: ${statusText}, allowed: ${allowList.length}`);
        } catch (error) {
          console.error('❌ Error getting voice transcription status:', error);
          await sendTextMessage(chatId, '❌ שגיאה בקבלת סטטוס התמלול');
        }
        break;

      case 'exclude_from_transcription':
        // Note: "הסר מתמלול" now means "remove from allow list" (opposite logic)
        try {
          const wasRemoved = await conversationManager.removeFromVoiceAllowList(command.contactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${command.contactName} הוסר מרשימת המורשים - הודעות קוליות שלו לא יתומללו`);
            console.log(`🚫 Contact ${command.contactName} removed from voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${command.contactName} כבר לא היה ברשימת המורשים`);
            console.log(`ℹ️ Contact ${command.contactName} was not in allow list (requested by ${senderName})`);
          }
        } catch (error) {
          console.error('❌ Error removing from voice allow list:', error);
          await sendTextMessage(chatId, '❌ שגיאה בהסרה מרשימת המורשים');
        }
        break;

      case 'include_in_transcription':
        // Note: "הוסף לתמלול" now means "add to allow list"
        try {
          const wasAdded = await conversationManager.addToVoiceAllowList(command.contactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${command.contactName} נוסף לרשימת המורשים - הודעות קוליות שלו יתומללו`);
            console.log(`✅ Contact ${command.contactName} added to voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${command.contactName} כבר היה ברשימת המורשים`);
            console.log(`ℹ️ Contact ${command.contactName} was already in allow list (requested by ${senderName})`);
          }
        } catch (error) {
          console.error('❌ Error adding to voice allow list:', error);
          await sendTextMessage(chatId, '❌ שגיאה בהוספה לרשימת המורשים');
        }
        break;

      case 'add_media_authorization':
        try {
          const wasAdded = await authStore.addAuthorizedUser(command.contactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${command.contactName} נוסף לרשימת המורשים ליצירת תוכן מולטימדיה`);
            console.log(`✅ Added ${command.contactName} to media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${command.contactName} כבר נמצא ברשימת המורשים ליצירת תוכן מולטימדיה`);
          }
        } catch (error) {
          console.error('❌ Error adding media authorization:', error);
          await sendTextMessage(chatId, '❌ שגיאה בהוספה לרשימת המורשים ליצירת תוכן');
        }
        break;

      case 'remove_media_authorization':
        try {
          const wasRemoved = await authStore.removeAuthorizedUser(command.contactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `✅ ${command.contactName} הוסר מרשימת המורשים ליצירת תוכן מולטימדיה`);
            console.log(`✅ Removed ${command.contactName} from media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${command.contactName} לא נמצא ברשימת המורשים ליצירת תוכן מולטימדיה`);
          }
        } catch (error) {
          console.error('❌ Error removing media authorization:', error);
          await sendTextMessage(chatId, '❌ שגיאה בהסרה מרשימת המורשים ליצירת תוכן');
        }
        break;

      default:
        console.log(`❓ Unknown command type: ${command.type}`);
    }
  } catch (error) {
    console.error('❌ Error executing command:', error.message || error);
    await sendTextMessage(chatId, `❌ ${error.message || error}`);
  }
}

/**
 * Parse text message to extract command
 */
function parseTextCommand(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  text = text.trim();

  // Music Generation command: **** + space + text
  if (text.startsWith('**** ')) {
    const prompt = text.substring(5).trim(); // Remove "**** "
    return {
      type: 'music_generation',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Text-to-Speech command: *** + space + text
  if (text.startsWith('*** ')) {
    const prompt = text.substring(4).trim(); // Remove "*** "
    return {
      type: 'text_to_speech',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Veo 3 Video Generation command: #### + space + text
  if (text.startsWith('#### ')) {
    const prompt = text.substring(5).trim(); // Remove "#### "
    return {
      type: 'veo3_video',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Kling Text-to-Video Generation command: ### + space + text
  if (text.startsWith('### ')) {
    const prompt = text.substring(4).trim(); // Remove "### "
    return {
      type: 'kling_text_to_video',
      prompt: prompt,
      originalMessage: text
    };
  }

  // OpenAI Image Generation command: ## + space + text
  if (text.startsWith('## ')) {
    const prompt = text.substring(3).trim(); // Remove "## "
    return {
      type: 'openai_image',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Gemini Image Generation command: ** + space + text
  if (text.startsWith('** ')) {
    const prompt = text.substring(3).trim(); // Remove "** "
    return {
      type: 'gemini_image',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Gemini Chat command: * + space + text
  if (text.startsWith('* ')) {
    const prompt = text.substring(2).trim(); // Remove "* "
    return {
      type: 'gemini_chat',
      prompt: prompt,
      originalMessage: text
    };
  }

  // OpenAI Chat command: # + space + text
  if (text.startsWith('# ')) {
    const prompt = text.substring(2).trim(); // Remove "# "
    return {
      type: 'openai_chat',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Grok Image Generation command: ++ + space + text
  if (text.startsWith('++ ')) {
    const prompt = text.substring(3).trim(); // Remove "++ "
    return {
      type: 'grok_image',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Grok Chat command: + + space + text
  if (text.startsWith('+ ')) {
    const prompt = text.substring(2).trim(); // Remove "+ "
    return {
      type: 'grok_chat',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Chat summary
  if (text === 'סכם שיחה') {
    return { type: 'chat_summary' };
  }

  // Command list
  if (text === 'רשימת פקודות') {
    return { type: 'command_list' };
  }

  // Clear conversation history (admin command)
  if (text === 'נקה היסטוריה') {
    return { type: 'clear_all_conversations' };
  }

  // Show history
  if (text.toLowerCase() === '/history') {
    return { type: 'show_history' };
  }

  // Help
  if (text.toLowerCase() === '/help') {
    return { type: 'help' };
  }

  // Media creation status
  if (text === 'סטטוס יצירה') {
    return { type: 'media_creation_status' };
  }

  // Voice transcription controls
  if (text === 'סטטוס תמלול') {
    return { type: 'voice_transcription_status' };
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

module.exports = router;
