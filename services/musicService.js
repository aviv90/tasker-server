const { sanitizeText } = require('../utils/textSanitizer');
const { getApiUrl, getStaticFileUrl } = require('../utils/urlUtils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Test

class MusicService {
    constructor() {
        this.apiKey = process.env.KIE_API_KEY;
        this.baseUrl = 'https://api.kie.ai';
        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async generateMusicWithLyrics(prompt, options = {}) {
        try {
            console.log(`🎵 Starting Suno music generation with lyrics`);
            
            const cleanPrompt = sanitizeText(prompt);
            
            // Random style selection for variety
            const musicStyles = [
                'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop',
                'Country', 'Folk', 'R&B', 'Reggae', 'Blues', 'Indie',
                'Alternative', 'Soul', 'Funk', 'Dance', 'Acoustic', 'Lo-fi'
            ];
            
            const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)];
            
            // Generate title from prompt (first few words + creative suffix)
            const generateTitle = (prompt) => {
                const words = prompt.split(' ').slice(0, 4).join(' ');
                const suffixes = ['Song', 'Melody', 'Tune', 'Beat', 'Rhythm', 'Vibe', 'Sound'];
                const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
                return `${words} ${randomSuffix}`.substring(0, 80);
            };
            
            // Basic mode - compatible with existing API, enhanced with V5
            const musicOptions = {
                prompt: cleanPrompt,
                customMode: false, // Let Suno be creative
                instrumental: false, // We want lyrics
                model: options.model || 'V5', // Use V5 for latest and best quality
                callBackUrl: getApiUrl('/api/music/callback')
            };
            
            // Only add advanced parameters if they are explicitly provided
            if (options.style) musicOptions.style = options.style;
            if (options.title) musicOptions.title = options.title;
            if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
            if (options.duration) musicOptions.duration = options.duration;
            
            console.log(`🎼 Using automatic mode with prompt: "${cleanPrompt}"`);

            console.log(`🎼 Music options:`, JSON.stringify(musicOptions, null, 2));

            // Step 1: Submit music generation task
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/generate`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(musicOptions)
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error(`❌ Suno music generation task submission failed:`, generateData.msg);
                return { error: generateData.msg || 'Music generation task submission failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Suno music generation task submitted successfully. Task ID: ${taskId}`);

            console.log(`📞 Waiting for callback notification instead of polling...`);

            // Store task info for callback handling
            const taskInfo = {
                taskId: taskId,
                type: 'with-lyrics',
                musicOptions: musicOptions,
                timestamp: Date.now()
            };

            // Store in a simple in-memory map (in production, use Redis or database)
            if (!this.pendingTasks) {
                this.pendingTasks = new Map();
            }
            this.pendingTasks.set(taskId, taskInfo);

            // Return immediately - callback will handle completion
            return {
                taskId: taskId,
                status: 'pending',
                message: 'Music generation with lyrics started. Waiting for completion...'
            };

        } catch (err) {
            console.error(`❌ Suno music generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async generateInstrumentalMusic(prompt, options = {}) {
        try {
            console.log(`🎼 Starting Suno instrumental music generation`);
            
            const cleanPrompt = sanitizeText(prompt);
            
            // Random style selection for variety
            const musicStyles = [
                'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop',
                'Country', 'Folk', 'R&B', 'Reggae', 'Blues', 'Indie',
                'Alternative', 'Soul', 'Funk', 'Dance', 'Acoustic', 'Lo-fi'
            ];
            
            const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)];
            
            // Generate title from prompt (first few words + creative suffix)
            const generateTitle = (prompt) => {
                const words = prompt.split(' ').slice(0, 4).join(' ');
                const suffixes = ['Song', 'Melody', 'Tune', 'Beat', 'Rhythm', 'Vibe', 'Sound'];
                const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
                return `${words} ${randomSuffix}`.substring(0, 80);
            };
            
            // Basic instrumental mode - compatible with existing API, enhanced with V5
            const musicOptions = {
                prompt: cleanPrompt,
                customMode: false, // Let Suno be creative  
                instrumental: true, // No lyrics
                model: options.model || 'V5', // Use V5 for latest and best quality
                callBackUrl: getApiUrl('/api/music/callback')
            };
            
            // Only add advanced parameters if they are explicitly provided
            if (options.style) musicOptions.style = options.style;
            if (options.title) musicOptions.title = options.title;
            if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
            if (options.duration) musicOptions.duration = options.duration;

            console.log(`🎹 Using automatic instrumental mode with prompt: "${cleanPrompt}"`);
            console.log(`🎹 Instrumental music options:`, JSON.stringify(musicOptions, null, 2));

            // Use the same logic as generateMusicWithLyrics but with instrumental settings
            return await this._generateMusic(musicOptions, 'instrumental');

        } catch (err) {
            console.error(`❌ Suno instrumental music generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }

    // Helper method to avoid code duplication
    async _generateMusic(musicOptions, type = 'with-lyrics') {
        // Submit generation task
        const generateResponse = await fetch(`${this.baseUrl}/api/v1/generate`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(musicOptions)
        });

        const generateData = await generateResponse.json();
        
        if (!generateResponse.ok || generateData.code !== 200) {
            console.error(`❌ Suno ${type} music task submission failed:`, generateData.msg);
            return { error: generateData.msg || `${type} music generation task submission failed` };
        }

        const taskId = generateData.data.taskId;
        console.log(`✅ Suno ${type} music task submitted successfully. Task ID: ${taskId}`);

        console.log(`📞 Waiting for callback notification instead of polling...`);

        // Store task info for callback handling
        const taskInfo = {
            taskId: taskId,
            type: type,
            musicOptions: musicOptions,
            timestamp: Date.now()
        };

        // Store in a simple in-memory map (in production, use Redis or database)
        if (!this.pendingTasks) {
            this.pendingTasks = new Map();
        }
        this.pendingTasks.set(taskId, taskInfo);

        // Return immediately - callback will handle completion
        return {
            taskId: taskId,
            status: 'pending',
            message: `${type} music generation started. Waiting for completion...`
        };
    }

    // Method to handle callback completion
    async handleCallbackCompletion(taskId, callbackData) {
        try {
            const taskInfo = this.pendingTasks?.get(taskId);
            if (!taskInfo) {
                console.warn(`⚠️ No task info found for callback: ${taskId}`);
                return;
            }

            console.log(`🎵 Processing callback for ${taskInfo.type} music task: ${taskId}`);
            console.log(`📋 Callback data:`, JSON.stringify(callbackData, null, 2));

            if (callbackData.code === 200 && (callbackData.data?.callbackType === 'complete' || callbackData.data?.callbackType === 'text')) {
                const songs = callbackData.data.data || [];
                console.log(`🎵 Found ${songs.length} songs in callback`);
                
                if (songs.length > 0) {
                    const firstSong = songs[0];
                    console.log(`🎵 First song data:`, JSON.stringify(firstSong, null, 2));
                    const songUrl = firstSong.audioUrl || firstSong.audio_url || firstSong.url || firstSong.stream_audio_url || firstSong.source_stream_audio_url;
                    console.log(`🎵 Song URL: ${songUrl}`);
                    
                    if (songUrl) {
                        // Download and process the audio
                        const audioResponse = await fetch(songUrl);
                        if (!audioResponse.ok) {
                            throw new Error(`Failed to download audio: HTTP ${audioResponse.status}`);
                        }

                        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
                        
                        // Save to temp file
                        const tempFileName = `temp_music_${uuidv4()}.mp3`;
                        const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
                        const tmpDir = path.dirname(tempFilePath);

                        if (!fs.existsSync(tmpDir)) {
                            fs.mkdirSync(tmpDir, { recursive: true });
                        }

                        fs.writeFileSync(tempFilePath, audioBuffer);

                        // Verify file
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 10000) {
                            throw new Error('Audio file was not downloaded successfully');
                        }

                        console.log(`✅ Suno ${taskInfo.type} music generated successfully via callback`);
                        
                        const finalAudioBuffer = fs.readFileSync(tempFilePath);
                        const filename = path.basename(tempFilePath);
                        const publicPath = `/static/${filename}`;
                        
                        // Clean up task info
                        this.pendingTasks.delete(taskId);
                        
                        // Notify creativeAudioService if it's waiting for this callback
                        try {
                            const creativeAudioService = require('./creativeAudioService');
                            if (creativeAudioService.pendingCallbacks && creativeAudioService.pendingCallbacks.has(taskId)) {
                                const callback = creativeAudioService.pendingCallbacks.get(taskId);
                                creativeAudioService.pendingCallbacks.delete(taskId);
                                callback.resolve(finalAudioBuffer);
                            }
                        } catch (err) {
                            console.warn(`⚠️ Could not notify creativeAudioService: ${err.message}`);
                        }
                        
                        return {
                            text: taskInfo.musicOptions.prompt || taskInfo.musicOptions.title || `Generated ${taskInfo.type} music`,
                            audioBuffer: finalAudioBuffer,
                            result: publicPath,
                            metadata: {
                                title: firstSong.title,
                                duration: firstSong.duration,
                                tags: firstSong.tags,
                                model: firstSong.modelName,
                                type: taskInfo.type,
                                totalTracks: songs.length
                            }
                        };
                    }
                }
            } else {
                console.log(`⚠️ No songs found in callback or callback type not supported`);
                console.log(`📋 Callback code: ${callbackData.code}, type: ${callbackData.data?.callbackType}`);
            }

            // Clean up task info
            this.pendingTasks.delete(taskId);
            return { error: 'Callback processing failed' };

        } catch (error) {
            console.error(`❌ Error processing callback for task ${taskId}:`, error);
            this.pendingTasks?.delete(taskId);
            return { error: error.message || 'Callback processing failed' };
        }
    }

    async generateAdvancedMusic(prompt, options = {}) {
        try {
            console.log(`🎵 Starting Suno V5 advanced music generation`);
            
            const cleanPrompt = sanitizeText(prompt);
            
            // Enhanced music styles for V5
            const musicStyles = [
                'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop',
                'Country', 'Folk', 'R&B', 'Reggae', 'Blues', 'Indie',
                'Alternative', 'Soul', 'Funk', 'Dance', 'Acoustic', 'Lo-fi',
                'Ambient', 'Cinematic', 'World', 'Experimental', 'Synthwave', 'Chill'
            ];
            
            const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)];
            
            // Generate title from prompt
            const generateTitle = (prompt) => {
                const words = prompt.split(' ').slice(0, 4).join(' ');
                const suffixes = ['Song', 'Melody', 'Tune', 'Beat', 'Rhythm', 'Vibe', 'Sound'];
                const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
                return `${words} ${randomSuffix}`.substring(0, 80);
            };
            
            // Advanced V5 configuration with full control
            const musicOptions = {
                prompt: cleanPrompt,
                customMode: options.customMode || true, // Use custom mode for advanced control
                instrumental: options.instrumental || false,
                model: options.model || 'V5', // Always use V5 for advanced features
                callBackUrl: getApiUrl('/api/music/callback'),
                // V5 advanced parameters
                style: options.style || randomStyle,
                title: options.title || generateTitle(cleanPrompt),
                tags: options.tags || [randomStyle.toLowerCase()],
                duration: options.duration || 60, // V5 supports longer tracks
                genre: options.genre || randomStyle.toLowerCase(),
                mood: options.mood || 'upbeat',
                tempo: options.tempo || 'medium',
                // Advanced V5 features
                instruments: options.instruments || [],
                vocalStyle: options.vocalStyle || 'natural',
                language: options.language || 'english',
                key: options.key || 'C major',
                timeSignature: options.timeSignature || '4/4',
                // Quality settings for V5
                quality: options.quality || 'high',
                stereo: options.stereo !== false, // Default to stereo
                sampleRate: options.sampleRate || 44100
            };
            
            console.log(`🎼 Using advanced V5 mode with prompt: "${cleanPrompt}"`);
            console.log(`🎼 Advanced music options:`, JSON.stringify(musicOptions, null, 2));

            // Use the same generation logic but with advanced options
            return await this._generateMusic(musicOptions, 'advanced');

        } catch (err) {
            console.error(`❌ Suno V5 advanced music generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async generateSongFromSpeech(audioBuffer, options = {}) {
        try {
            console.log(`🎤 Starting Speech-to-Song generation with Add Instrumental API`);
            
            // Step 1: Upload audio file and get public URL
            const uploadResult = await this._uploadAudioFile(audioBuffer);
            if (uploadResult.error) {
                return { error: `Audio upload failed: ${uploadResult.error}` };
            }

            // Test if upload URL is accessible externally
            console.log(`🌐 Testing external accessibility: ${uploadResult.uploadUrl}`);
            try {
                const testResponse = await fetch(uploadResult.uploadUrl, { 
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; KieAI-Test/1.0)'
                    }
                });
                console.log(`🌐 External access test: ${testResponse.status} ${testResponse.statusText}`);
            } catch (testError) {
                console.error(`❌ Upload URL accessibility test failed:`, testError.message);
            }

            // Step 2: Try Upload-Extend API with speech-friendly parameters
            const extendOptions = {
                uploadUrl: uploadResult.uploadUrl,
                defaultParamFlag: false, // Use default parameters to preserve original audio better
                prompt: options.prompt || 'Add very gentle background music while keeping the original speech clear and audible',
                callBackUrl: uploadResult.callbackUrl
            };

            console.log(`🎼 Using Upload-Extend API with speech preservation:`, extendOptions);

            return await this._generateExtend(extendOptions);
        } catch (err) {
            console.error('❌ Speech-to-Song generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async _generateExtend(extendOptions) {
        try {
            console.log(`🎼 Submitting Upload-Extend request`);
            
            // Submit upload-extend task
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/generate/upload-extend`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(extendOptions)
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error('❌ Upload-Extend API error:', generateData);
                return { error: generateData.message || 'Upload-Extend request failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Upload-Extend task submitted: ${taskId}`);

            console.log(`📞 Waiting for callback notification instead of polling...`);

            // Store task info for callback handling
            const taskInfo = {
                taskId: taskId,
                type: 'upload-extend',
                extendOptions: extendOptions,
                timestamp: Date.now()
            };

            // Store in a simple in-memory map (in production, use Redis or database)
            if (!this.pendingTasks) {
                this.pendingTasks = new Map();
            }
            this.pendingTasks.set(taskId, taskInfo);

            // Return immediately - callback will handle completion
            return {
                taskId: taskId,
                status: 'pending',
                message: 'Upload-Extend generation started. Waiting for completion...'
            };
        } catch (err) {
            console.error('❌ Upload-Extend generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async _generateCover(coverOptions) {
        try {
            console.log(`🎼 Submitting Upload-Cover request`);
            
            // Submit upload-cover task
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/generate/upload-cover`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(coverOptions)
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error('❌ Upload-Cover API error:', generateData);
                return { error: generateData.message || 'Upload-Cover request failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Upload-Cover task submitted: ${taskId}`);

            console.log(`📞 Waiting for callback notification instead of polling...`);

            // Store task info for callback handling
            const taskInfo = {
                taskId: taskId,
                type: 'upload-cover',
                coverOptions: coverOptions,
                timestamp: Date.now()
            };

            // Store in a simple in-memory map (in production, use Redis or database)
            if (!this.pendingTasks) {
                this.pendingTasks = new Map();
            }
            this.pendingTasks.set(taskId, taskInfo);

            // Return immediately - callback will handle completion
            return {
                taskId: taskId,
                status: 'pending',
                message: 'Upload-Cover generation started. Waiting for completion...'
            };
        } catch (err) {
            console.error('❌ Upload-Cover generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async _uploadAudioFile(audioBuffer) {
        try {
            const filename = `speech_${uuidv4()}.mp3`; // Keep .mp3 extension for compatibility
            const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', filename);
            const outputDir = path.dirname(tempFilePath);
            
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // Save audio file temporarily
            fs.writeFileSync(tempFilePath, audioBuffer);
            
            // Verify file was written correctly
            const fileStats = fs.statSync(tempFilePath);
            console.log(`💾 Audio file saved: ${filename}, size: ${fileStats.size} bytes`);
            
            // Create public URL for the uploaded file
            const uploadUrl = getStaticFileUrl(filename);
            const callbackUrl = this._getCallbackUrl();
            
            console.log(`✅ Audio file uploaded: ${uploadUrl}`);
            
            return { uploadUrl, callbackUrl };
        } catch (error) {
            console.error('❌ Audio upload error:', error);
            return { error: error.message || 'Audio upload failed' };
        }
    }

    async _generateInstrumental(instrumentalOptions) {
        try {
            console.log(`🎼 Submitting Add Instrumental request`);
            
            // Submit add-instrumental task
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/generate/add-instrumental`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(instrumentalOptions)
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error('❌ Add Instrumental API error:', generateData);
                return { error: generateData.message || 'Add Instrumental request failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Add Instrumental task submitted: ${taskId}`);

            console.log(`📞 Waiting for callback notification instead of polling...`);

            // Store task info for callback handling
            const taskInfo = {
                taskId: taskId,
                type: 'add-instrumental',
                instrumentalOptions: instrumentalOptions,
                timestamp: Date.now()
            };

            // Store in a simple in-memory map (in production, use Redis or database)
            if (!this.pendingTasks) {
                this.pendingTasks = new Map();
            }
            this.pendingTasks.set(taskId, taskInfo);

            // Return immediately - callback will handle completion
            return {
                taskId: taskId,
                status: 'pending',
                message: 'Add Instrumental generation started. Waiting for completion...'
            };
        } catch (err) {
            console.error('❌ Add Instrumental generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    _getCallbackUrl() {
        return getApiUrl('/api/music/callback');
    }
}

// Create and export instance
const musicService = new MusicService();

module.exports = {
    generateMusicWithLyrics: musicService.generateMusicWithLyrics.bind(musicService),
    generateInstrumentalMusic: musicService.generateInstrumentalMusic.bind(musicService),
    generateAdvancedMusic: musicService.generateAdvancedMusic.bind(musicService),
    generateSongFromSpeech: musicService.generateSongFromSpeech.bind(musicService),
    handleCallbackCompletion: musicService.handleCallbackCompletion.bind(musicService)
};
