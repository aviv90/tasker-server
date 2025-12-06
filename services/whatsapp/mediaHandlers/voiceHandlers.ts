/**
 * Voice Media Handlers
 * 
 * Handles voice-to-voice processing (STT + Voice Clone + TTS)
 */

import { sendTextMessage, sendFileByUrl, downloadFile } from '../../greenApiService';
import { formatProviderError } from '../../../utils/errorHandler';
import { sendErrorToUser } from '../../../utils/errorSender';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { MIN_DURATION_FOR_CLONING, TRANSCRIPTION_DEFAULTS } from '../constants';
import { getAudioDuration } from '../../agent/utils/audioUtils';
import { generateTextResponse } from '../../geminiService';
import speechService from '../../speechService';
import { voiceService } from '../../voiceService';
import audioConverterService from '../../audioConverterService';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';
import { routeToAgent } from '../../agentRouter';
import { sendAgentResults, NormalizedInput, AgentResult as HandlerAgentResult } from '../../../routes/whatsapp/incoming/resultHandling';

/**
 * Voice message handler parameters
 */
interface VoiceMessageParams {
  chatId: string;
  senderId?: string;
  senderName?: string;
  audioUrl: string;
  originalMessageId?: string;
}

/**
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
export async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl, originalMessageId }: VoiceMessageParams): Promise<void> {
  logger.info(`🎤 Processing voice-to-voice request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send ACK message first (same as when transcribing quoted audio)
    await sendTextMessage(chatId, 'מתמלל הקלטה... 🎤📝', quotedMessageId, TIME.TYPING_INDICATOR);

    // Step 1: Download audio file
    const audioBuffer = await downloadFile(audioUrl) as Buffer;

    // Step 2: Speech-to-Text transcription
    logger.debug(`🔄 Step 1: Transcribing speech...`);
    const transcriptionOptions = TRANSCRIPTION_DEFAULTS;

    const transcriptionResult = await speechService.speechToText(audioBuffer, transcriptionOptions) as { error?: string; text?: string; detectedLanguage?: string };

    if (transcriptionResult.error) {
      logger.error('❌ Transcription failed:', { error: transcriptionResult.error });
      // We don't know the language yet, so use Hebrew as default for error messages
      await sendErrorToUser(chatId, transcriptionResult.error, { context: 'TRANSCRIPTION', quotedMessageId });
      return;
    }

    const transcribedText = transcriptionResult.text || '';
    logger.debug(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);
    logger.debug(`📝 Transcription complete: "${transcribedText}"`);

    // Use our own language detection on the transcribed text for consistency
    const originalLanguage = voiceService.detectLanguage(transcribedText);
    logger.debug(`🌐 STT detected: ${transcriptionResult.detectedLanguage}, Our detection: ${originalLanguage}`);

    // Try to route to agent to see if this is a command (let the Agent/Planner decide)
    logger.debug(`🔄 Routing transcribed text to agent for evaluation...`);

    // Build normalized input - add # prefix to route through agent (same as text messages)
    const normalized: NormalizedInput = {
      userText: `# ${transcribedText}`, // Add # prefix to route through agent
      hasAudio: false, // Audio already transcribed - don't send audioUrl to agent
      audioAlreadyTranscribed: true, // CRITICAL: Prevents duplicate ACK for transcribe_audio
      chatType: chatId && chatId.endsWith('@g.us') ? 'group' : 'private',
      language: originalLanguage,
      senderData: { chatId, senderId, senderName },
      originalMessageId: originalMessageId || undefined
    };

    // Voice messages now use history thanks to the new semantics-aware HistoryStrategy.
    // This allows conversational voice interactions (e.g. "make it blue" after an image generation).
    const agentResult = await routeToAgent(normalized, chatId, { useConversationHistory: true });

    // Check if Agent executed a REAL command (not just default/redundant tools)
    // These tools don't count as "commands" in voice message context:
    // - text_to_speech: User didn't request TTS, they just asked a question
    // - transcribe_audio: The audio is ALREADY transcribed! Redundant to transcribe again
    const NON_COMMAND_TOOLS_FOR_VOICE = ['text_to_speech', 'transcribe_audio'];

    const toolsUsed = agentResult.toolsUsed || [];
    const isRealCommand = toolsUsed.length > 0 &&
      !toolsUsed.every(tool => NON_COMMAND_TOOLS_FOR_VOICE.includes(tool));

    // Also check for actual media outputs (not from text_to_speech)
    const hasRealMediaOutput = (agentResult.imageUrl || agentResult.videoUrl) ||
      (agentResult.audioUrl && isRealCommand);

    // If agent successfully executed a REAL tool/command, use the centralized result handler
    // This ensures identical behavior to text commands (multi-step, captions, etc.)
    if (agentResult.success && (isRealCommand || hasRealMediaOutput)) {
      logger.info(`🎯 Agent identified and executed command/tool from voice message: [${toolsUsed.join(', ')}]`);

      // Use the same result handling logic as text commands
      // This ensures multi-step, captions, and all other features work identically
      await sendAgentResults(chatId, agentResult as HandlerAgentResult, normalized);

      logger.info(`✅ Command from voice message processed successfully`);
      return;
    }

    // If agent only used non-command tools or no tools at all, treat as regular voice-to-voice conversation
    // This means the user asked a question/said something that needs a conversational response
    logger.debug(`💬 Not a command (tools: [${toolsUsed.join(', ')}]) - proceeding with voice-to-voice conversation`);

    // Don't send transcription to user - they should only receive the final voice response

    // Step 2: Check audio duration and decide whether to clone voice (parallel with Gemini)
    const [audioDuration, geminiResult] = await Promise.all([
      getAudioDuration(audioBuffer),
      (async () => {
        // Step 3: Generate Gemini response in the same language as the original
        logger.debug(`🔄 Step 3: Generating Gemini response in ${originalLanguage}...`);

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

    let voiceId: string | null = null;
    let shouldCloneVoice = audioDuration >= MIN_DURATION_FOR_CLONING;

    if (shouldCloneVoice) {
      logger.debug(`🔄 Step 2: Creating voice clone (duration: ${audioDuration.toFixed(2)}s >= ${MIN_DURATION_FOR_CLONING}s)...`);

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

      const voiceCloneResult = await voiceService.createInstantVoiceClone([audioBuffer], voiceCloneOptions) as { error?: string; voiceId?: string };

      if (voiceCloneResult.error) {
        logger.warn(`⚠️ Voice cloning failed: ${voiceCloneResult.error}. Falling back to random voice.`);
        shouldCloneVoice = false;
      } else {
        voiceId = voiceCloneResult.voiceId || null;
        logger.info(`✅ Step 2 complete: Voice cloned (ID: ${voiceId}), Language: ${originalLanguage}`);
      }
    } else {
      logger.debug(`⏭️ Step 2: Skipping voice clone (duration: ${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s) - will use random voice`);
    }

    // NOTE: User messages are no longer saved to DB to avoid duplication.
    // All messages are retrieved from Green API getChatHistory when needed.
    logger.debug(`💾 [VoiceHandler] Voice message processed (not saving to DB - using Green API history)`);

    const geminiResultTyped = geminiResult as { error?: string; text?: string };
    if (geminiResultTyped.error) {
      logger.error('❌ Gemini generation failed:', { error: geminiResultTyped.error });
      const errorMessage = formatProviderError('gemini', geminiResultTyped.error);
      await sendTextMessage(chatId, errorMessage, quotedMessageId, TIME.TYPING_INDICATOR);

      // Clean up voice clone before returning (only if we cloned)
      if (shouldCloneVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          logger.debug(`🧹 Voice clone ${voiceId} deleted (cleanup after Gemini error)`);
        } catch (cleanupError: unknown) {
          const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          logger.warn('⚠️ Could not delete voice clone:', { error: errorMessage });
        }
      }
      return;
    }

    const geminiResponse = geminiResultTyped.text || '';
    logger.debug(`✅ Step 3 complete: Gemini response generated`);

    // NOTE: Bot messages are no longer saved to DB to avoid duplication.
    // Bot messages are tracked in DB (message_types table) when sent through Green API.
    logger.debug(`💾 [VoiceHandler] Bot response sent (tracked in DB)`);

    // Step 4: Text-to-Speech with cloned voice or random voice
    const responseLanguage = originalLanguage; // Force same language as original
    logger.debug(`🌐 Language consistency enforced:`);
    logger.debug(`   - Original (from user): ${originalLanguage}`);
    logger.debug(`   - TTS (forced same): ${responseLanguage}`);

    // If voice wasn't cloned, get a random voice for the target language
    if (!shouldCloneVoice || !voiceId) {
      logger.debug(`🔄 Step 4: Getting random voice for ${responseLanguage} (no cloning)...`);
      const randomVoiceResult = await voiceService.getVoiceForLanguage(responseLanguage) as { error?: string; voiceId?: string };
      if (randomVoiceResult.error) {
        logger.error(`❌ Could not get random voice:`, { error: randomVoiceResult.error });
        await sendErrorToUser(chatId, null, { context: 'VOICE_RESPONSE', quotedMessageId });
        return;
      }
      voiceId = randomVoiceResult.voiceId || null;
      logger.debug(`✅ Using random voice: ${voiceId} for language ${responseLanguage}`);
    } else {
      logger.debug(`🔄 Step 4: Converting text to speech with cloned voice...`);
    }

    const ttsOptions = {
      modelId: 'eleven_v3', // Use the most advanced model
      outputFormat: 'mp3_44100_128', // ElevenLabs doesn't support ogg_vorbis
      languageCode: responseLanguage
    };

    const ttsResult = await voiceService.textToSpeech(voiceId || '', geminiResponse, ttsOptions) as { error?: string; audioUrl?: string };

    if (ttsResult.error) {
      logger.error('❌ Text-to-speech failed:', { error: ttsResult.error });
      // If TTS fails, send error message (don't send the Gemini response as text)
      const errorMessage = originalLanguage === 'he'
        ? '❌ סליחה, לא הצלחתי ליצור תגובה קולית. נסה שוב.'
        : '❌ Sorry, I couldn\'t generate voice response. Please try again.';
      await sendTextMessage(chatId, errorMessage, quotedMessageId, TIME.TYPING_INDICATOR);

      // Clean up voice clone before returning (only if we cloned)
      if (shouldCloneVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          logger.debug(`🧹 Voice clone ${voiceId} deleted (cleanup after TTS error)`);
        } catch (cleanupError: unknown) {
          const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          logger.warn('⚠️ Could not delete voice clone:', { error: errorMessage });
        }
      }
      return;
    }

    logger.debug(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

    // Step 5: Convert and send voice response back to user as voice note
    logger.debug(`🔄 Converting voice-to-voice to Opus format for voice note...`);
    const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl || '', 'mp3') as { success: boolean; error?: string; fileName?: string };

    if (!conversionResult.success) {
      logger.error('❌ Audio conversion failed:', { error: conversionResult.error });
      // Fallback: send as regular MP3 file
      const fullAudioUrl = normalizeStaticFileUrl(ttsResult.audioUrl || '');
      await sendFileByUrl(chatId, fullAudioUrl, `voice_${Date.now()}.mp3`, '', quotedMessageId, TIME.TYPING_INDICATOR);
    } else {
      // Send as voice note with Opus format
      const fullAudioUrl = normalizeStaticFileUrl(conversionResult.fileName || '');
      await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName || '', '', quotedMessageId, TIME.TYPING_INDICATOR);
      logger.debug(`✅ Voice-to-voice sent as voice note: ${conversionResult.fileName}`);
    }

    logger.info(`✅ Voice-to-voice processing complete for ${senderName}`);

    // Cleanup: Delete the cloned voice (only if we cloned - ElevenLabs has limits)
    if (shouldCloneVoice && voiceId) {
      try {
        await voiceService.deleteVoice(voiceId);
        logger.debug(`🧹 Cleanup: Voice ${voiceId} deleted`);
      } catch (cleanupError: unknown) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        logger.warn('⚠️ Voice cleanup failed:', { error: errorMessage });
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error in voice-to-voice processing:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    // Get quotedMessageId for error response (preserve original message ID)
    const quotedMessageIdForError = originalMessageId || null;
    await sendErrorToUser(chatId, error, { context: 'PROCESSING_VOICE', quotedMessageId: quotedMessageIdForError });
  }
}

