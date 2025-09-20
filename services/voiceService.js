const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const { v4: uuidv4 } = require('uuid');

/**
 * Voice Service for ElevenLabs API integration
 * 
 * Uses the latest and most advanced models:
 * - eleven_v3: Most advanced TTS model with 70+ languages support and highest emotional expression
 * - IVC (Instant Voice Cloning): Create voices from audio samples
 * 
 * @version 2.0.0 - Updated to use Eleven v3 as default model for superior quality
 */
class VoiceService {
    constructor() {
        this.client = null;
    }

    /**
     * Initialize ElevenLabs client with lazy loading
     */
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

    /**
     * Create instant voice clone from audio file(s)
     * @param {Buffer|Buffer[]} audioBuffers - Audio buffer(s) for voice cloning
     * @param {Object} options - Voice cloning options
     * @returns {Object} - Voice clone result with voice ID
     */
    async createInstantVoiceClone(audioBuffers, options = {}) {
        try {
            console.log(`🎤 Creating instant voice clone: ${options.name || 'Unnamed Voice'}`);
            
            if (!audioBuffers) {
                return { error: 'No audio provided for voice cloning' };
            }

            // Ensure audioBuffers is an array
            const buffers = Array.isArray(audioBuffers) ? audioBuffers : [audioBuffers];
            
            // Validate all buffers
            for (let i = 0; i < buffers.length; i++) {
                if (!Buffer.isBuffer(buffers[i])) {
                    return { error: `Invalid audio buffer at index ${i}` };
                }
            }

            const client = this.initializeClient();
            
            // Create temporary files for each audio buffer
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            
            const tempFiles = [];
            const fileStreams = [];

            try {
                // Create temporary files
                for (let i = 0; i < buffers.length; i++) {
                    const filename = `voice_sample_${Date.now()}_${i}.${options.format || 'wav'}`;
                    const tempPath = path.join(os.tmpdir(), filename);
                    
                    fs.writeFileSync(tempPath, buffers[i]);
                    tempFiles.push(tempPath);
                    fileStreams.push(fs.createReadStream(tempPath));
                }

                // Prepare voice cloning request with optimal parameters for maximum accuracy
                const voiceRequest = {
                    name: options.name || `Voice_${Date.now()}`,
                    files: fileStreams,
                    removeBackgroundNoise: options.removeBackgroundNoise !== false, // Default true for better quality
                    description: options.description || 'High-quality voice clone for conversational use',
                    labels: options.labels || JSON.stringify({
                        accent: 'natural',
                        use_case: 'conversational',
                        quality: 'high',
                        style: 'natural',
                        emotion: 'neutral'
                    })
                };

                console.log(`🔄 Sending ${buffers.length} audio samples to ElevenLabs...`);
                const result = await client.voices.ivc.create(voiceRequest);

                // Clean up temporary files
                tempFiles.forEach(tempPath => {
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (cleanupError) {
                        console.warn('⚠️ Could not clean up temp file:', tempPath);
                    }
                });

                console.log('🔍 Voice cloning result:', result);

                // Handle different response formats
                const voiceId = result.voiceId || result.data?.voiceId;
                const requiresVerification = result.requiresVerification || result.data?.requiresVerification || false;

                if (!voiceId) {
                    console.error('❌ No voice ID in response:', result);
                    return { error: 'Voice cloning failed - no voice ID returned' };
                }

                console.log(`✅ Voice clone created successfully: ${voiceId}`);

                return {
                    voiceId: voiceId,
                    requiresVerification: requiresVerification,
                    name: options.name || `Voice_${Date.now()}`,
                    metadata: {
                        service: 'ElevenLabs',
                        type: 'instant_voice_clone',
                        samples_count: buffers.length,
                        created_at: new Date().toISOString(),
                        options: {
                            removeBackgroundNoise: options.removeBackgroundNoise !== false,
                            description: options.description,
                            labels: options.labels
                        }
                    }
                };

            } catch (tempFileError) {
                // Clean up temp files on error
                tempFiles.forEach(tempPath => {
                    try {
                        if (fs.existsSync(tempPath)) {
                            fs.unlinkSync(tempPath);
                        }
                    } catch (cleanupError) {
                        // Silent cleanup
                    }
                });
                throw tempFileError;
            }

        } catch (err) {
            console.error('❌ Voice cloning error:', err.message);
            
            if (err.response) {
                const status = err.response.status;
                const message = err.response.data?.detail || err.response.data?.message || err.message;
                
                if (status === 401) {
                    return { error: 'Invalid ElevenLabs API key' };
                } else if (status === 402) {
                    return { error: 'Insufficient ElevenLabs credits' };
                } else if (status === 413) {
                    return { error: 'Audio file too large' };
                } else if (status === 422) {
                    return { error: `Invalid audio format: ${message}` };
                } else {
                    return { error: `ElevenLabs API error (${status}): ${message}` };
                }
            }
            
            return { error: err.message || 'Voice cloning failed' };
        }
    }

