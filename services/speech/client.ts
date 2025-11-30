import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

/**
 * Initialize ElevenLabs client with lazy loading for environment variables
 */
export class SpeechClient {
    private static instance: ElevenLabsClient | null = null;

    public static getInstance(): ElevenLabsClient {
        if (!this.instance) {
            if (!process.env.ELEVENLABS_API_KEY) {
                throw new Error('ELEVENLABS_API_KEY environment variable is required');
            }

            this.instance = new ElevenLabsClient({
                apiKey: process.env.ELEVENLABS_API_KEY
            });
        }

        return this.instance;
    }

    public static resetInstance(): void {
        this.instance = null;
    }
}
