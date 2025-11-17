const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const voiceCloning = require('./voice/voiceCloning');
const voiceManagement = require('./voice/voiceManagement');
const textToSpeechModule = require('./voice/textToSpeech');
const voiceSelection = require('./voice/voiceSelection');

/**
 * Voice Service orchestrator for ElevenLabs integration
 * Split into modular helpers (Phase 5.3)
 */
class VoiceService {
    constructor() {
        this.client = null;
    }

    initializeClient() {
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
    async createInstantVoiceClone(audioBuffers, options = {}) {
        return voiceCloning.createInstantVoiceClone.call(this, audioBuffers, options);
    }

    getAvailableOptions() {
        return voiceCloning.getAvailableOptions();
    }

    // Voice management
    async getVoices() {
        return voiceManagement.getVoices.call(this);
    }

    async getVoice(voiceId) {
        return voiceManagement.getVoice.call(this, voiceId);
    }

    async deleteVoice(voiceId) {
        return voiceManagement.deleteVoice.call(this, voiceId);
    }

    // Text-to-speech
    async textToSpeech(voiceId, text, options = {}) {
        return textToSpeechModule.textToSpeech.call(this, voiceId, text, options);
    }

    // Voice selection & language detection
    async getRandomVoice() {
        return voiceSelection.getRandomVoice.call(this);
    }

    async getVoiceForLanguage(languageCode) {
        return voiceSelection.getVoiceForLanguage.call(this, languageCode);
    }

    detectLanguage(text) {
        return voiceSelection.detectLanguage(text);
    }

    async textToSpeechWithRandomVoice(text, options = {}) {
        return voiceSelection.textToSpeechWithRandomVoice.call(this, text, options);
    }
}

const voiceService = new VoiceService();

module.exports = {
    voiceService,
    VoiceService
};

