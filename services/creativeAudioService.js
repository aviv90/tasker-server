const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Creative Audio Processing Service
 * Handles creative audio effects and remixing using FFmpeg
 */
class CreativeAudioService {
    constructor() {
        this.tempDir = path.join(__dirname, '..', 'public', 'tmp');
        this.ensureTempDir();
        
        // Creative effects library
        this.effects = {
            // Voice effects
            robot: {
                name: '🤖 Robot Voice',
                command: '-filter:a "atempo=0.8,asetrate=44100*0.8,volume=1.2"'
            },
            chipmunk: {
                name: '🐿️ Chipmunk Voice',
                command: '-filter:a "atempo=1.5,asetrate=44100*1.5"'
            },
            deep: {
                name: '🎭 Deep Voice',
                command: '-filter:a "atempo=0.7,asetrate=44100*0.7"'
            },
            radio: {
                name: '📻 Radio Effect',
                command: '-filter:a "highpass=f=300,lowpass=f=3000,volume=0.8"'
            },
            telephone: {
                name: '📞 Telephone Effect',
                command: '-filter:a "highpass=f=300,lowpass=f=3400,volume=0.7"'
            },
            echo: {
                name: '🔊 Echo Effect',
                command: '-filter:a "aecho=0.8:0.9:1000:0.3"'
            },
            reverb: {
                name: '🏛️ Reverb Effect',
                command: '-filter:a "aecho=0.8:0.9:1000:0.3,volume=0.9"'
            },
            distortion: {
                name: '🎸 Distortion',
                command: '-filter:a "volume=2.0,acompressor=threshold=0.1:ratio=9:attack=200:release=1000"'
            },
            chorus: {
                name: '🎵 Chorus Effect',
                command: '-filter:a "chorus=0.5:0.9:50:0.4:0.25:2"'
            },
            flanger: {
                name: '🌊 Flanger Effect',
                command: '-filter:a "flanger=delay=10:depth=2:regen=0:width=71:speed=0.5"'
            }
        };

        // Background music templates (short loops)
        this.backgroundMusic = {
            upbeat: {
                name: '🎉 Upbeat Pop',
                command: '-filter:a "volume=0.3"',
                description: 'Energetic pop background'
            },
            chill: {
                name: '🌊 Chill Vibes',
                command: '-filter:a "volume=0.25"',
                description: 'Relaxed ambient background'
            },
            dramatic: {
                name: '🎭 Dramatic',
                command: '-filter:a "volume=0.35"',
                description: 'Cinematic dramatic background'
            },
            electronic: {
                name: '⚡ Electronic',
                command: '-filter:a "volume=0.3"',
                description: 'Electronic dance background'
            },
            jazz: {
                name: '🎷 Jazz',
                command: '-filter:a "volume=0.25"',
                description: 'Smooth jazz background'
            }
        };
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Get random creative effect
     * @returns {Object} Random effect configuration
     */
    getRandomEffect() {
        const effectKeys = Object.keys(this.effects);
        const randomKey = effectKeys[Math.floor(Math.random() * effectKeys.length)];
        return {
            key: randomKey,
            ...this.effects[randomKey]
        };
    }

    /**
     * Get random background music
     * @returns {Object} Random background music configuration
     */
    getRandomBackground() {
        const backgroundKeys = Object.keys(this.backgroundMusic);
        const randomKey = backgroundKeys[Math.floor(Math.random() * backgroundKeys.length)];
        return {
            key: randomKey,
            ...this.backgroundMusic[randomKey]
        };
    }

    /**
     * Generate synthetic background music using FFmpeg
     * @param {number} duration - Duration in seconds
     * @param {string} style - Music style
     * @returns {Promise<string>} Path to generated music file
     */
    async generateBackgroundMusic(duration, style = 'upbeat') {
        try {
            const fileName = `bg_music_${uuidv4()}.mp3`;
            const filePath = path.join(this.tempDir, fileName);

            console.log(`🎵 Generating ${style} background music (${duration}s)...`);

            // Generate synthetic music using FFmpeg
            let musicCommand;
            switch (style) {
                case 'upbeat':
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=440:duration=${duration}" -f lavfi -i "sine=frequency=554:duration=${duration}" -f lavfi -i "sine=frequency=659:duration=${duration}" -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
                    break;
                case 'chill':
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=220:duration=${duration}" -f lavfi -i "sine=frequency=330:duration=${duration}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
                    break;
                case 'dramatic':
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=110:duration=${duration}" -f lavfi -i "sine=frequency=220:duration=${duration}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
                    break;
                case 'electronic':
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=880:duration=${duration}" -f lavfi -i "sine=frequency=1108:duration=${duration}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
                    break;
                case 'jazz':
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=330:duration=${duration}" -f lavfi -i "sine=frequency=440:duration=${duration}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
                    break;
                default:
                    musicCommand = `ffmpeg -f lavfi -i "sine=frequency=440:duration=${duration}" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
            }

            await execAsync(musicCommand);
            
            if (!fs.existsSync(filePath)) {
                throw new Error('Background music generation failed');
            }

            console.log(`✅ Background music generated: ${fileName}`);
            return filePath;

        } catch (err) {
            console.error('❌ Error generating background music:', err);
            throw new Error(`Background music generation failed: ${err.message}`);
        }
    }

    /**
     * Apply creative effect to audio
     * @param {Buffer} audioBuffer - Input audio buffer
     * @param {string} inputFormat - Input format
     * @param {Object} effect - Effect configuration
     * @returns {Promise<Object>} Result with processed audio
     */
    async applyCreativeEffect(audioBuffer, inputFormat = 'mp3', effect) {
        return new Promise(async (resolve, reject) => {
            try {
                const inputFileName = `input_${uuidv4()}.${inputFormat}`;
                const outputFileName = `creative_${uuidv4()}.mp3`;
                const inputPath = path.join(this.tempDir, inputFileName);
                const outputPath = path.join(this.tempDir, outputFileName);

                // Write input audio buffer to temporary file
                fs.writeFileSync(inputPath, audioBuffer);

                console.log(`🎨 Applying creative effect: ${effect.name}`);

                // FFmpeg command for creative effect
                const ffmpegCommand = [
                    'ffmpeg',
                    '-i', inputPath,
                    effect.command,
                    '-c:a', 'libmp3lame',
                    '-b:a', '128k',
                    '-y', // Overwrite output file
                    outputPath
                ].join(' ');

                console.log(`🎵 FFmpeg command: ${ffmpegCommand}`);

                try {
                    const { stdout, stderr } = await execAsync(ffmpegCommand);
                    
                    if (stderr && stderr.includes('error')) {
                        throw new Error(`FFmpeg error: ${stderr}`);
                    }

                    // Read the processed audio file
                    if (!fs.existsSync(outputPath)) {
                        throw new Error('Output file was not created');
                    }

                    const processedBuffer = fs.readFileSync(outputPath);
                    
                    // Clean up temporary files
                    this.cleanupFile(inputPath);
                    this.cleanupFile(outputPath);

                    console.log(`✅ Creative effect applied: ${processedBuffer.length} bytes`);

                    resolve({
                        success: true,
                        audioBuffer: processedBuffer,
                        size: processedBuffer.length,
                        effect: effect.name
                    });

                } catch (ffmpegError) {
                    console.error('❌ FFmpeg processing error:', ffmpegError);
                    
                    // Clean up temporary files
                    this.cleanupFile(inputPath);
                    this.cleanupFile(outputPath);
                    
                    reject(new Error(`Creative processing failed: ${ffmpegError.message}`));
                }

            } catch (err) {
                console.error('❌ Error in creative effect setup:', err);
                reject(new Error(`Creative setup failed: ${err.message}`));
            }
        });
    }

    /**
     * Mix voice with background music
     * @param {Buffer} voiceBuffer - Voice audio buffer
     * @param {string} voiceFormat - Voice format
     * @param {string} backgroundPath - Background music file path
     * @returns {Promise<Object>} Result with mixed audio
     */
    async mixWithBackground(voiceBuffer, voiceFormat = 'mp3', backgroundPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const voiceFileName = `voice_${uuidv4()}.${voiceFormat}`;
                const outputFileName = `mixed_${uuidv4()}.mp3`;
                const voicePath = path.join(this.tempDir, voiceFileName);
                const outputPath = path.join(this.tempDir, outputFileName);

                // Write voice buffer to temporary file
                fs.writeFileSync(voicePath, voiceBuffer);

                console.log(`🎵 Mixing voice with background music...`);

                // FFmpeg command for mixing
                const ffmpegCommand = [
                    'ffmpeg',
                    '-i', voicePath,
                    '-i', backgroundPath,
                    '-filter_complex',
                    '[1:a]volume=0.3[bg];[0:a][bg]amix=inputs=2:duration=first:weights=1 0.3',
                    '-c:a', 'libmp3lame',
                    '-b:a', '128k',
                    '-y',
                    outputPath
                ].join(' ');

                console.log(`🎵 Mixing command: ${ffmpegCommand}`);

                try {
                    const { stdout, stderr } = await execAsync(ffmpegCommand);
                    
                    if (stderr && stderr.includes('error')) {
                        throw new Error(`FFmpeg mixing error: ${stderr}`);
                    }

                    // Read the mixed audio file
                    if (!fs.existsSync(outputPath)) {
                        throw new Error('Mixed file was not created');
                    }

                    const mixedBuffer = fs.readFileSync(outputPath);
                    
                    // Clean up temporary files
                    this.cleanupFile(voicePath);
                    this.cleanupFile(outputPath);

                    console.log(`✅ Voice mixed with background: ${mixedBuffer.length} bytes`);

                    resolve({
                        success: true,
                        audioBuffer: mixedBuffer,
                        size: mixedBuffer.length
                    });

                } catch (ffmpegError) {
                    console.error('❌ FFmpeg mixing error:', ffmpegError);
                    
                    // Clean up temporary files
                    this.cleanupFile(voicePath);
                    this.cleanupFile(outputPath);
                    
                    reject(new Error(`Audio mixing failed: ${ffmpegError.message}`));
                }

            } catch (err) {
                console.error('❌ Error in audio mixing setup:', err);
                reject(new Error(`Mixing setup failed: ${err.message}`));
            }
        });
    }

    /**
     * Process voice message with random creative effects
     * @param {Buffer} audioBuffer - Input audio buffer
     * @param {string} inputFormat - Input format
     * @returns {Promise<Object>} Result with processed audio
     */
    async processVoiceCreatively(audioBuffer, inputFormat = 'mp3') {
        try {
            console.log(`🎨 Starting creative voice processing...`);

            // Get random effect
            const effect = this.getRandomEffect();
            console.log(`🎲 Selected effect: ${effect.name}`);

            // Apply creative effect
            const effectResult = await this.applyCreativeEffect(audioBuffer, inputFormat, effect);
            
            if (!effectResult.success) {
                throw new Error('Creative effect failed');
            }

            // Decide whether to add background music (70% chance)
            const addBackground = Math.random() < 0.7;
            
            if (addBackground) {
                console.log(`🎵 Adding background music...`);
                
                // Get audio duration (approximate)
                const duration = Math.max(3, Math.min(15, audioBuffer.length / 10000)); // Rough estimate
                
                // Get random background style
                const background = this.getRandomBackground();
                console.log(`🎲 Selected background: ${background.name}`);

                // Generate background music
                const backgroundPath = await this.generateBackgroundMusic(duration, background.key);

                // Mix voice with background
                const mixResult = await this.mixWithBackground(effectResult.audioBuffer, 'mp3', backgroundPath);

                // Clean up background music file
                this.cleanupFile(backgroundPath);

                if (mixResult.success) {
                    return {
                        success: true,
                        audioBuffer: mixResult.audioBuffer,
                        size: mixResult.size,
                        effect: effect.name,
                        background: background.name,
                        description: `Applied ${effect.name} + ${background.name}`
                    };
                }
            }

            // Return just the effect result if no background or mixing failed
            return {
                success: true,
                audioBuffer: effectResult.audioBuffer,
                size: effectResult.size,
                effect: effect.name,
                description: `Applied ${effect.name}`
            };

        } catch (err) {
            console.error('❌ Error in creative voice processing:', err);
            return {
                success: false,
                error: err.message || 'Creative processing failed'
            };
        }
    }

    /**
     * Clean up temporary file
     * @param {string} filePath - Path to file to delete
     */
    cleanupFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
            }
        } catch (err) {
            console.warn(`⚠️ Failed to cleanup file ${filePath}:`, err.message);
        }
    }
}

// Create and export instance
const creativeAudioService = new CreativeAudioService();

module.exports = {
    creativeAudioService,
    CreativeAudioService
};
