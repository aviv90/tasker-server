const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Speech Service for ElevenLabs Speech-to-Text API integration
 * 
 * Uses the latest and most advanced models:
 * - scribe_v1_experimental: Latest STT model with improved multilingual performance,
 *   reduced hallucinations during silence, and better handling of early transcript termination
 * 
 * @version 2.0.0 - Updated to use experimental model for superior transcription quality
 */
class SpeechService {
    constructor() {
        // Don't initialize ElevenLabs client in constructor
        // Initialize it when first needed to ensure env vars are loaded
        this.elevenlabs = null;
        
        // Supported audio formats for speech-to-text
        this.supportedFormats = [
            'mp3', 'wav', 'ogg', 'opus', 'webm', 
            'm4a', 'aac', 'flac', 'wma', 'aiff', 'aif'
        ];
    }

    /**
     * Initialize ElevenLabs client with lazy loading for environment variables
     * @returns {ElevenLabsClient} - Initialized ElevenLabs client
     */
    initializeClient() {
        if (!this.client) {
            if (!process.env.ELEVENLABS_API_KEY) {
                throw new Error('ELEVENLABS_API_KEY environment variable is required');
            }
            
            const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
            this.client = new ElevenLabsClient({
                apiKey: process.env.ELEVENLABS_API_KEY
            });
        }
        
        return this.client;
    }

