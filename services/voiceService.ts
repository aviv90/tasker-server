/**
 * Voice Service orchestrator for ElevenLabs integration
 * Split into modular helpers (Phase 5.3)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as voiceCloning from './voice/voiceCloning';
import * as voiceManagement from './voice/voiceManagement';
import * as textToSpeechModule from './voice/textToSpeech';
import * as voiceSelection from './voice/voiceSelection';

class VoiceService {
    private client: ElevenLabsClient | null = null;

    initializeClient(): ElevenLabsClient {
        if (!this.client) {
            if (!process.env.ELEVENLABS_API_KEY) {
                throw new Error('ELEVENLABS_API_KEY environment variable is required');
            }

            this.client = new ElevenLabsClient({
                apiKey: process.env.ELEVENLABS_API_KEY
            });
        }

        return this.client;
    }

    // Voice cloning
    async createInstantVoiceClone(audioBuffers: Buffer[], options: Record<string, unknown> = {}): Promise<unknown> {
        return voiceCloning.createInstantVoiceClone.call(this as any, audioBuffers, options);
    }

    getAvailableOptions(): unknown {
        return voiceCloning.getAvailableOptions();
    }

    // Voice management
    async getVoices(): Promise<unknown> {
        return voiceManagement.getVoices.call(this as any);
    }

    async getVoice(voiceId: string): Promise<unknown> {
        return voiceManagement.getVoice.call(this as any, voiceId);
    }

    async deleteVoice(voiceId: string): Promise<unknown> {
        return voiceManagement.deleteVoice.call(this as any, voiceId);
    }

    // Text-to-speech
    async textToSpeech(voiceId: string, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
        return textToSpeechModule.textToSpeech.call(this as any, voiceId, text, options);
    }

    // Voice selection & language detection
    async getRandomVoice(): Promise<unknown> {
        return voiceSelection.getRandomVoice.call(this as any);
    }

    async getVoiceForLanguage(languageCode: string): Promise<unknown> {
        return voiceSelection.getVoiceForLanguage.call(this as any, languageCode);
    }

    detectLanguage(text: string): string {
        return voiceSelection.detectLanguage(text);
    }

    async textToSpeechWithRandomVoice(text: string, options: Record<string, unknown> = {}): Promise<unknown> {
        return voiceSelection.textToSpeechWithRandomVoice.call(this as any, text, options);
    }

    // Alias for textToSpeechWithRandomVoice (used by smartFallback)
    async textToSpeechForBot(text: string, options: Record<string, unknown> = {}): Promise<unknown> {
        return this.textToSpeechWithRandomVoice(text, options);
    }
}

const voiceService = new VoiceService();

export default voiceService;
export { voiceService, VoiceService };
