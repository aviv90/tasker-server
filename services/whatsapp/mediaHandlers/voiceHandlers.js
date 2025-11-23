/**
 * Voice Media Handlers
 * 
 * Handles voice-to-voice processing (STT + Voice Clone + TTS)
 */

const { sendTextMessage, sendFileByUrl, downloadFile } = require('../../greenApiService');
const conversationManager = require('../../conversationManager');
const { formatProviderError } = require('../../../utils/errorHandler');
const { sendErrorToUser, ERROR_MESSAGES } = require('../../../utils/errorSender');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { MIN_DURATION_FOR_CLONING, TRANSCRIPTION_DEFAULTS } = require('../constants');
const { getAudioDuration } = require('../../agent/utils/audioUtils');
const { generateTextResponse } = require('../../geminiService');
const speechService = require('../../speechService');
const { voiceService } = require('../../voiceService');
const audioConverterService = require('../../audioConverterService');

/**
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl, originalMessageId }) {
  console.log(`🎤 Processing voice-to-voice request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send ACK message first (same as when transcribing quoted audio)
    await sendTextMessage(chatId, 'מתמלל הקלטה... 🎤📝', quotedMessageId, 1000);

    // Step 1: Download audio file
    const audioBuffer = await downloadFile(audioUrl);

    // Step 2: Speech-to-Text transcription
    console.log(`🔄 Step 1: Transcribing speech...`);
    const transcriptionOptions = TRANSCRIPTION_DEFAULTS;

    const transcriptionResult = await speechService.speechToText(audioBuffer, transcriptionOptions);

    if (transcriptionResult.error) {
      console.error('❌ Transcription failed:', transcriptionResult.error);
      // We don't know the language yet, so use Hebrew as default for error messages
      await sendErrorToUser(chatId, transcriptionResult.error, { context: 'TRANSCRIPTION', quotedMessageId });
      return;
    }

    const transcribedText = transcriptionResult.text;
    console.log(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);
    console.log(`📝 Transcription complete: "${transcribedText}"`);

    // Use our own language detection on the transcribed text for consistency
    const originalLanguage = voiceService.detectLanguage(transcribedText);
    console.log(`🌐 STT detected: ${transcriptionResult.detectedLanguage}, Our detection: ${originalLanguage}`);

    // Try to route to agent to see if this is a command (let the Agent/Planner decide)
    console.log(`🔄 Routing transcribed text to agent for evaluation...`);
    
    const { routeToAgent } = require('../../agentRouter');
    const normalized = {
      userText: `# ${transcribedText}`, // Add # prefix to route through agent
      hasAudio: false, // Audio already transcribed - don't send audioUrl to agent
      chatType: chatId && chatId.endsWith('@g.us') ? 'group' : 'private',
      language: originalLanguage,
      senderData: { chatId, senderId, senderName }
    };
    
    const agentResult = await routeToAgent(normalized, chatId);
    
    // If agent successfully executed a tool/command, send the result and exit
    if (agentResult.success && (agentResult.toolsUsed?.length > 0 || agentResult.imageUrl || agentResult.videoUrl || agentResult.audioUrl)) {
      console.log(`🎯 Agent identified and executed command/tool from voice message`);
      
      // NOTE: User messages are no longer saved to DB to avoid duplication.
      // All messages are retrieved from Green API getChatHistory when needed.
      // Voice transcription is handled automatically and the result is sent to the user.
      console.log(`💾 [VoiceHandler] Voice message processed (not saving to DB - using Green API history)`);
      
      // Send agent result (text, image, video, audio, etc.) in parallel for better performance
      const sendPromises = [];
      if (agentResult.text && agentResult.text.trim()) {
        sendPromises.push(sendTextMessage(chatId, agentResult.text, quotedMessageId, 1000));
      }
      if (agentResult.imageUrl) {
        sendPromises.push(sendFileByUrl(chatId, agentResult.imageUrl, `image_${Date.now()}.jpg`, '', quotedMessageId, 1000));
      }
      if (agentResult.videoUrl) {
        sendPromises.push(sendFileByUrl(chatId, agentResult.videoUrl, `video_${Date.now()}.mp4`, '', quotedMessageId, 1000));
      }
      if (agentResult.audioUrl) {
        sendPromises.push(sendFileByUrl(chatId, agentResult.audioUrl, `audio_${Date.now()}.mp3`, '', quotedMessageId, 1000));
      }
      await Promise.all(sendPromises);
      
      console.log(`✅ Command from voice message processed successfully`);
      return;
    }
    
    // If agent didn't execute any tool, treat as regular voice-to-voice conversation
    console.log(`💬 Not a command - proceeding with voice-to-voice conversation`);

    // Don't send transcription to user - they should only receive the final voice response

    // Step 2: Check audio duration and decide whether to clone voice (parallel with Gemini)
    const [audioDuration, geminiResult] = await Promise.all([
      getAudioDuration(audioBuffer),
      (async () => {
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
        return await generateTextResponse(geminiPrompt, []);
      })()
    ]);

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

    // NOTE: User messages are no longer saved to DB to avoid duplication.
    // All messages are retrieved from Green API getChatHistory when needed.
    console.log(`💾 [VoiceHandler] Voice message processed (not saving to DB - using Green API history)`);

    if (geminiResult.error) {
      console.error('❌ Gemini generation failed:', geminiResult.error);
      const errorMessage = originalLanguage === 'he'
        ? formatProviderError('gemini', geminiResult.error)
        : formatProviderError('gemini', geminiResult.error);
      await sendTextMessage(chatId, errorMessage, quotedMessageId, 1000);

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

    // NOTE: Bot messages are no longer saved to DB to avoid duplication.
    // Bot messages are tracked via messageTypeCache when sent through Green API.
    console.log(`💾 [VoiceHandler] Bot response sent (tracked via messageTypeCache, not saved to DB)`);

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
        await sendErrorToUser(chatId, null, { context: 'VOICE_RESPONSE', quotedMessageId });
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
      await sendTextMessage(chatId, errorMessage, quotedMessageId, 1000);

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
    const conversionResult = await audioConverterService.audioConverterService.convertUrlToOpus(ttsResult.audioUrl, 'mp3');

    if (!conversionResult.success) {
      console.error('❌ Audio conversion failed:', conversionResult.error);
      // Fallback: send as regular MP3 file
      const fullAudioUrl = ttsResult.audioUrl.startsWith('http')
        ? ttsResult.audioUrl
        : getStaticFileUrl(ttsResult.audioUrl.replace('/static/', ''));
      await sendFileByUrl(chatId, fullAudioUrl, `voice_${Date.now()}.mp3`, '', quotedMessageId, 1000);
    } else {
      // Send as voice note with Opus format
      const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
      await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '', quotedMessageId, 1000);
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
    // Get quotedMessageId for error response (preserve original message ID)
    const quotedMessageId = originalMessageId || null;
    await sendErrorToUser(chatId, error, { context: 'PROCESSING_VOICE', quotedMessageId });
  }
}

module.exports = {
  handleVoiceMessage
};

