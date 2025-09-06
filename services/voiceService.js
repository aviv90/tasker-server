const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const { v4: uuidv4 } = require('uuid');

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

                // Prepare voice cloning request
                const voiceRequest = {
                    name: options.name || `Voice_${Date.now()}`,
                    files: fileStreams,
                    removeBackgroundNoise: options.removeBackgroundNoise !== false, // Default true
                    description: options.description || null,
                    labels: options.labels || null
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

                if (!result.data || !result.data.voiceId) {
                    return { error: 'Voice cloning failed - no voice ID returned' };
                }

                console.log(`✅ Voice clone created successfully: ${result.data.voiceId}`);

                return {
                    voiceId: result.data.voiceId,
                    requiresVerification: result.data.requiresVerification || false,
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
            
            return {
                voices: voices.data?.voices || [],
                total: voices.data?.voices?.length || 0
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
            
            return voice.data || {};
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
            
            // TTS request options
            const ttsRequest = {
                text: text,
                modelId: options.modelId || 'eleven_multilingual_v2',
                outputFormat: options.outputFormat || 'mp3_44100_128',
                optimizeStreamingLatency: options.optimizeStreamingLatency || 0,
                voiceSettings: options.voiceSettings || null
            };

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
            
            const audioFileName = `tts_${uuidv4()}.mp3`;
            const audioFilePath = path.join(process.cwd(), 'public', 'tmp', audioFileName);
            fs.writeFileSync(audioFilePath, audioBuffer);
            
            const audioUrl = `/tmp/${audioFileName}`;
            
            console.log('✅ Text-to-speech conversion completed');
            
            return {
                audioUrl: audioUrl,
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
                    created_at: new Date().toISOString()
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
