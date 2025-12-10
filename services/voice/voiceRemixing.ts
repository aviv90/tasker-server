import { SpeechClient } from '../speech/client';
import logger from '../../utils/logger';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class VoiceRemixingService {
    /**
     * Generate a voice remix
     * @param voiceId - The source user-created voice ID
     * @param text - The text to speak (from transcription)
     * @param voiceDescription - The prompt for style/transfer (e.g. "excited", "whispering")
     * @returns Path to the generated audio file
     */
    async remixVoice(voiceId: string, text: string, voiceDescription: string): Promise<string> {
        try {
            logger.info('🎨 Remixing voice...', { voiceId, voiceDescription });

            const client = SpeechClient.getInstance();

            // Note: usage based on documentation: client.textToVoice.remix(...)
            // However, the SDK might expose it slightly differently depending on version.
            // Documentation says: elevenlabs.text_to_voice.remix
            // We use `any` cast if strict types are missing in our current SDK version, 
            // but we'll try standard access first.

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const response = await (client as any).textToVoice.remix(voiceId, {
                text: text,
                voiceDescription: voiceDescription
            });

            // Response contains structure with previews. We take the first one or iterate.
            // Docs: voices.previews (list)

            if (!response || !response.previews || response.previews.length === 0) {
                throw new Error('No remix previews returned from ElevenLabs');
            }

            // Take the first preview for now
            const preview = response.previews[0];

            logger.info('🐛 Debug Remix Response keys:', Object.keys(preview));
            if (preview.audio_base_64) logger.info('🐛 Debug audio_base_64 length:', preview.audio_base_64.length);

            const audioBase64 = preview.audio_base_64;

            if (!audioBase64) {
                throw new Error('No audio data in remix preview');
            }

            // Decode and save
            const buffer = Buffer.from(audioBase64, 'base64');
            const fileName = `remix_${uuidv4()}.mp3`;
            const filePath = path.join(os.tmpdir(), fileName);

            await fs.promises.writeFile(filePath, buffer);

            logger.info('✅ Voice remix generated successfully', { filePath, generatedVoiceId: preview.generated_voice_id });

            return filePath;

        } catch (error) {
            logger.error('❌ Error remixing voice:', error);
            throw error;
        }
    }
}

export const voiceRemixingService = new VoiceRemixingService();
