import { SpeechClient } from '../speech/client';
import logger from '../../utils/logger';
import path from 'path';

import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';

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
            const audioBase64 = preview.audioBase64;

            if (!audioBase64) {
                throw new Error('No audio data in remix preview');
            }

            // Decode and save
            const buffer = Buffer.from(audioBase64, 'base64');
            const fileName = `remix_${uuidv4()}.mp3`;

            // Use config.paths.tmp (public/tmp) so it can be served via static URL
            const tempDir = config.paths.tmp;

            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const filePath = path.join(tempDir, fileName);

            await fs.promises.writeFile(filePath, buffer);

            logger.info('✅ Voice remix generated successfully', {
                filePath,
                generatedVoiceId: preview.generatedVoiceId,
                publicUrl: `/static/${fileName}`
            });

            return filePath;

        } catch (error) {
            logger.error('❌ Error remixing voice:', error);
            throw error;
        }
    }
}

export const voiceRemixingService = new VoiceRemixingService();
