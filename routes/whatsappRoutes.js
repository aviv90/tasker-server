const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const { generateTextResponse: generateOpenAIResponse, generateImageForWhatsApp: generateOpenAIImage, editImageForWhatsApp: editOpenAIImage } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp, generateVideoForWhatsApp, generateVideoFromImageForWhatsApp } = require('../services/geminiService');
const { generateVideoFromImageForWhatsApp: generateKlingVideoFromImage, generateVideoFromVideoForWhatsApp: generateRunwayVideoFromVideo } = require('../services/replicateService');
const speechService = require('../services/speechService');
const { voiceService } = require('../services/voiceService');
const conversationManager = require('../services/conversationManager');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

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
      ackMessage = '🎨 קיבלתי. מיד יוצר תמונה';
      break;
    case 'openai_image':
      ackMessage = '🖼️ קיבלתי. מיד יוצר תמונה';
      break;
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי. מיד יוצר וידאו עם Veo 3';
      break;
    case 'veo3_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Veo 3';
      break;
    case 'kling_image_to_video':
      ackMessage = '🎬 קיבלתי את התמונה. מיד יוצר וידאו עם Kling 2.1';
      break;
    case 'voice_processing':
      ackMessage = '🎤 קיבלתי את ההקלטה. מתחיל עיבוד קולי...';
      break;
    case 'runway_video_to_video':
      ackMessage = '🎬 קיבלתי את הווידאו. מיד עובד עליו עם RunwayML Gen4';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי. מיד יוצר קול';
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
    console.log('📱 Green API webhook received:', JSON.stringify(webhookData, null, 2));

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
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
    
    console.log(`📱 Message from: ${senderName} (${chatId})`);
    console.log(`📋 Message type: ${messageData.typeMessage}`);
    console.log(`🆔 Message ID: ${messageId}`);
    
    // Handle text messages (both regular and extended)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
      console.log(`📝 Regular text message: "${messageText}"`);
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
      console.log(`📝 Extended text message: "${messageText}"`);
    }
    
    // Handle image messages for image-to-image editing
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      console.log(`🖼️ Image message received with caption: "${caption}"`);
      
      // Check if caption starts with "### " for Veo 3 image-to-video
      if (caption.startsWith('### ')) {
        const prompt = caption.substring(4).trim(); // Remove "### "
        console.log(`🎬 Veo 3 image-to-video request with prompt: "${prompt}"`);
        
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
      
      // Check if caption starts with "## " for RunwayML Gen4 video-to-video
      if (caption.startsWith('## ')) {
        const prompt = caption.substring(3).trim(); // Remove "## "
        console.log(`🎬 RunwayML Gen4 video-to-video request with prompt: "${prompt}"`);
        
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
    // Handle voice messages for voice-to-voice processing
    else if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage') {
      const audioData = messageData.fileMessageData || messageData.audioMessageData;
      
      console.log(`🎤 Voice message received`);
      
      // Process voice-to-voice asynchronously
      processVoiceMessageAsync({
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
 * Process text message asynchronously (no await from webhook)
 */
function processTextMessageAsync(messageData) {
  // Run in background without blocking webhook response
  handleTextMessage(messageData).catch(error => {
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
      ? '🎨 קיבלתי את התמונה. מיד עורך אותה עם Gemini...'
      : '🖼️ קיבלתי את התמונה. מיד עורך אותה עם OpenAI...';
    await sendTextMessage(chatId, ackMessage);
    
    // Add user message to conversation
    conversationManager.addMessage(chatId, 'user', `עריכת תמונה (${service}): ${prompt}`);
    
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
    
    if (editResult.success && editResult.imageUrl) {
      // Send the edited image with caption
      const fileName = `${service}_edit_${Date.now()}.png`;
      const caption = editResult.description && editResult.description.length > 0 
        ? editResult.description 
        : '';
      
      await sendFileByUrl(chatId, editResult.imageUrl, fileName, caption);
      
      // Add AI response to conversation history
      if (caption) {
        conversationManager.addMessage(chatId, 'assistant', caption);
      }
      
      console.log(`✅ ${service} edited image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
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
    
    // Add user message to conversation
    conversationManager.addMessage(chatId, 'user', `יצירת וידאו מתמונה (${serviceName}): ${prompt}`);
    
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
      conversationManager.addMessage(chatId, 'assistant', `וידאו נוצר מתמונה (${serviceName}): ${videoResult.description || 'וידאו חדש'}`);
      
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
    
    // Add user message to conversation
    conversationManager.addMessage(chatId, 'user', `עיבוד וידאו: ${prompt}`);
    
    // Download the video first
    const videoBuffer = await downloadFile(videoUrl);
    
    // Generate video with RunwayML Gen4
    const videoResult = await generateRunwayVideoFromVideo(videoBuffer, prompt);
    
    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `runway_video_${Date.now()}.mp4`;
      
      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
      
      // Add AI response to conversation history
      conversationManager.addMessage(chatId, 'assistant', `וידאו עובד מחדש: ${videoResult.description || 'וידאו חדש'}`);
      
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
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
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
      await sendTextMessage(chatId, `❌ סליחה, לא הצלחתי לתמלל את ההקלטה: ${transcriptionResult.error}`);
      return;
    }

    const transcribedText = transcriptionResult.text;
    console.log(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);
    console.log(`📝 Transcribed: "${transcribedText}"`);

    // Send transcription to user first
    await sendTextMessage(chatId, `📝 תמלול: "${transcribedText}"`);

    // Step 2: Create Instant Voice Clone
    console.log(`🔄 Step 2: Creating voice clone...`);
    const voiceCloneOptions = {
      name: `WhatsApp Voice Clone ${Date.now()}`,
      description: `Voice clone from WhatsApp audio`,
      removeBackgroundNoise: true,
      labels: JSON.stringify({
        accent: transcriptionResult.detectedLanguage === 'he' ? 'hebrew' : 'natural',
        use_case: 'conversational',
        quality: 'high',
        style: 'natural',
        language: transcriptionResult.detectedLanguage || 'he'
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

    // Add user message to conversation
    conversationManager.addMessage(chatId, 'user', `הקלטה קולית: ${transcribedText}`);

    // Step 3: Generate Gemini response
    console.log(`🔄 Step 3: Generating Gemini response...`);
    const history = conversationManager.getHistory(chatId);
    const geminiResult = await generateGeminiResponse(transcribedText, history);
    
    let textForTTS = transcribedText; // Default to original text
    
    if (geminiResult.error) {
      console.warn('⚠️ Gemini generation failed:', geminiResult.error);
      console.log('📝 Using original transcribed text for TTS');
    } else {
      textForTTS = geminiResult.text;
      console.log(`✅ Step 3 complete: Gemini generated ${textForTTS.length} characters`);
      console.log(`💬 Gemini response: "${textForTTS.substring(0, 100)}..."`);
      
      // Add AI response to conversation history
      conversationManager.addMessage(chatId, 'assistant', textForTTS);
    }

    // Step 4: Text-to-Speech with cloned voice
    console.log(`🔄 Step 4: Converting text to speech with cloned voice...`);
    
    const ttsOptions = {
      modelId: 'eleven_v3', // Use the most advanced model
      outputFormat: 'mp3_44100_128',
      languageCode: detectedLanguage !== 'auto' ? detectedLanguage : 'he'
    };

    const ttsResult = await voiceService.textToSpeech(voiceId, textForTTS, ttsOptions);
    
    if (ttsResult.error) {
      console.error('❌ Text-to-speech failed:', ttsResult.error);
      // If TTS fails, send text response instead
      await sendTextMessage(chatId, `💬 ${textForTTS}`);
      return;
    }

    console.log(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

    // Step 5: Send voice response back to user
    const fileName = `voice_response_${Date.now()}.mp3`;
    
    // Convert relative URL to full URL for Green API
    const fullAudioUrl = ttsResult.audioUrl.startsWith('http') 
      ? ttsResult.audioUrl 
      : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
    
    await sendFileByUrl(chatId, fullAudioUrl, fileName, '');
    
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

/**
 * Handle text message with AI chat functionality
 */
async function handleTextMessage({ chatId, senderId, senderName, messageText }) {
  console.log(`💬 Processing text: "${messageText}"`);
  
  const command = parseTextCommand(messageText);
  
  if (!command) {
    console.log('ℹ️ Not a recognized command, ignoring');
    return;
  }

  console.log(`🤖 Executing command: ${command.type}`);

  // Send immediate ACK for long-running commands
  await sendAck(chatId, command);

  try {
    switch (command.type) {
      case 'gemini_chat':
        console.log(`🤖 Processing Gemini chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const history = conversationManager.getHistory(chatId);
          
          // Generate Gemini response
          const geminiResponse = await generateGeminiResponse(command.prompt, history);
          
          if (geminiResponse.error) {
            await sendTextMessage(chatId, geminiResponse.error);
            console.log(`❌ Gemini error for ${senderName}: ${geminiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
            await sendTextMessage(chatId, geminiResponse.text);
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
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const openaiHistory = conversationManager.getHistory(chatId);
          
          // Generate OpenAI response
          const openaiResponse = await generateOpenAIResponse(command.prompt, openaiHistory);
          
          if (openaiResponse.error) {
            await sendTextMessage(chatId, openaiResponse.error);
            console.log(`❌ OpenAI error for ${senderName}: ${openaiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', openaiResponse.text);
            await sendTextMessage(chatId, openaiResponse.text);
          }
        } catch (openaiError) {
          console.error('❌ Error in OpenAI chat:', openaiError.message || openaiError);
          await sendTextMessage(chatId, `❌ ${openaiError.message || openaiError}`);
        }
        break;

      case 'openai_image':
        console.log(`🖼️ Processing OpenAI image generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת תמונה: ${command.prompt}`);
          
          // Generate image with OpenAI (WhatsApp format)
          const openaiImageResult = await generateOpenAIImage(command.prompt);
          
          if (openaiImageResult.success && openaiImageResult.imageUrl) {
            // Send the generated image with text as caption (if exists)
            const fileName = `openai_image_${Date.now()}.png`;
            const caption = openaiImageResult.description && openaiImageResult.description.length > 0 
              ? openaiImageResult.description 
              : '';
            
            await sendFileByUrl(chatId, openaiImageResult.imageUrl, fileName, caption);
            
            // Add AI response to conversation history
            if (caption) {
              conversationManager.addMessage(chatId, 'assistant', caption);
            }
            
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
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת תמונה: ${command.prompt}`);
          
          // Generate image with Gemini (WhatsApp format)
          const imageResult = await generateImageForWhatsApp(command.prompt);
          
          if (imageResult.success && imageResult.imageUrl) {
            // Send the generated image with text as caption
            const fileName = `gemini_image_${Date.now()}.png`;
            const caption = imageResult.description && imageResult.description.length > 0 
              ? imageResult.description 
              : '';
            
            await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
            
            // Add both user request and AI response to conversation history
            if (caption) {
              conversationManager.addMessage(chatId, 'assistant', caption);
            }
            
            console.log(`✅ Gemini image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
          } else {
            // Check if Gemini returned text instead of image
            if (imageResult.textResponse) {
              console.log('📝 Gemini returned text instead of image, sending text response');
              await sendTextMessage(chatId, imageResult.textResponse);
              
              // Add Gemini's text response to conversation history
              conversationManager.addMessage(chatId, 'assistant', imageResult.textResponse);
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
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת וידאו: ${command.prompt}`);
          
          // Generate video with Veo 3 (WhatsApp format)
          const videoResult = await generateVideoForWhatsApp(command.prompt);
          
          if (videoResult.success && videoResult.videoUrl) {
            // Send the generated video without caption
            const fileName = `veo3_video_${Date.now()}.mp4`;
            
            await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
            
            // Add AI response to conversation history
            conversationManager.addMessage(chatId, 'assistant', `וידאו נוצר: ${videoResult.description || 'וידאו חדש'}`);
            
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

      case 'clear_conversation':
        const cleared = conversationManager.clearSession(chatId);
        if (cleared) {
          await sendTextMessage(chatId, '🗑️ היסטוריית השיחה נמחקה בהצלחה');
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה למחיקה');
        }
        break;

      case 'show_history':
        const history = conversationManager.getHistory(chatId);
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

      case 'help':
        const helpMessage = '🤖 Green API Bot Commands:\n\n💬 AI Chat:\n🔮 * [שאלה] - Gemini Chat\n🤖 # [שאלה] - OpenAI Chat\n\n🎨 יצירת תמונות:\n🖼️ ** [תיאור] - יצירת תמונה עם Gemini\n🖼️ ## [תיאור] - יצירת תמונה עם OpenAI\n\n🎬 יצירת וידאו:\n🎥 #### [תיאור] - יצירת וידאו עם Veo 3 (9:16, איכות מקסימלית)\n🎬 שלח תמונה עם כותרת: ### [תיאור] - וידאו מתמונה עם Veo 3\n🎬 שלח תמונה עם כותרת: ## [תיאור] - וידאו מתמונה עם Kling 2.1\n🎬 שלח וידאו עם כותרת: ## [תיאור] - עיבוד וידאו עם RunwayML Gen4\n\n🎤 עיבוד קולי:\n🗣️ שלח הקלטה קולית - תמלול + תגובת AI + שיבוט קול\n📝 Flow: קול → תמלול → Gemini → קול חדש בקולך\n\n✨ עריכת תמונות:\n🎨 שלח תמונה עם כותרת: * [הוראות עריכה] - Gemini\n🖼️ שלח תמונה עם כותרת: # [הוראות עריכה] - OpenAI\n\n⚙️ ניהול שיחה:\n🗑️ /clear - מחיקת היסטוריה\n📝 /history - הצגת היסטוריה\n❓ /help - הצגת עזרה זו\n\n💡 דוגמאות:\n* מה ההבדל בין AI לבין ML?\n# כתוב לי שיר על חתול\n** חתול כתום שיושב על עץ\n#### שפן אומר Hi\n🎨 תמונה + כותרת: * הוסף כובע אדום\n🖼️ תמונה + כותרת: # הפוך רקע לכחול\n🎬 תמונה + כותרת: ### הנפש את התמונה עם Veo 3\n🎬 תמונה + כותרת: ## הנפש את התמונה עם Kling\n🎬 וידאו + כותרת: ## שפר את הווידאו ותוסיף אפקטים\n🎤 שלח הקלטה קולית לעיבוד מלא';

        await sendTextMessage(chatId, helpMessage);
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

  // Veo 3 Video Generation command: #### + space + text
  if (text.startsWith('#### ')) {
    const prompt = text.substring(5).trim(); // Remove "#### "
    return {
      type: 'veo3_video',
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

  // Clear conversation
  if (text.toLowerCase() === '/clear') {
    return { type: 'clear_conversation' };
  }

  // Show history
  if (text.toLowerCase() === '/history') {
    return { type: 'show_history' };
  }

  // Help
  if (text.toLowerCase() === '/help') {
    return { type: 'help' };
  }

  return null;
}

module.exports = router;
