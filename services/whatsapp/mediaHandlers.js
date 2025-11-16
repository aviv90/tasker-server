/**
 * WhatsApp Media Handlers
 * 
 * Handles media-specific operations:
 * - Image editing (Gemini, OpenAI)
 * - Image-to-video conversion (Veo 3, Sora 2, Kling)
 * - Video-to-video processing (RunwayML Gen4)
 * - Voice-to-voice conversations (STT + Voice Clone + TTS)
 * 
 * Extracted from whatsappRoutes.js for better modularity
 */

const { sendTextMessage, sendFileByUrl, downloadFile } = require('../greenApiService');
const conversationManager = require('../conversationManager');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const { MIN_DURATION_FOR_CLONING, TRANSCRIPTION_DEFAULTS } = require('./constants');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import AI services
const { 
  editImageForWhatsApp, 
  editOpenAIImage,
  generateVideoFromImageForWhatsApp,
  generateVideoWithSoraFromImageForWhatsApp,
  generateKlingVideoFromImage,
  generateRunwayVideoFromVideo,
  generateGeminiResponse
} = require('../geminiService');

const speechService = require('../speechService');
const { voiceService } = require('../voiceService');
const audioConverterService = require('../audioConverterService');

// Import sendAck from messaging module
const { sendAck } = require('./messaging');

/**
 * Handle image editing with Gemini or OpenAI
 * @param {Object} params - Handler parameters
 * @param {string} params.chatId - WhatsApp chat ID
 * @param {string} params.senderId - Sender ID
 * @param {string} params.senderName - Sender name
 * @param {string} params.imageUrl - Image URL to edit
 * @param {string} params.prompt - Edit instructions
 * @param {string} params.service - AI service ('gemini' or 'openai')
 */
