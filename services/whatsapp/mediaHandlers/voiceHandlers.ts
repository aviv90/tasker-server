/**
 * Voice Media Handlers
 * 
 * Handles voice-to-voice processing (STT + Voice Clone + TTS)
 */

import logger from '../../../utils/logger';
// import { VOICE_WHITELIST } from '../../../config/whitelist'; // Removed in favor of DB
import { getServices } from '../../agent/utils/serviceLoader';
import { routeToAgent } from '../../agentRouter';
import { NormalizedInput } from '../types';
// import { AgentResult } from '../../agent/types'; // Unused
import { sendAgentResults } from '../../../routes/whatsapp/incoming/resultHandling';
import { TIME } from '../../../utils/constants';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { sendErrorToUser } from '../../../utils/errorSender';

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

// Constants
const TRANSCRIPTION_DEFAULTS = { language: 'he' };

/**
 * Handle voice message with full voice-to-voice processing
 * Flow: Speech-to-Text → Voice Clone → Gemini Response → Text-to-Speech
 */
export async function handleVoiceMessage({ chatId, senderId, senderName, audioUrl, originalMessageId }: VoiceMessageParams): Promise<void> {
  const {
    greenApiService,
    voiceService,
    speechService,
    audioConverterService,
    conversationManager
  } = getServices();

  logger.info(`🎤 Processing voice-to-voice request from ${senderName} (${senderId})`);

  // --- PERMISSION CHECK (Using DB Allow List) ---
  const isAuthorized = await conversationManager.isAuthorizedForVoiceTranscription({
    chatId,
    senderName,
    senderContactName: senderName // Assuming senderName is available
  });

  if (!isAuthorized) {
    logger.info(`🎤 Voice processing disabled for ${senderName}. Not in Allow List.`);
    return;
  }
  // ------------------------

  const quotedMessageId = originalMessageId || null;

  // Define language variable outside try block for error handling
  let originalLanguage: string = 'he';

  try {
    // Send ACK message first
    await greenApiService.sendTextMessage(chatId, 'מתמלל הקלטה... 🎤📝', quotedMessageId, TIME.TYPING_INDICATOR);

    // Step 1: Download audio file
    const audioBuffer = await greenApiService.downloadFile(audioUrl) as Buffer;

    // Step 2: Speech-to-Text transcription
    logger.debug(`🔄 Step 1: Transcribing speech...`);

    const transcriptionResult = await speechService.speechToText(audioBuffer, TRANSCRIPTION_DEFAULTS) as { error?: string; text?: string; detectedLanguage?: string };

    if (transcriptionResult.error) {
      logger.error('❌ Transcription failed:', { error: transcriptionResult.error });
      await sendErrorToUser(chatId, transcriptionResult.error, { context: 'TRANSCRIPTION', quotedMessageId, language: 'he' });
      return;
    }

    const transcribedText = transcriptionResult.text || '';
    logger.debug(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);
    logger.debug(`📝 Transcription complete: "${transcribedText}"`);

    // Use our own language detection on the transcribed text for consistency
    originalLanguage = voiceService.detectLanguage(transcribedText);
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
      senderData: {
        chatId,
        senderId: senderId || '',
        senderName: senderName || '',
        senderContactName: senderName || '',
        chatName: ''
      },
      originalMessageId: originalMessageId || undefined
    };

    // Voice messages now use smart history detection via router heuristics
    const agentResult = await routeToAgent(normalized, chatId);

    const NON_COMMAND_TOOLS_FOR_VOICE = ['text_to_speech', 'transcribe_audio'];

    const toolsUsed = agentResult.toolsUsed || [];
    const isRealCommand = toolsUsed.length > 0 &&
      !toolsUsed.every(tool => NON_COMMAND_TOOLS_FOR_VOICE.includes(tool));

    // Also check for actual media outputs (not from text_to_speech)
    const hasRealMediaOutput = (agentResult.imageUrl || agentResult.videoUrl) ||
      (agentResult.audioUrl && isRealCommand);

    // If agent successfully executed a REAL tool/command, use the centralized result handler
    if (agentResult.success && (isRealCommand || hasRealMediaOutput)) {
      logger.info(`🎯 Agent identified and executed command/tool from voice message: [${toolsUsed.join(', ')}]`);

      await sendAgentResults(chatId, agentResult, normalized);

      logger.info(`✅ Command from voice message processed successfully`);
      return;
    }

    // If agent only used non-command tools or no tools at all, treat as regular voice-to-voice conversation
    logger.debug(`💬 Not a command (tools: [${toolsUsed.join(', ')}]) - proceeding with voice-to-voice conversation`);

    // Step 3: Generate Gemini response in the same language as the original
    logger.debug(`🔄 Step 3: Generating Gemini response in ${originalLanguage}...`);


    // We use the agent's text response if it exists (which it should for non-command interactions)
    let geminiResponse = agentResult.text || '';

    if (!geminiResponse) {
      geminiResponse = "Received your message.";
    }

    const geminiResultTyped = { text: geminiResponse };

    const responseLanguage = originalLanguage; // Force same language as original
    logger.debug(`🌐 Language consistency enforced:`);
    logger.debug(`   - Original (from user): ${originalLanguage}`);
    logger.debug(`   - TTS (forced same): ${responseLanguage}`);

    logger.debug(`✅ Step 3 complete: Response generated: "${geminiResponse.substring(0, 50)}..."`);

    // Step 4: Text-to-Speech with cloned voice or random voice
    let voiceId: string | null = null;
    let shouldCloneVoice = true; // Simplified

    if (shouldCloneVoice) {
      logger.debug(`🔄 Step 2: Creating voice clone...`);

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
    }

    // If voice wasn't cloned, get a random voice for the target language
    if (!shouldCloneVoice || !voiceId) {
      logger.debug(`🔄 Step 4: Getting random voice for ${responseLanguage} (no cloning)...`);
      const randomVoiceResult = await voiceService.getVoiceForLanguage(responseLanguage) as { error?: string; voiceId?: string };
      if (randomVoiceResult.error) {
        logger.error(`❌ Could not get random voice:`, { error: randomVoiceResult.error });
        await sendErrorToUser(chatId, "No voice available", { context: 'VOICE_RESPONSE', quotedMessageId, language: originalLanguage });
        return;
      }
      voiceId = randomVoiceResult.voiceId || null;
      logger.debug(`✅ Using random voice: ${voiceId} for language ${responseLanguage}`);
    } else {
      logger.debug(`🔄 Step 4: Converting text to speech with cloned voice...`);
    }

    const ttsOptions = {
      modelId: 'eleven_v3',
      outputFormat: 'mp3_44100_128',
      languageCode: responseLanguage
    };

    const ttsResult = await voiceService.textToSpeech(voiceId || '', geminiResultTyped.text, ttsOptions) as { error?: string; audioUrl?: string };

    if (ttsResult.error) {
      logger.error('❌ Text-to-speech failed:', { error: ttsResult.error });
      const errorMessage = originalLanguage === 'he'
        ? '❌ סליחה, לא הצלחתי ליצור תגובה קולית. נסה שוב.'
        : '❌ Sorry, I couldn\'t generate voice response. Please try again.';
      await greenApiService.sendTextMessage(chatId, errorMessage, quotedMessageId, TIME.TYPING_INDICATOR);

      // Cleanup
      if (shouldCloneVoice && voiceId) {
        try { await voiceService.deleteVoice(voiceId); } catch (e) { }
      }
      return;
    }

    logger.debug(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

    // Step 5: Convert and send voice response back to user as voice note
    logger.debug(`🔄 Converting voice-to-voice to Opus format for voice note...`);
    // Assuming 'mp3' as format since outputFormat is mp3_44100_128
    const conversionResult = await audioConverterService.convertUrlToOpus(ttsResult.audioUrl || '', 'mp3') as { success: boolean; error?: string; fileName?: string };

    if (!conversionResult.success) {
      logger.error('❌ Audio conversion failed:', { error: conversionResult.error });
      // Fallback: send as regular MP3
      const fullAudioUrl = normalizeStaticFileUrl(ttsResult.audioUrl || '');
      await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `voice_${Date.now()}.mp3`, '', quotedMessageId, TIME.TYPING_INDICATOR);
    } else {
      // Send as voice note
      const fullAudioUrl = normalizeStaticFileUrl(conversionResult.fileName || '');
      await greenApiService.sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName || '', '', quotedMessageId, TIME.TYPING_INDICATOR);
      logger.debug(`✅ Voice-to-voice sent as voice note: ${conversionResult.fileName}`);
    }

    logger.info(`✅ Voice-to-voice processing complete for ${senderName}`);

    // Cleanup
    if (shouldCloneVoice && voiceId) {
      try {
        await voiceService.deleteVoice(voiceId);
        logger.debug(`🧹 Cleanup: Voice ${voiceId} deleted`);
      } catch (cleanupError: unknown) {
        logger.warn('⚠️ Voice cleanup failed');
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error in voice-to-voice processing:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    await sendErrorToUser(chatId, error, { context: 'PROCESSING_VOICE', quotedMessageId, language: originalLanguage });
  }
}
