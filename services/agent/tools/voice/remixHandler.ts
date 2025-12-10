import { ToolResult } from '../../types';
import logger from '../../../../utils/logger';
import { voiceRemixingService } from '../../../../services/voice/voiceRemixing';
import { createInstantVoiceClone } from '../../../../services/voice/voiceCloning';
import { downloadFile } from '../../../../services/greenApi/fileHandling';
import fs from 'fs';


export async function handleRemixVoice(
    styleDescription: string,
    context: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<ToolResult> {
    const { quotedMessage } = context;

    if (!quotedMessage) {
        return {
            success: false,
            error: 'You must quote a voice note to remix it.'
        };
    }

    // Check if quoted message has audio
    const isAudio = quotedMessage.type === 'audio' ||
        quotedMessage.type === 'voice' ||
        quotedMessage.hasAudio;

    if (!isAudio) {
        return {
            success: false,
            error: 'The quoted message must be a voice note or audio file.'
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

    let audioPath: string | null = null;
    let tempRemixPath: string | null = null;
    let voiceId: string | null = null;

    try {
        // 1. Download Audio
        const tempName = `remix_source_${Date.now()}.mp3`;
        logger.info('📥 Downloading audio for remixing...', { audioUrl, tempName });

        // downloadFile returns buffer. It saves to file if name provided, but we also want the path logic clearly.
        // We'll trust downloadFile to handle it or use the buffer.
        const audioBuffer = await downloadFile(audioUrl, tempName);

        // 2. Clone Voice
        const voiceContext = {
            initializeClient: () => {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const clientModule = require('../../../../services/speech/client');
                return clientModule.SpeechClient.getInstance();
            }
        };

        logger.info('🧬 Cloning voice from audio...');
        // @ts-ignore - Calling loose function with mock context
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
            audioUrl: tempRemixPath
        };

    } catch (error) {
        logger.error('❌ Error in handleRemixVoice:', error);
        return {
            success: false,
            error: `Failed to remix voice: ${error instanceof Error ? error.message : String(error)}`
        };
    } finally {
        if (audioPath && fs.existsSync(audioPath)) {
            try { await fs.promises.unlink(audioPath); } catch (e) { }
        }
    }
}