async function handleImageEdit({ chatId, senderId, senderName, imageUrl, prompt, service }) {
  console.log(`🎨 Processing ${service} image edit request from ${senderName}`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini' 
      ? '🎨 מעבד באמצעות Gemini...'
      : '🖼️ מעבד באמצעות OpenAI...';
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
 * Handle image-to-video conversion with Veo 3, Sora 2, or Kling
 * @param {Object} params - Handler parameters
 * @param {string} params.chatId - WhatsApp chat ID
 * @param {string} params.senderId - Sender ID
 * @param {string} params.senderName - Sender name
 * @param {string} params.imageUrl - Image URL to convert
 * @param {string} params.prompt - Animation instructions
 * @param {string} params.service - AI service ('veo3', 'sora', or 'kling')
 * @param {string} [params.model] - Model variant (for Sora: 'sora-2-pro')
 */
async function handleImageToVideo({ chatId, senderId, senderName, imageUrl, prompt, service = 'veo3', model = null }) {
  let serviceName;
  if (service === 'veo3') {
    serviceName = 'Veo 3';
  } else if (service === 'sora') {
    serviceName = model === 'sora-2-pro' ? 'Sora 2 Pro' : 'Sora 2';
  } else {
    serviceName = 'Kling 2.1 Master';
  }
  console.log(`🎬 Processing ${serviceName} image-to-video request from ${senderName}`);
  
  try {
    // Send immediate ACK
    let ackMessage;
    if (service === 'veo3') {
      ackMessage = '🎬 יוצר וידאו עם Veo 3...';
    } else if (service === 'sora') {
      ackMessage = model === 'sora-2-pro' 
        ? '🎬 יוצר וידאו עם Sora 2 Pro...'
        : '🎬 יוצר וידאו עם Sora 2...';
    } else {
      ackMessage = '🎬 יוצר וידאו עם Kling 2.1...';
    }
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
    } else if (service === 'sora') {
      // Sora 2 image-to-video with image_reference
      const options = model ? { model } : {};
      videoResult = await generateVideoWithSoraFromImageForWhatsApp(prompt, imageBuffer, options);
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
 * Handle video-to-video processing with RunwayML Gen4
 * @param {Object} params - Handler parameters
 * @param {string} params.chatId - WhatsApp chat ID
 * @param {string} params.senderId - Sender ID
 * @param {string} params.senderName - Sender name
 * @param {string} params.videoUrl - Video URL to process
 * @param {string} params.prompt - Processing instructions
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
 * Get audio duration in seconds using ffprobe
 * @param {Buffer} audioBuffer - Audio buffer
 * @returns {Promise<number>} - Duration in seconds, or 0 if failed
 */
async function getAudioDuration(audioBuffer) {
  try {
    // Write buffer to temp file
    const tempFilePath = path.join(os.tmpdir(), `audio_check_${Date.now()}.ogg`);
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    try {
      // Use ffprobe to get duration
      const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFilePath}"`);
      const duration = parseFloat(stdout.trim());
      
      // Cleanup
      fs.unlinkSync(tempFilePath);
      
      console.log(`⏱️ Audio duration: ${duration.toFixed(2)} seconds`);
      return duration;
    } catch (err) {
      // Cleanup on error
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error(`❌ Could not get audio duration: ${err.message}`);
      return 0;
    }
  } catch (err) {
    console.error(`❌ Error in getAudioDuration: ${err.message}`);
    return 0;
  }
}

/**
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 * @param {Object} params - Handler parameters
 * @param {string} params.chatId - WhatsApp chat ID
 * @param {string} params.senderId - Sender ID
 * @param {string} params.senderName - Sender name
 * @param {string} params.audioUrl - Audio URL to process
 */
async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl }) {
  console.log(`🎤 Processing voice-to-voice request from ${senderName}`);
  
  try {
    // No ACK - user should only receive the final voice response
    
    // Step 1: Download audio file
    const audioBuffer = await downloadFile(audioUrl);
    
    // Step 2: Speech-to-Text transcription
    console.log(`🔄 Step 1: Transcribing speech...`);
    const transcriptionOptions = TRANSCRIPTION_DEFAULTS;
    
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

    // Step 2: Check audio duration and decide whether to clone voice
    const audioDuration = await getAudioDuration(audioBuffer);
    let voiceId = null;
    let shouldCloneVoice = audioDuration >= MIN_DURATION_FOR_CLONING;
    
    if (shouldCloneVoice) {
      console.log(`🔄 Step 2: Creating voice clone (duration: ${audioDuration.toFixed(2)}s >= ${MIN_DURATION_FOR_CLONING}s)...`);
      
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
        console.warn(`⚠️ Voice cloning failed: ${voiceCloneResult.error}. Falling back to random voice.`);
        shouldCloneVoice = false;
      } else {
        voiceId = voiceCloneResult.voiceId;
        console.log(`✅ Step 2 complete: Voice cloned (ID: ${voiceId}), Language: ${originalLanguage}`);
      }
    } else {
      console.log(`⏭️ Step 2: Skipping voice clone (duration: ${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s) - will use random voice`);
    }
    
    const detectedLanguage = transcriptionResult.detectedLanguage || 'he';

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
    
    // Get final audio URL (will be used for conversation history)
    const finalAudioUrl = audioUrl;
    
    // Add user message to conversation AFTER getting Gemini response to avoid duplication
    await conversationManager.addMessage(chatId, 'user', `[הקלטה קולית] ${transcribedText}`, {
      hasAudio: true,
      audioUrl: finalAudioUrl,
      transcribedText: transcribedText
    });
    
    if (geminiResult.error) {
      console.error('❌ Gemini generation failed:', geminiResult.error);
      const errorMessage = originalLanguage === 'he' 
        ? `❌ סליחה, לא הצלחתי ליצור תגובה: ${geminiResult.error}`
        : `❌ Sorry, I couldn't generate a response: ${geminiResult.error}`;
      await sendTextMessage(chatId, errorMessage);
      
      // Clean up voice clone before returning (only if we cloned)
      if (shouldCloneVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          console.log(`🧹 Voice clone ${voiceId} deleted (cleanup after Gemini error)`);
        } catch (cleanupError) {
          console.warn('⚠️ Could not delete voice clone:', cleanupError.message);
        }
      }
      return;
    }

    const geminiResponse = geminiResult.text;
    console.log(`✅ Step 3 complete: Gemini response generated`);
    
    // Add AI response to conversation history
    await conversationManager.addMessage(chatId, 'assistant', geminiResponse);

    // Step 4: Text-to-Speech with cloned voice or random voice
    const responseLanguage = originalLanguage; // Force same language as original
    console.log(`🌐 Language consistency enforced:`);
    console.log(`   - Original (from user): ${originalLanguage}`);
    console.log(`   - TTS (forced same): ${responseLanguage}`);
    
    // If voice wasn't cloned, get a random voice for the target language
    if (!shouldCloneVoice || !voiceId) {
      console.log(`🔄 Step 4: Getting random voice for ${responseLanguage} (no cloning)...`);
      const randomVoiceResult = await voiceService.getVoiceForLanguage(responseLanguage);
      if (randomVoiceResult.error) {
        console.error(`❌ Could not get random voice: ${randomVoiceResult.error}`);
        await sendTextMessage(chatId, `❌ סליחה, לא הצלחתי ליצור תגובה קולית`);
        return;
      }
      voiceId = randomVoiceResult.voiceId;
      console.log(`✅ Using random voice: ${voiceId} for language ${responseLanguage}`);
    } else {
      console.log(`🔄 Step 4: Converting text to speech with cloned voice...`);
    }
    
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
      
      // Clean up voice clone before returning (only if we cloned)
      if (shouldCloneVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          console.log(`🧹 Voice clone ${voiceId} deleted (cleanup after TTS error)`);
        } catch (cleanupError) {
          console.warn('⚠️ Could not delete voice clone:', cleanupError.message);
        }
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

    // Cleanup: Delete the cloned voice (only if we cloned - ElevenLabs has limits)
    if (shouldCloneVoice && voiceId) {
      try {
        await voiceService.deleteVoice(voiceId);
        console.log(`🧹 Cleanup: Voice ${voiceId} deleted`);
      } catch (cleanupError) {
        console.warn('⚠️ Voice cleanup failed:', cleanupError.message);
      }
    }

  } catch (error) {
    console.error('❌ Error in voice-to-voice processing:', error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד ההקלטה הקולית: ${error.message || error}`);
  }
}

module.exports = {
  handleImageEdit,
  handleImageToVideo,
  handleVideoToVideo,
  handleVoiceMessage,
  getAudioDuration // Export for testing or reuse
};

