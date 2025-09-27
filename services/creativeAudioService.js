const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const musicService = require('./musicService');

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
            },
            // Auto-tune and pitch effects
            autotune_up: {
                name: '🎤 Auto-tune Up',
                command: '-filter:a "asetrate=44100*2^(2/12),atempo=1/2^(2/12),aresample=44100"'
            },
            autotune_down: {
                name: '🎤 Auto-tune Down',
                command: '-filter:a "asetrate=44100*2^(-2/12),atempo=1/2^(-2/12),aresample=44100"'
            },
            vibrato: {
                name: '🎵 Vibrato',
                command: '-filter:a "vibrato=f=5.0:d=0.5"'
            },
            tremolo: {
                name: '🎵 Tremolo',
                command: '-filter:a "tremolo=f=5.0:d=0.5"'
            },
            phaser: {
                name: '🌀 Phaser',
                command: '-filter:a "aphaser=in_gain=0.4:out_gain=0.74:delay=3.0:decay=0.4:speed=0.5"'
            },
            pitch_up: {
                name: '🎼 Pitch Up',
                command: '-filter:a "asetrate=44100*2^(4/12),atempo=1/2^(4/12),aresample=44100"'
            },
            pitch_down: {
                name: '🎼 Pitch Down',
                command: '-filter:a "asetrate=44100*2^(-4/12),atempo=1/2^(-4/12),aresample=44100"'
            },
            compressor: {
                name: '🎚️ Compressor',
                command: '-filter:a "acompressor=threshold=0.089:ratio=9:attack=200:release=1000"'
            },
            stereo_wide: {
                name: '🎧 Stereo Wide',
                command: '-filter:a "stereowiden"'
            },
            // Additional creative effects
            reverse: {
                name: '⏪ Reverse',
                command: '-filter:a "areverse"'
            },
            fade_in: {
                name: '🌅 Fade In',
                command: '-filter:a "afade=t=in:st=0:d=2.0"'
            },
            fade_out: {
                name: '🌇 Fade Out',
                command: '-filter:a "afade=t=out:st=0:d=2.0"'
            },
            bass_boost: {
                name: '🔊 Bass Boost',
                command: '-filter:a "bass=g=5:f=100"'
            },
            treble_boost: {
                name: '🔊 Treble Boost',
                command: '-filter:a "treble=g=5:f=3000"'
            },
            noise_reduction: {
                name: '🔇 Noise Reduction',
                command: '-filter:a "afftdn=nf=-25"'
            },
            equalizer: {
                name: '🎛️ Equalizer',
                command: '-filter:a "aequalizer=f=1000:width_type=h:width=200:g=-5"'
            },
            slow_motion: {
                name: '🐌 Slow Motion',
                command: '-filter:a "atempo=0.5"'
            },
            fast_forward: {
                name: '⚡ Fast Forward',
                command: '-filter:a "atempo=2.0"'
            },
            underwater: {
                name: '🌊 Underwater',
                command: '-filter:a "highpass=f=200,lowpass=f=2000,volume=0.8"'
            },
            space_echo: {
                name: '🚀 Space Echo',
                command: '-filter:a "aecho=0.8:0.9:2000:0.5"'
            }
        };

        // Suno instrumental music styles
        this.instrumentalStyles = {
            chill_lofi: {
                name: '🌙 Chill Lofi',
                prompt: 'chill lofi hip hop instrumental, soft piano, gentle drums, relaxing atmosphere',
                style: 'lofi',
                mood: 'chill',
                tempo: 'slow'
            },
            ambient_electronic: {
                name: '🌌 Ambient Electronic',
                prompt: 'ambient electronic instrumental, atmospheric pads, subtle synthesizers, dreamy soundscape',
                style: 'ambient',
                mood: 'dreamy',
                tempo: 'slow'
            },
            acoustic_guitar: {
                name: '🎸 Acoustic Guitar',
                prompt: 'acoustic guitar instrumental, fingerpicking, warm and organic, peaceful melody',
                style: 'acoustic',
                mood: 'peaceful',
                tempo: 'medium'
            },
            jazz_instrumental: {
                name: '🎷 Jazz Instrumental',
                prompt: 'smooth jazz instrumental, saxophone, piano, sophisticated and melodic',
                style: 'jazz',
                mood: 'sophisticated',
                tempo: 'medium'
            },
            classical_piano: {
                name: '🎹 Classical Piano',
                prompt: 'classical piano instrumental, elegant melody, soft dynamics, contemplative',
                style: 'classical',
                mood: 'elegant',
                tempo: 'slow'
            },
            electronic_dance: {
                name: '🎧 Electronic Dance',
                prompt: 'electronic dance instrumental, upbeat synthesizers, driving rhythm, energetic',
                style: 'electronic',
                mood: 'energetic',
                tempo: 'fast'
            },
            cinematic_epic: {
                name: '🎬 Cinematic Epic',
                prompt: 'cinematic orchestral instrumental, epic strings, powerful brass, dramatic',
                style: 'cinematic',
                mood: 'dramatic',
                tempo: 'medium'
            },
            blues_instrumental: {
                name: '🎵 Blues Instrumental',
                prompt: 'blues guitar instrumental, soulful melody, warm tone, emotional',
                style: 'blues',
                mood: 'soulful',
                tempo: 'medium'
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
     * Get random instrumental style
     * @returns {Object} Random instrumental style configuration
     */
    getRandomInstrumentalStyle() {
        const styleKeys = Object.keys(this.instrumentalStyles);
        const randomKey = styleKeys[Math.floor(Math.random() * styleKeys.length)];
        return this.instrumentalStyles[randomKey];
    }

    /**
     * Generate Suno instrumental music
     * @param {number} duration - Duration in seconds
     * @param {Object} style - Instrumental style configuration
     * @returns {Promise<string>} Path to generated music file
     */
    async generateSunoInstrumental(duration, style) {
        try {
            console.log(`🎵 Generating Suno instrumental: ${style.name}`);
            
            // Generate music with Suno
            const musicResult = await musicService.generateInstrumentalMusic(style.prompt, {
                duration: Math.min(duration, 30), // Suno max duration
                style: style.style,
                mood: style.mood,
                tempo: style.tempo,
                model: 'V5'
            });

            if (musicResult.error || !musicResult.audioBuffer) {
                throw new Error(`Suno music generation failed: ${musicResult.error || 'No audio buffer'}`);
            }

            // Save to temporary file
            const fileName = `suno_instrumental_${uuidv4()}.mp3`;
            const filePath = path.join(this.tempDir, fileName);
            fs.writeFileSync(filePath, musicResult.audioBuffer);

            console.log(`✅ Suno instrumental generated: ${fileName}`);
            return filePath;

        } catch (err) {
            console.error('❌ Error generating Suno instrumental:', err);
            throw new Error(`Suno instrumental generation failed: ${err.message}`);
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
                const backgroundLowFileName = `bg_low_${uuidv4()}.mp3`;
                const outputFileName = `mixed_${uuidv4()}.mp3`;
                const voicePath = path.join(this.tempDir, voiceFileName);
                const backgroundLowPath = path.join(this.tempDir, backgroundLowFileName);
                const outputPath = path.join(this.tempDir, outputFileName);

                // Write voice buffer to temporary file
                fs.writeFileSync(voicePath, voiceBuffer);

                console.log(`🎵 Mixing voice with background music...`);

                // Step 1: Lower background music volume (increased from 0.3 to 0.6)
                const volumeCommand = [
                    'ffmpeg',
                    '-i', backgroundPath,
                    '-filter:a', 'volume=0.6',
                    '-c:a', 'libmp3lame',
                    '-b:a', '128k',
                    '-y',
                    backgroundLowPath
                ].join(' ');

                console.log(`🔊 Lowering background volume: ${volumeCommand}`);

                try {
                    await execAsync(volumeCommand);
                    
                    if (!fs.existsSync(backgroundLowPath)) {
                        throw new Error('Background volume adjustment failed');
                    }

                    // Step 2: Mix voice with lowered background
                    const mixCommand = [
                        'ffmpeg',
                        '-i', voicePath,
                        '-i', backgroundLowPath,
                        '-filter_complex',
                        '[0:a][1:a]amix=inputs=2:duration=first',
                        '-c:a', 'libmp3lame',
                        '-b:a', '128k',
                        '-y',
                        outputPath
                    ].join(' ');

                    console.log(`🎵 Mixing command: ${mixCommand}`);

                    await execAsync(mixCommand);
                    
                    if (!fs.existsSync(outputPath)) {
                        throw new Error('Mixed file was not created');
                    }

                    const mixedBuffer = fs.readFileSync(outputPath);
                    
                    // Clean up temporary files
                    this.cleanupFile(voicePath);
                    this.cleanupFile(backgroundLowPath);
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
                    this.cleanupFile(backgroundLowPath);
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

            // Always add background music
            console.log(`🎵 Adding background music...`);
            
            // Get audio duration (approximate)
            const duration = Math.max(3, Math.min(15, audioBuffer.length / 10000)); // Rough estimate
            
            // Choose background music type: 50% synthetic, 50% Suno
            const backgroundType = Math.random();
            let backgroundPath;
            let backgroundName;
            
            console.log(`🎲 Background type random: ${backgroundType.toFixed(3)} (${backgroundType < 0.5 ? 'Synthetic' : 'Suno'})`);
            
            if (backgroundType < 0.5) {
                // Synthetic background music (50%)
                const background = this.getRandomBackground();
                console.log(`🎲 Selected synthetic background: ${background.name}`);
                backgroundPath = await this.generateBackgroundMusic(duration, background.key);
                backgroundName = background.name;
            } else {
                // Suno instrumental music (50%)
                const instrumentalStyle = this.getRandomInstrumentalStyle();
                console.log(`🎲 Selected Suno instrumental: ${instrumentalStyle.name}`);
                
                try {
                    backgroundPath = await this.generateSunoInstrumental(duration, instrumentalStyle);
                    backgroundName = instrumentalStyle.name;
                    console.log(`✅ Suno instrumental path: ${backgroundPath}`);
                } catch (sunoError) {
                    console.warn(`⚠️ Suno instrumental failed, falling back to synthetic: ${sunoError.message}`);
                    // Fallback to synthetic background music
                    const background = this.getRandomBackground();
                    console.log(`🎲 Fallback to synthetic background: ${background.name}`);
                    backgroundPath = await this.generateBackgroundMusic(duration, background.key);
                    backgroundName = `${background.name} (fallback)`;
                }
            }

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
                    background: backgroundName,
                    description: `Applied ${effect.name} + ${backgroundName}`
                };
            }

            // Return just the effect result if mixing failed
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
