/**
 * Voice cloning helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Create instant voice clone from audio buffers
 * @param {Buffer|Buffer[]} audioBuffers - Audio buffer(s)
 * @param {Object} options - Voice cloning options
 * @returns {Promise<Object>}
 */
async function createInstantVoiceClone(audioBuffers, options = {}) {
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
                removeBackgroundNoise: options.removeBackgroundNoise !== false,
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

            const voiceId = result.voiceId || result.data?.voiceId;
            const requiresVerification = result.requiresVerification || result.data?.requiresVerification || false;

            if (!voiceId) {
                console.error('❌ No voice ID in response:', result);
                return { error: 'Voice cloning failed - no voice ID returned' };
            }

            console.log(`✅ Voice clone created successfully: ${voiceId}`);

            return {
                success: true,
                voiceId,
                requiresVerification,
                data: result
            };
        } finally {
            // Ensure streams are closed
            fileStreams.forEach(stream => {
                try {
                    stream?.destroy();
                } catch (streamError) {
                    console.warn('⚠️ Error closing stream:', streamError.message);
                }
            });
        }
    } catch (err) {
        console.error('❌ Voice cloning error:', err.message);
        return { error: err.message || 'Voice cloning failed' };
    }
}

/**
 * Voice cloning available options metadata
 * @returns {Object}
 */
function getAvailableOptions() {
    return {
        supportedFormats: ['wav', 'mp3', 'ogg', 'flac', 'm4a'],
        maxFiles: 25,
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

module.exports = {
    createInstantVoiceClone,
    getAvailableOptions
};