        /**
     * Convert speech to text using ElevenLabs API
     * @param {Buffer} audioBuffer - Audio data buffer
     * @param {Object} options - Configuration options
     * @returns {Object} - Transcription result with text and metadata
     */
    async speechToText(audioBuffer, options = {}) {
        try {
            console.log(`🎤 ElevenLabs Speech-to-Text (${audioBuffer.length} bytes)`);
            
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                return { error: 'Invalid audio buffer provided' };
            }

            try {
                const client = this.initializeClient();
                
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                
                const filename = `audio_${Date.now()}.${options.format || 'ogg'}`;
                const tempPath = path.join(os.tmpdir(), filename);
                
                try {
                    fs.writeFileSync(tempPath, audioBuffer);
                    const fileStream = fs.createReadStream(tempPath);
                    
                    const transcriptionRequest = {
                        modelId: options.model || 'scribe_v1_experimental', // Use the latest experimental version with improved multilingual performance
                        file: fileStream,
                        languageCode: options.language || null,
                        enableLogging: options.logging !== false
                    };
                
                    if (options.diarize !== undefined) {
                        transcriptionRequest.diarize = options.diarize;
                    }
                    if (options.numSpeakers) {
                        transcriptionRequest.numSpeakers = options.numSpeakers;
                    }
                    if (options.tagAudioEvents !== undefined) {
                        transcriptionRequest.tagAudioEvents = options.tagAudioEvents;
                    }
                    
                    const transcriptionResult = await client.speechToText.convert(transcriptionRequest);

                    // Clean up temporary file
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (cleanupError) {
                        console.warn('⚠️ Could not clean up temp file');
                    }

                    if (!transcriptionResult || !transcriptionResult.text) {
                        return { error: 'Speech-to-text conversion failed - no text returned' };
                    }

                    const text = transcriptionResult.text.trim();
                    console.log(`✅ Transcription completed (${text.length} chars)`);

                    return {
                        text: text,
                        result: text,
                        metadata: {
                            service: 'ElevenLabs',
                            model: options.model || 'scribe_v1_experimental', // Use the latest experimental version with improved multilingual performance
                            language: transcriptionResult.detected_language || options.language || 'auto',
                            confidence: transcriptionResult.confidence || null,
                            processing_time: transcriptionResult.processing_time_ms || null,
                            character_count: text.length,
                            word_count: text.split(/\s+/).filter(word => word.length > 0).length,
                            timestamp: new Date().toISOString()
                        }
                    };

                } catch (tempFileError) {
                    try {
                        if (fs.existsSync(tempPath)) {
                            fs.unlinkSync(tempPath);
                        }
                    } catch (cleanupError) {
                        // Silent cleanup
                    }
                    throw tempFileError;
                }

            } catch (transcriptionError) {
                throw transcriptionError;
            }

        } catch (err) {
            console.error('❌ ElevenLabs error:', err.message);
            
            if (err.response) {
                const status = err.response.status;
                const message = err.response.data?.detail || err.response.data?.message || err.message;
                
                if (status === 401) {
                    return { error: 'Invalid ElevenLabs API key' };
                } else if (status === 402) {
                    return { error: 'Insufficient ElevenLabs credits' };
                } else if (status === 413) {
                    return { error: 'Audio file too large (max 25MB)' };
                } else if (status === 422) {
                    return { error: `Audio format not supported: ${message}` };
                } else {
                    return { error: `ElevenLabs API error (${status}): ${message}` };
                }
            }
            
            return { error: err.message || 'Speech-to-text conversion failed' };
        }
    }    /**
     * Batch process multiple audio files
     * @param {Array} audioFiles - Array of {buffer, filename, options}
     * @returns {Object} - Batch processing results
     */
    async batchSpeechToText(audioFiles = []) {
        try {
            console.log(`🎤 Batch Speech-to-Text: ${audioFiles.length} files`);
            
            if (!Array.isArray(audioFiles) || audioFiles.length === 0) {
                return { error: 'No audio files provided for batch processing' };
            }

            const results = [];
            const errors = [];

            for (let i = 0; i < audioFiles.length; i++) {
                const file = audioFiles[i];
                const result = await this.speechToText(file.buffer, file.options || {});
                
                if (result.error) {
                    errors.push({
                        filename: file.filename || `file_${i + 1}`,
                        error: result.error
                    });
                } else {
                    results.push({
                        filename: file.filename || `file_${i + 1}`,
                        text: result.text,
                        metadata: result.metadata
                    });
                }

                // Small delay to respect rate limits
                if (i < audioFiles.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`✅ Batch completed: ${results.length} success, ${errors.length} errors`);

            return {
                results: results,
                errors: errors,
                summary: {
                    total_files: audioFiles.length,
                    successful: results.length,
                    failed: errors.length,
                    total_characters: results.reduce((sum, r) => sum + r.text.length, 0),
                    total_words: results.reduce((sum, r) => sum + r.metadata.word_count, 0)
                }
            };

        } catch (err) {
            console.error('❌ Batch processing error:', err.message);
            return { error: err.message || 'Batch processing failed' };
        }
    }

    /**
     * Get available models and languages
     * @returns {Object} - Available options
     */
    getAvailableOptions() {
        return {
            models: [
                {
                    id: 'scribe_v1',
                    name: 'Scribe v1',
                    description: 'ElevenLabs primary speech-to-text model',
                    languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
                },
                {
                    id: 'scribe_v1_experimental',
                    name: 'Scribe v1 Experimental',
                    description: 'Experimental version with latest improvements',
                    languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
                }
            ],
            supported_formats: this.supportedFormats,
            max_file_size: '25MB',
            optimization_levels: [
                { level: 0, description: 'No optimization (best quality)' },
                { level: 1, description: 'Light optimization' },
                { level: 2, description: 'Balanced optimization' },
                { level: 3, description: 'Aggressive optimization' },
                { level: 4, description: 'Maximum speed (lower quality)' }
            ]
        };
    }

    /**
     * Save audio buffer to temporary file
     * @param {Buffer} audioBuffer - Audio data
     * @param {string} format - File format
     * @returns {Object} - File path or error
     */
    async _saveTemporaryAudioFile(audioBuffer, format = 'mp3') {
        try {
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                return { error: `Unsupported audio format: ${format}` };
            }

            const filename = `temp_speech_${uuidv4()}.${format.toLowerCase()}`;
            const tempDir = path.join(__dirname, '..', 'public', 'tmp');
            const filePath = path.join(tempDir, filename);

            // Ensure temp directory exists
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Write audio buffer to file
            fs.writeFileSync(filePath, audioBuffer);

            // Verify file was written
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
                return { error: 'Failed to write audio file' };
            }

            console.log(`💾 Temporary audio file saved: ${filename} (${stats.size} bytes)`);

            return {
                path: filePath,
                filename: filename,
                size: stats.size
            };

        } catch (err) {
            console.error('❌ Error saving temporary audio file:', err);
            return { error: err.message || 'Failed to save audio file' };
        }
    }

    /**
     * Clean up temporary file
     * @param {string} filePath - Path to temporary file
     */
    _cleanupTemporaryFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Temporary file cleaned up: ${path.basename(filePath)}`);
            }
        } catch (err) {
            console.warn('⚠️ Failed to cleanup temporary file:', err.message);
        }
    }

    /**
     * Validate audio file before processing
     * @param {Buffer} audioBuffer - Audio buffer to validate
     * @param {string} format - Expected format
     * @returns {Object} - Validation result
     */
    validateAudioFile(audioBuffer, format = 'mp3') {
        try {
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                return { valid: false, error: 'Invalid audio buffer' };
            }

            if (audioBuffer.length === 0) {
                return { valid: false, error: 'Empty audio buffer' };
            }

            // Check file size (25MB limit for ElevenLabs)
            const maxSize = 25 * 1024 * 1024; // 25MB in bytes
            if (audioBuffer.length > maxSize) {
                return { 
                    valid: false, 
                    error: `Audio file too large: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB (max 25MB)` 
                };
            }

            // Check format
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                return { 
                    valid: false, 
                    error: `Unsupported format: ${format}. Supported: ${this.supportedFormats.join(', ')}` 
                };
            }

            return { 
                valid: true, 
                size: audioBuffer.length,
                format: format.toLowerCase()
            };

        } catch (err) {
            return { valid: false, error: err.message };
        }
    }
}

// Create and export instance
const speechService = new SpeechService();

module.exports = {
    speechToText: speechService.speechToText.bind(speechService),
    batchSpeechToText: speechService.batchSpeechToText.bind(speechService),
    getAvailableOptions: speechService.getAvailableOptions.bind(speechService),
    validateAudioFile: speechService.validateAudioFile.bind(speechService),
    initializeClient: speechService.initializeClient.bind(speechService)
};