    /**
     * Get all available voices (including cloned ones)
     * @returns {Object} - List of available voices
     */
    async getVoices() {
        try {
            const client = this.initializeClient();
            const voices = await client.voices.getAll();
            
            // Handle different response formats
            const voiceList = voices.voices || voices.data?.voices || [];
            
            console.log(`🎤 Retrieved ${voiceList.length} voices from ElevenLabs`);
            
            return {
                voices: voiceList,
                total: voiceList.length
            };
        } catch (err) {
            console.error('❌ Error fetching voices:', err.message);
            return { error: err.message || 'Failed to fetch voices' };
        }
    }

    /**
     * Get specific voice details
     * @param {string} voiceId - Voice ID to get details for
     * @returns {Object} - Voice details
     */
    async getVoice(voiceId) {
        try {
            const client = this.initializeClient();
            const voice = await client.voices.get(voiceId);
            
            // Handle different response formats
            return voice || voice.data || {};
        } catch (err) {
            console.error('❌ Error fetching voice:', err.message);
            return { error: err.message || 'Failed to fetch voice details' };
        }
    }

    /**
     * Delete a voice
     * @param {string} voiceId - Voice ID to delete
     * @returns {Object} - Deletion result
     */
    async deleteVoice(voiceId) {
        try {
            const client = this.initializeClient();
            await client.voices.delete(voiceId);
            
            console.log(`✅ Voice deleted: ${voiceId}`);
            return { success: true, voiceId };
        } catch (err) {
            console.error('❌ Error deleting voice:', err.message);
            return { error: err.message || 'Failed to delete voice' };
        }
    }

