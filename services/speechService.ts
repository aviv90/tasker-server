/**
 * Speech Service for ElevenLabs Speech-to-Text API integration
 * 
 * Uses the latest and most advanced models:
 * - scribe_v2: Latest STT model with improved multilingual performance,
 *   reduced hallucinations during silence, and better handling of early transcript termination
 * 
 * @version 2.0.0 - Updated to use experimental model for superior transcription quality
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { SpeechClient } from './speech/client';
import { speechToText } from './speech/transcription';
import { batchSpeechToText } from './speech/batch';
import { validateAudioFile } from './speech/validation';
import { getAvailableOptions } from './speech/options';
import { SpeechToTextOptions, TranscriptionResult, AudioFile, BatchResult, ValidationResult } from './speech/types';

class SpeechService {
    /**
     * Initialize ElevenLabs client with lazy loading for environment variables
     * @returns Initialized ElevenLabs client
     */
    initializeClient(): ElevenLabsClient {
        return SpeechClient.getInstance();
    }

    /**
     * Convert speech to text using ElevenLabs API
     * @param audioBuffer - Audio data buffer
     * @param options - Configuration options
     * @returns Transcription result with text and metadata
     */
    async speechToText(audioBuffer: Buffer, options: SpeechToTextOptions = {}): Promise<TranscriptionResult> {
        return speechToText(audioBuffer, options);
    }

    /**
     * Batch process multiple audio files
     * @param audioFiles - Array of {buffer, filename, options}
     * @returns Batch processing results
     */
    async batchSpeechToText(audioFiles: AudioFile[] = []): Promise<BatchResult> {
        return batchSpeechToText(audioFiles);
    }

    /**
     * Get available models and languages
     * @returns Available options
     */
    getAvailableOptions() {
        return getAvailableOptions();
    }

    /**
     * Validate audio file before processing
     * @param audioBuffer - Audio buffer to validate
     * @param format - Expected format
     * @returns Validation result
     */
    validateAudioFile(audioBuffer: Buffer, format: string = 'mp3'): ValidationResult {
        return validateAudioFile(audioBuffer, format);
    }
}

// Create and export instance
const speechService = new SpeechService();

export default speechService;
export {
    speechToText,
    batchSpeechToText,
    getAvailableOptions,
    validateAudioFile
};
export const initializeClient = speechService.initializeClient.bind(speechService);
