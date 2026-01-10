import { ToolResult } from '../../types';
import logger from '../../../../utils/logger';
import { voiceRemixingService } from '../../../../services/voice/voiceRemixing';
import { createInstantVoiceClone } from '../../../../services/voice/voiceCloning';
import { deleteVoice } from '../../../../services/voice/voiceManagement';
import { downloadFile } from '../../../../services/greenApi/fileHandling';
import { SpeechClient } from '../../../../services/speech/client';
import { AGENT_INSTRUCTIONS } from '../../../../config/messages';
import fs from 'fs';
import path from 'path';


export async function handleRemixVoice(
    styleDescription: string,
    context: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<ToolResult> {
    const { quotedMessage } = context;

    if (!quotedMessage) {
        logger.warn('⚠️ handleRemixVoice called without quotedMessage');
        return {
            success: false,
            error: 'You must quote a voice note to remix it.'
        };
    }

    logger.info('🐛 Debug handleRemixVoice context:', {
        type: quotedMessage.type,
        mimetype: quotedMessage.mimetype,
        hasAudio: quotedMessage.hasAudio,
        url: quotedMessage.url,
        audioUrl: quotedMessage.audioUrl
    });

    // Check if quoted message has audio - Relaxed check for PTT/Voice
    const isAudio =
        quotedMessage.type === 'audio' ||
        quotedMessage.type === 'voice' ||
        quotedMessage.type === 'ptt' || // Common for voice notes
        quotedMessage.type === 'audioMessage' || // Another common type
        quotedMessage.hasAudio === true ||
        (quotedMessage.mimetype && quotedMessage.mimetype.startsWith('audio/'));

    if (!isAudio) {
        logger.error(`❌ Remix validation failed. Type: ${quotedMessage.type}, Mime: ${quotedMessage.mimetype}`);
        return {
            success: false,
            error: 'CRITICAL ERROR: The quoted message is NOT audio. You must quote a voice note to use this tool. Stop and tell the user they quoted a text message instead of a voice note.'
        };
    }

    // Get Audio URL
    const audioUrl = quotedMessage.audioUrl || quotedMessage.url;
    if (!audioUrl) {
        return {
            success: false,
            error: 'Could not find audio URL in quoted message.'
        };
    }

    const audioPath: string | null = null;
    let tempRemixPath: string | null = null;
    let voiceId: string | null = null;
    let voiceContext: any = null;

    try {
        // 1. Download Audio
        const tempName = `remix_source_${Date.now()}.mp3`;
        logger.info('📥 Downloading audio for remixing...', { audioUrl, tempName });

        // downloadFile returns buffer. It saves to file if name provided, but we also want the path logic clearly.
        // We'll trust downloadFile to handle it or use the buffer.
        const audioBuffer = await downloadFile(audioUrl, tempName);

        // 2. Clone Voice
        voiceContext = {
            initializeClient: () => {
                // Return singleton instance directly
                return SpeechClient.getInstance();
            }
        };

        logger.info('🧬 Cloning voice from audio...');
        const cloneResult = await createInstantVoiceClone.call(voiceContext, audioBuffer, {
            name: `Remix_Temp_${Date.now()}`,
            description: 'Temporary clone for remixing'
        });

        if (!cloneResult.success || !cloneResult.voiceId) {
            throw new Error(cloneResult.error || 'Failed to clone voice from audio');
        }
        voiceId = cloneResult.voiceId;

        // 3. Transcribe Content
        logger.info('📝 Transcribing audio...');

        // Use speechToText directly (ElevenLabs Scribe)
        const { speechToText } = await import('../../../../services/speech/transcription');

        const transcriptionResult = await speechToText(audioBuffer);

        if (!transcriptionResult || !transcriptionResult.text) {
            throw new Error(transcriptionResult.error || 'Could not transcribe audio content.');
        }

        const transcriptionText = transcriptionResult.text;
        logger.info(`📝 Transcription: "${transcriptionText}"`);

        // 4. Generate Remix
        logger.info(`🎨 Generating remix with style: "${styleDescription}"`);
        if (voiceId) {
            tempRemixPath = await voiceRemixingService.remixVoice(voiceId, transcriptionText, styleDescription);
        } else {
            throw new Error('Voice ID is null after cloning');
        }

        return {
            success: true,
            data: `🎤 Here is the remixed audio ("${styleDescription}")`,
            audioUrl: path.basename(tempRemixPath)
        };

    } catch (error) {
        logger.error('❌ Error in handleRemixVoice:', error);
        return {
            success: false,
            error: `Failed to remix voice: ${error instanceof Error ? error.message : String(error)}. ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`
        };
    } finally {
        // Cleanup local file
        if (audioPath && fs.existsSync(audioPath)) {
            try { await fs.promises.unlink(audioPath); } catch (_e) { /* Ignore cleanup error */ }
        }

        // Cleanup cloned voice from ElevenLabs
        if (voiceId && voiceContext) {
            try {
                logger.info(`🧹 Cleaning up temporary voice: ${voiceId}`);
                await deleteVoice.call(voiceContext, voiceId);
            } catch (e) {
                logger.error(`❌ Failed to cleanup voice ${voiceId}:`, e);
            }
        }
    }
}