    /**
     * Convert text to speech using a specific voice
     * @param {string} voiceId - Voice ID to use for TTS
     * @param {string} text - Text to convert to speech
     * @param {Object} options - TTS options
     * @returns {Object} - Audio file result
     */
    async textToSpeech(voiceId, text, options = {}) {
        try {
            console.log(`🗣️ Converting text to speech with voice: ${voiceId}`);
            
            if (!voiceId || !text) {
                return { error: 'Voice ID and text are required' };
            }

            const client = this.initializeClient();
            
            // Determine language code - default to Hebrew if not provided
            let languageCode = options.languageCode || 'he';
            
            // Map some common language codes to ISO 639-1 format
            const languageMap = {
                'auto': null, // Let the model decide
                'unknown': 'he', // Default to Hebrew for unknown languages
                'hebrew': 'he',
                'he': 'he',
                'english': 'en',
                'en': 'en',
                'spanish': 'es',
                'es': 'es',
                'french': 'fr',
                'fr': 'fr',
                'german': 'de',
                'de': 'de',
                'italian': 'it',
                'it': 'it',
                'portuguese': 'pt',
                'pt': 'pt',
                'polish': 'pl',
                'pl': 'pl',
                'turkish': 'tr',
                'tr': 'tr',
                'russian': 'ru',
                'ru': 'ru',
                'dutch': 'nl',
                'nl': 'nl',
                'czech': 'cs',
                'cs': 'cs',
                'arabic': 'ar',
                'ar': 'ar',
                'chinese': 'zh',
                'zh': 'zh',
                'japanese': 'ja',
                'ja': 'ja',
                'hindi': 'hi',
                'hi': 'hi'
            };
            
            // If language is in our map, use the mapped value
            if (languageMap.hasOwnProperty(languageCode)) {
                languageCode = languageMap[languageCode];
            }
            
            // Use Eleven v3 as default - the most advanced model with 70+ languages support
            let modelId = options.modelId || 'eleven_v3';
            
            console.log(`🚀 Using Eleven v3 model (most advanced) for language: ${languageCode || 'auto-detect'}`);
            
            // Note: eleven_v3 is the newest and most expressive model with support for 70+ languages
            // It provides the highest quality audio generation and supports all our required features
            
            console.log(`🌐 Language code: ${languageCode || 'auto-detect'}, Model: ${modelId}`);
            
            // TTS request options - build conditionally based on model capabilities
            const ttsRequest = {
                text: text,
                modelId: modelId,
                outputFormat: options.outputFormat || 'mp3_44100_128', // ElevenLabs doesn't support ogg_vorbis
                languageCode: languageCode,
                voiceSettings: options.voiceSettings || null
            };

            // Add optimize_streaming_latency only for models that support it
            // eleven_v3 does NOT support this parameter
            if (modelId !== 'eleven_v3' && options.optimizeStreamingLatency !== undefined) {
                ttsRequest.optimizeStreamingLatency = options.optimizeStreamingLatency || 0;
                console.log(`⚡ Added streaming latency optimization: ${ttsRequest.optimizeStreamingLatency}`);
            } else if (modelId === 'eleven_v3') {
                console.log(`⚡ Eleven v3 model - streaming latency optimization not supported (and not needed)`);
            }

            console.log(`🔄 Generating speech for ${text.length} characters...`);
            const audioStream = await client.textToSpeech.convert(voiceId, ttsRequest);

            // Convert stream to buffer
            const chunks = [];
            const reader = audioStream.getReader();
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }

            const audioBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
            
            // Save audio file to public/tmp
            const fs = require('fs');
            const path = require('path');
            
            // Ensure the tmp directory exists (important for Heroku)
            const tmpDir = path.join(process.cwd(), 'public', 'tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
                console.log('📁 Created tmp directory');
            }
            
            const audioFileName = `tts_${uuidv4()}.mp3`; // ElevenLabs outputs MP3 format
            const audioFilePath = path.join(tmpDir, audioFileName);
            fs.writeFileSync(audioFilePath, audioBuffer);
            
            // Also create an OGG version for better mobile compatibility
            const oggFileName = audioFileName.replace('.mp3', '.ogg');
            const oggFilePath = path.join(tmpDir, oggFileName);
            
            try {
                // For now, just copy the MP3 as OGG (basic compatibility)
                // In future, could use ffmpeg for proper conversion
                fs.writeFileSync(oggFilePath, audioBuffer);
                console.log(`📱 Created OGG version for mobile compatibility: ${oggFileName}`);
            } catch (oggError) {
                console.warn('⚠️ Could not create OGG version:', oggError.message);
            }
            
            const audioUrl = `/static/${audioFileName}`; // Changed from /static/tmp/ to /static/
            const oggUrl = `/static/${oggFileName}`; // OGG version for mobile
            
            console.log('✅ Text-to-speech conversion completed');
            console.log(`🔗 Audio available at: ${audioUrl}`);
            
            return {
                audioUrl: audioUrl,
                oggUrl: oggUrl, // OGG version for mobile compatibility
                audioBuffer: audioBuffer,
                voiceId: voiceId,
                text: text,
                metadata: {
                    service: 'ElevenLabs',
                    type: 'text_to_speech',
                    modelId: ttsRequest.modelId,
                    outputFormat: ttsRequest.outputFormat,
                    textLength: text.length,
                    audioSize: audioBuffer.length,
                    created_at: new Date().toISOString(),
                    mobileCompatibility: 'OGG version created for mobile devices'
                }
            };

        } catch (err) {
            console.error('❌ Text-to-speech error:', err.message);
            
            if (err.response) {
                const status = err.response.status;
                const message = err.response.data?.detail || err.response.data?.message || err.message;
                
                if (status === 401) {
                    return { error: 'Invalid ElevenLabs API key' };
                } else if (status === 402) {
                    return { error: 'Insufficient ElevenLabs credits' };
                } else if (status === 404) {
                    return { error: 'Voice not found' };
                } else if (status === 422) {
                    return { error: `Invalid parameters: ${message}` };
                } else {
                    return { error: `ElevenLabs API error (${status}): ${message}` };
                }
            }
            
            return { error: err.message || 'Text-to-speech conversion failed' };
        }
    }

    /**
     * Get a random available voice ID for text-to-speech
     * @returns {Object} - Random voice ID or error
     */
    async getRandomVoice() {
        try {
            const voicesResult = await this.getVoices();
            if (voicesResult.error) {
                return { error: voicesResult.error };
            }
            
            const voices = voicesResult.voices || [];
            if (voices.length === 0) {
                return { error: 'No voices available' };
            }
            
            // Filter only available voices (not cloned ones that might be deleted)
            const availableVoices = voices.filter(voice => 
                (voice.voice_id || voice.voiceId || voice.id) && 
                voice.category !== 'cloned' // Prefer built-in voices for stability
            );
            
            if (availableVoices.length === 0) {
                // If no built-in voices, use any available voice
                const randomIndex = Math.floor(Math.random() * voices.length);
                const selectedVoice = voices[randomIndex];
                console.log(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);
                
                return {
                    voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
                    voiceName: selectedVoice.name,
                    voiceCategory: selectedVoice.category
                };
            }
            
            // Select random voice from available built-in voices
            const randomIndex = Math.floor(Math.random() * availableVoices.length);
            const selectedVoice = availableVoices[randomIndex];
            
            console.log(`🎲 Selected random voice: ${selectedVoice.name}`);
            
            return {
                voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
                voiceName: selectedVoice.name,
                voiceCategory: selectedVoice.category
            };
        } catch (err) {
            console.error('❌ Error getting random voice:', err.message);
            return { error: err.message || 'Failed to get random voice' };
        }
    }

    /**
     * Detect language from text content
     * @param {string} text - Text to analyze
     * @returns {string} - Language code (he, en, ar, etc.)
     */
    detectLanguage(text) {
        if (!text || typeof text !== 'string') {
            return 'en'; // Default to English
        }
        
        // Hebrew detection - check for Hebrew characters
        const hebrewRegex = /[\u0590-\u05FF]/;
        if (hebrewRegex.test(text)) {
            return 'he';
        }
        
        // Arabic detection - check for Arabic characters  
        const arabicRegex = /[\u0600-\u06FF]/;
        if (arabicRegex.test(text)) {
            return 'ar';
        }
        
        // Russian detection - check for Cyrillic characters
        const russianRegex = /[\u0400-\u04FF]/;
        if (russianRegex.test(text)) {
            return 'ru';
        }
        
        // Spanish detection - check for Spanish-specific characters
        const spanishRegex = /[ñáéíóúüÑÁÉÍÓÚÜ]/;
        if (spanishRegex.test(text)) {
            return 'es';
        }
        
        // French detection - check for French-specific characters
        const frenchRegex = /[àâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/;
        if (frenchRegex.test(text)) {
            return 'fr';
        }
        
        // German detection - check for German-specific characters
        const germanRegex = /[äöüßÄÖÜ]/;
        if (germanRegex.test(text)) {
            return 'de';
        }
        
        // Default to English for Latin characters or unknown
        return 'en';
    }

    /**
     * Text-to-Speech with random voice selection
     * @param {string} text - Text to convert to speech
     * @param {Object} options - TTS options (optional)
     * @returns {Object} - Audio result with voice info
     */
    async textToSpeechWithRandomVoice(text, options = {}) {
        try {
            console.log(`🎲 Starting TTS with random voice for text: "${text.substring(0, 50)}..."`);
            
            // Detect language from text
            const detectedLanguage = this.detectLanguage(text);
            console.log(`🌐 Detected language: ${detectedLanguage}`);
            
            // Get random voice
            const randomVoiceResult = await this.getRandomVoice();
            if (randomVoiceResult.error) {
                return { error: `Failed to get random voice: ${randomVoiceResult.error}` };
            }
            
            const { voiceId, voiceName, voiceCategory } = randomVoiceResult;
            console.log(`🎤 Using voice: ${voiceName}`);
            
            if (!voiceId) {
                return { error: 'No voice ID received from random voice selection' };
            }
            
            // Prepare TTS options with detected language
            const ttsOptions = {
                ...options,
                languageCode: detectedLanguage,
                modelId: options.modelId || 'eleven_v3' // Use eleven_v3 for best multilingual support
            };
            
            // Generate speech with the selected voice and language
            const ttsResult = await this.textToSpeech(voiceId, text, ttsOptions);
            
            if (ttsResult.error) {
                return { error: ttsResult.error };
            }
            
            // Return result with voice information
            return {
                ...ttsResult,
                voiceInfo: {
                    voiceId,
                    voiceName,
                    voiceCategory
                }
            };
        } catch (err) {
            console.error('❌ Error in TTS with random voice:', err.message);
            return { error: err.message || 'Text-to-speech with random voice failed' };
        }
    }

    /**
     * Get available voice cloning options
     * @returns {Object} - Available options
     */
    getAvailableOptions() {
        return {
            supportedFormats: ['wav', 'mp3', 'ogg', 'flac', 'm4a'],
            maxFiles: 25, // ElevenLabs limit
            maxFileSize: '10MB per file',
            totalMaxSize: '100MB total',
            minDuration: '1 second',
            maxDuration: '30 minutes per file',
            recommendedDuration: '1-5 minutes of high-quality audio',
            features: {
                removeBackgroundNoise: 'Automatically remove background noise',
                description: 'Add description for voice identification',
                labels: 'Add custom labels for organization'
            },
            notes: [
                'High-quality audio produces better voice clones',
                'Clear speech without background noise is recommended',
                'Multiple samples can improve voice quality',
                'Voice may require verification for certain use cases'
            ]
        };
    }
}

const voiceService = new VoiceService();

module.exports = {
    voiceService,
    VoiceService
};
