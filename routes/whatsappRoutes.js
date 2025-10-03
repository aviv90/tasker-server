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

        // Router-based direct execution - call services directly
        const prompt = decision.args?.prompt || normalized.userText.replace(/^#\s+/, '').trim();
        
        try {
          switch (decision.tool) {
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
              await sendAck(chatId, { type: 'gemini_chat' });
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGeminiResponse(prompt, { contextMessages });
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              } else {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              }
              return;
            }
            
            case 'openai_chat': {
              await sendAck(chatId, { type: 'openai_chat' });
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateOpenAIResponse(prompt, { contextMessages });
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              } else {
                await sendTextMessage(chatId, `❌ ${result.error}`);
              }
              return;
            }
            
            case 'grok_chat': {
              await sendAck(chatId, { type: 'grok_chat' });
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGrokResponse(prompt, { contextMessages });
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
              await sendAck(chatId, { type: 'gemini_image' });
              const imageResult = await generateImageForWhatsApp(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                const fileName = `gemini_image_${Date.now()}.png`;
                const caption = imageResult.description || '';
                await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
              } else if (imageResult.textResponse) {
                await sendTextMessage(chatId, imageResult.textResponse);
              } else {
                await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
              }
              return;
            }
            
            case 'openai_image': {
              await sendAck(chatId, { type: 'openai_image' });
              const imageResult = await generateOpenAIImage(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                const fileName = `openai_image_${Date.now()}.png`;
                const caption = imageResult.description || '';
                await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
              } else {
                await sendTextMessage(chatId, `❌ ${imageResult.error || 'לא הצלחתי ליצור תמונה'}`);
              }
              return;
            }
            
            case 'grok_image': {
              // Grok doesn't have image generation - fallback to Gemini
              await sendAck(chatId, { type: 'gemini_image' });
              const imageResult = await generateImageForWhatsApp(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                const fileName = `gemini_image_${Date.now()}.png`;
                await sendFileByUrl(chatId, imageResult.imageUrl, fileName, imageResult.description || '');
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
              if (messageData.typeMessage === 'imageMessage') {
                const imageData = messageData.fileMessageData || messageData.imageMessageData;
                const service = decision.tool === 'veo3_image_to_video' ? 'veo3' : 'kling';
                processImageToVideoAsync({
                  chatId, senderId, senderName,
                  imageUrl: imageData.downloadUrl,
                  prompt: prompt,
                  service: service
                });
              }
              return;
              
            case 'image_edit':
              if (messageData.typeMessage === 'imageMessage') {
                const imageData = messageData.fileMessageData || messageData.imageMessageData;
                const service = decision.args?.service || 'gemini';
                processImageEditAsync({
                  chatId, senderId, senderName,
                  imageUrl: imageData.downloadUrl,
                  prompt: decision.args.prompt || prompt,
                  service: service
                });
              }
              return;
              
            case 'video_to_video':
              if (messageData.typeMessage === 'videoMessage') {
                const videoData = messageData.fileMessageData || messageData.videoMessageData;
                processVideoToVideoAsync({
                  chatId, senderId, senderName,
                  videoUrl: videoData.downloadUrl,
                  prompt: decision.args?.prompt || prompt
                });
              }
              return;
            
            // ═══════════════════ TEXT-TO-SPEECH ═══════════════════
            case 'text_to_speech': {
              await sendAck(chatId, { type: 'text_to_speech' });
              const text = decision.args?.text || prompt;
              const languageCode = detectLanguage(text);
              const voiceId = getVoiceForLanguage(languageCode);
              const ttsResult = await voiceService.textToSpeech(voiceId, text, {
                modelId: 'eleven_v3',
                outputFormat: 'mp3_44100_128',
                languageCode: languageCode
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
                await sendTextMessage(chatId, '❌ לא הצלחתי ליצור קול');
              }
              return;
            }
            
            // ═══════════════════ MUSIC GENERATION ═══════════════════
            case 'music_generation': {
              await sendAck(chatId, { type: 'music_generation' });
              const musicResult = await generateMusicWithLyrics(prompt, {
                callbackUrl: null,
                whatsappContext: { chatId, senderId, senderName }
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
              const chatHistory = await getChatHistory(chatId, 30);
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
            
            case 'creative_voice_processing':
              // Voice messages are handled by separate block below
              break;
              
            default:
              console.log(`⚠️ Unknown tool from router: ${decision.tool}`);
              break;
          }
        } catch (toolError) {
          console.error(`❌ Error executing tool ${decision.tool}:`, toolError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד הבקשה');
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
            case 'kling_text_to_video': {
              // Process image-to-video directly - don't fall through to legacy
              const service = decision.tool === 'veo3_video' ? 'veo3' : 'kling';
              console.log(`🎬 ${service} image-to-video request (via router)`);
              
              // Check authorization
              if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
                await sendUnauthorizedMessage(chatId, 'video creation');
                return;
              }
              
              // Process image-to-video asynchronously
              processImageToVideoAsync({
                chatId,
                senderId,
                senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args?.prompt || routedPrompt,
                service: service
              });
              return; // Stop processing - we handled it
            }
            case 'image_edit': {
              // Process image edit directly - don't fall through to legacy
              const service = decision.args?.service || 'gemini';
              console.log(`🎨 ${service} image edit request (via router, image block)`);
              
              // Check authorization
              if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
                await sendUnauthorizedMessage(chatId, 'image editing');
                return;
              }
              
              // Process image editing asynchronously
              processImageEditAsync({
                chatId,
                senderId,
                senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args.prompt,
                service: service
              });
              return; // Stop processing - we handled it
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
            case 'grok_chat': {
              const chatPrefix = decision.tool === 'gemini_chat' ? '* ' : decision.tool === 'openai_chat' ? '# ' : '+ ';
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: chatPrefix + routedPrompt });
              return;
            }
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
      
      // Legacy prefixes removed - all image operations now go through router with "# " prefix
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
            case 'video_to_video': {
              // Process video-to-video directly - don't fall through to legacy
              console.log(`🎬 RunwayML Gen4 video-to-video request (via router, video block)`);
              
              // Check authorization for media creation
              if (!(await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }))) {
                await sendUnauthorizedMessage(chatId, 'video editing');
                return;
              }
              
              // Process video-to-video asynchronously
              processVideoToVideoAsync({
                chatId,
                senderId,
                senderName,
                videoUrl: videoData.downloadUrl,
                prompt: decision.args?.prompt || routedPrompt
              });
              return; // Stop processing - we handled it
            }
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
            case 'grok_chat': {
              const chatPrefix = decision.tool === 'gemini_chat' ? '* ' : decision.tool === 'openai_chat' ? '# ' : '+ ';
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: chatPrefix + routedPrompt });
              return;
            }
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
      
      // Legacy prefixes removed - all video operations now go through router with "# " prefix
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
    
    // Unified intent router for outgoing when text starts with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        const chatId = senderData.chatId;
        const senderId = senderData.sender;
        const senderName = senderData.senderName || senderId;
        const senderContactName = senderData.senderContactName || "";
        const chatName = senderData.chatName || "";

        const normalized = {
          userText: messageText.trim(),
          hasImage: messageData.typeMessage === 'imageMessage',
          hasVideo: messageData.typeMessage === 'videoMessage',
          hasAudio: messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage',
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            // Outgoing bypasses authorization in existing logic, but router still expects booleans
            media_creation: true,
            voice_allowed: true
          }
        };

        const decision = await routeIntent(normalized);
        const prompt = normalized.userText.replace(/^#\s+/, '').trim();

        // Router-based direct execution for outgoing messages (same as incoming)
        try {
          switch (decision.tool) {
            // ═══════════════════ CHAT ═══════════════════
            case 'gemini_chat': {
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGeminiResponse(prompt, { contextMessages });
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              }
              return;
            }
            case 'openai_chat': {
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateOpenAIResponse(prompt, { contextMessages });
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              }
              return;
            }
            case 'grok_chat': {
              const contextMessages = await conversationManager.getRecentMessages(chatId, 10);
              await conversationManager.addMessage(chatId, 'user', prompt);
              const result = await generateGrokResponse(prompt, { contextMessages });
              if (!result.error) {
                await conversationManager.addMessage(chatId, 'assistant', result.text);
                await sendTextMessage(chatId, result.text);
              }
              return;
            }
            
            // ═══════════════════ IMAGE GENERATION ═══════════════════
            case 'gemini_image': {
              const imageResult = await generateImageForWhatsApp(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `gemini_image_${Date.now()}.png`, imageResult.description || '');
              }
              return;
            }
            case 'openai_image': {
              const imageResult = await generateOpenAIImage(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `openai_image_${Date.now()}.png`, imageResult.description || '');
              }
              return;
            }
            case 'grok_image': {
              const imageResult = await generateImageForWhatsApp(prompt);
              if (imageResult.success && imageResult.imageUrl) {
                await sendFileByUrl(chatId, imageResult.imageUrl, `gemini_image_${Date.now()}.png`, imageResult.description || '');
              }
              return;
            }
            
            // ═══════════════════ VIDEO GENERATION ═══════════════════
            case 'veo3_video': {
              const videoResult = await generateVideoForWhatsApp(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                await sendFileByUrl(chatId, videoResult.videoUrl, `veo3_video_${Date.now()}.mp4`, '');
              }
              return;
            }
            case 'kling_text_to_video': {
              const videoResult = await generateKlingVideoFromText(prompt);
              if (videoResult.success && videoResult.videoUrl) {
                await sendFileByUrl(chatId, videoResult.videoUrl, videoResult.fileName || `kling_video_${Date.now()}.mp4`, '');
              }
              return;
            }
            
            // ═══════════════════ IMAGE/VIDEO EDITING ═══════════════════
            case 'image_edit':
              if (messageData.typeMessage === 'imageMessage') {
                const imageData = messageData.fileMessageData || messageData.imageMessageData;
                const service = decision.args?.service || 'gemini';
                processImageEditAsync({
                  chatId, senderId, senderName,
                  imageUrl: imageData.downloadUrl,
                  prompt: decision.args.prompt || prompt,
                  service: service
                });
              }
              return;
              
            case 'video_to_video':
              if (messageData.typeMessage === 'videoMessage') {
                const videoData = messageData.fileMessageData || messageData.videoMessageData;
                processVideoToVideoAsync({
                  chatId, senderId, senderName,
                  videoUrl: videoData.downloadUrl,
                  prompt: decision.args?.prompt || prompt
                });
              }
              return;
            
            // ═══════════════════ TEXT-TO-SPEECH ═══════════════════
            case 'text_to_speech': {
              const text = decision.args?.text || prompt;
              const languageCode = detectLanguage(text);
              const voiceId = getVoiceForLanguage(languageCode);
              const ttsResult = await voiceService.textToSpeech(voiceId, text, {
                modelId: 'eleven_v3',
                outputFormat: 'mp3_44100_128',
                languageCode: languageCode
              });
              if (!ttsResult.error) {
                const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');
                if (conversionResult.success) {
                  await sendFileByUrl(chatId, getStaticFileUrl(conversionResult.fileName), conversionResult.fileName, '');
                } else {
                  const fallbackUrl = ttsResult.audioUrl.startsWith('http') ? ttsResult.audioUrl : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
                  await sendFileByUrl(chatId, fallbackUrl, `tts_${Date.now()}.mp3`, '');
                }
              }
              return;
            }
            
            // ═══════════════════ MUSIC GENERATION ═══════════════════
            case 'music_generation': {
              const musicResult = await generateMusicWithLyrics(prompt, {
                callbackUrl: null,
                whatsappContext: { chatId, senderId, senderName }
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
              const chatHistory = await getChatHistory(chatId, 30);
              if (chatHistory && chatHistory.length > 0) {
                const summaryResult = await generateChatSummary(chatHistory);
                if (!summaryResult.error) {
                  await sendTextMessage(chatId, `📝 **סיכום השיחה:**\n\n${summaryResult.text}`);
                }
              }
              return;
            }
            
            default:
              console.log(`⚠️ Unknown tool from router (outgoing): ${decision.tool}`);
              break;
          }
        } catch (toolError) {
          console.error(`❌ Error executing tool ${decision.tool} (outgoing):`, toolError);
        }
      } catch (routerError) {
        console.error('❌ Intent router (outgoing text) error:', routerError.message || routerError);
      }
    }

    // Handle image messages for image-to-image editing
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      console.log(`🖼️ Outgoing image message received with caption: "${caption}"`);
      
      // Router for outgoing image caption starting with "# "
      if (/^#\s+/.test(caption.trim())) {
        try {
          const normalized = {
            userText: caption.trim(),
            hasImage: true,
            hasVideo: false,
            hasAudio: false,
            chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
            language: 'he',
            authorizations: { media_creation: true, voice_allowed: true }
          };
          const decision = await routeIntent(normalized);
          const routedPrompt = normalized.userText.replace(/^#\s+/, '').trim();
          switch (decision.tool) {
            case 'image_edit': {
              // Process image edit directly - don't fall through to legacy
              const service = decision.args?.service || 'gemini';
              console.log(`🎨 ${service} image edit request (outgoing, image block, via router)`);
              
              // Process image editing asynchronously
              processImageEditAsync({
                chatId,
                senderId,
                senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args.prompt,
                service: service
              });
              return; // Stop processing - we handled it
            }
            case 'veo3_video':
            case 'kling_text_to_video': {
              // Process image-to-video directly - don't fall through to legacy
              const service = decision.tool === 'veo3_video' ? 'veo3' : 'kling';
              console.log(`🎬 ${service} image-to-video request (outgoing, via router)`);
              
              // Process image-to-video asynchronously
              processImageToVideoAsync({
                chatId,
                senderId,
                senderName,
                imageUrl: imageData.downloadUrl,
                prompt: decision.args?.prompt || routedPrompt,
                service: service
              });
              return; // Stop processing - we handled it
            }
            case 'gemini_image':
            case 'openai_image':
            case 'grok_image':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: (decision.tool === 'gemini_image' ? '** ' : decision.tool === 'openai_image' ? '## ' : '++ ') + routedPrompt }, true);
              return;
            case 'music_generation':
              processTextMessageAsync({ chatId, senderId, senderName, senderContactName, chatName, messageText: '**** ' + routedPrompt }, true);
              return;
            default:
              break; // continue legacy
          }
        } catch (e) {
          console.error('❌ Intent router (outgoing image caption) error:', e.message || e);
        }
      }

      // Legacy prefixes removed - all image operations now go through router with "# " prefix
    }
    // Handle video messages for video-to-video processing
    else if (messageData.typeMessage === 'videoMessage') {
      const videoData = messageData.fileMessageData || messageData.videoMessageData;
      const caption = videoData?.caption || '';
      
      console.log(`🎬 Outgoing video message received with caption: "${caption}"`);
      
      // Legacy prefixes removed - all video operations now go through router with "# " prefix
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
  console.log(`🎨 Processing ${service} image edit request from ${senderName}`);
  
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
  console.log(`🎬 Processing ${serviceName} image-to-video request from ${senderName}`);
  
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
  console.log(`🎬 Processing RunwayML Gen4 video-to-video request from ${senderName}`);
  
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
    console.log(`📝 Transcription complete`);

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
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד ההקלטה הקולית.');
  }
}
*/

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
