const { sanitizeText } = require('../utils/textSanitizer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
            
            // Simple mode - let Suno handle everything automatically
            const musicOptions = {
                prompt: cleanPrompt,
                customMode: false, // Let Suno be creative
                instrumental: false, // We want lyrics
                model: options.model || 'V4_5', // Use V4.5 for better quality
                callBackUrl: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/music/callback`
            };
            
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

            // Step 2: Poll for completion
            console.log('⏳ Polling for music generation completion...');
            const maxWaitTime = 20 * 60 * 1000; // 20 minutes (music takes longer)
            const startTime = Date.now();
            let pollAttempts = 0;

            while (Date.now() - startTime < maxWaitTime) {
                pollAttempts++;
                console.log(`🔄 Polling attempt ${pollAttempts} for Suno music task ${taskId}`);

                const statusResponse = await fetch(`${this.baseUrl}/api/v1/generate/record-info?taskId=${taskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${this.apiKey}` }
                });

                const statusData = await statusResponse.json();

                if (!statusResponse.ok || statusData.code !== 200) {
                    console.error(`❌ Suno music status check failed:`, statusData.msg);
                    return { error: statusData.msg || 'Music status check failed' };
                }

                const status = statusData.data;
                console.log(`📊 Suno music status check - status: ${status.status}`);

                if (status.status === 'SUCCESS') {
                    // Success - music is ready
                    if (!status.response || !status.response.sunoData || status.response.sunoData.length === 0) {
                        console.error(`❌ Suno music generation completed but no tracks returned`);
                        return { error: 'Music generation completed but no tracks returned' };
                    }

                    const tracks = status.response.sunoData;
                    console.log(`✅ Suno music generation completed! Found ${tracks.length} tracks. Downloading first track...`);

                    // Take the first track (Suno usually generates 2 variations)
                    const firstTrack = tracks[0];
                    const audioUrl = firstTrack.audioUrl;

                    if (!audioUrl) {
                        console.error(`❌ No audio URL found in Suno response`);
                        return { error: 'No audio URL found in generated tracks' };
                    }

                    // Step 3: Download the audio file
                    const tempFileName = `temp_music_${uuidv4()}.mp3`;
                    const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
                    const tmpDir = path.dirname(tempFilePath);

                    if (!fs.existsSync(tmpDir)) {
                        fs.mkdirSync(tmpDir, { recursive: true });
                    }

                    try {
                        const audioResponse = await fetch(audioUrl);
                        if (!audioResponse.ok) {
                            throw new Error(`Failed to download audio: HTTP ${audioResponse.status}`);
                        }

                        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
                        fs.writeFileSync(tempFilePath, audioBuffer);

                        // Verify file was written correctly
                        let retries = 0;
                        let fileReady = false;

                        while (!fileReady && retries < 15) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            
                            if (fs.existsSync(tempFilePath)) {
                                try {
                                    const stats = fs.statSync(tempFilePath);
                                    
                                    if (stats.size > 0) {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        const newStats = fs.statSync(tempFilePath);
                                        
                                        if (newStats.size === stats.size && stats.size > 10000) { // At least 10KB
                                            fileReady = true;
                                            break;
                                        }
                                    }
                                } catch (statError) {
                                    // Continue retrying
                                }
                            }
                            retries++;
                        }

                        if (!fileReady) {
                            console.error('❌ Audio file was not properly downloaded');
                            return { error: 'Audio file was not downloaded successfully' };
                        }

                        console.log(`✅ Suno music generated successfully. Duration: ${firstTrack.duration}s`);
                        
                        const finalAudioBuffer2 = fs.readFileSync(tempFilePath);
                        const filename = path.basename(tempFilePath);
                        const publicPath = `/static/${filename}`;
                        
                        // Return comprehensive music data
                        return {
                            text: cleanPrompt,
                            audioBuffer: finalAudioBuffer2,
                            result: publicPath, // This will be processed to create full URL
                            metadata: {
                                title: firstTrack.title || options.title || 'Generated Music',
                                duration: firstTrack.duration,
                                tags: firstTrack.tags,
                                model: firstTrack.modelName,
                                prompt: firstTrack.prompt || cleanPrompt,
                                totalTracks: tracks.length,
                                imageUrl: firstTrack.imageUrl // Cover art if available
                            }
                        };

                    } catch (downloadError) {
                        console.error(`❌ Suno music download failed:`, downloadError);
                        return { error: `Music download failed: ${downloadError.message}` };
                    }

                } else if (status.status === 'CREATE_TASK_FAILED' || 
                          status.status === 'GENERATE_AUDIO_FAILED' || 
                          status.status === 'SENSITIVE_WORD_ERROR') {
                    // Failed
                    console.error(`❌ Suno music generation failed with status: ${status.status}`);
                    const errorMsg = status.errorMessage || `Music generation failed: ${status.status}`;
                    return { error: errorMsg };
                }

                // Still processing (PENDING, TEXT_SUCCESS, FIRST_SUCCESS), wait and retry
                console.log(`🎼 Music generation in progress: ${status.status}`);
                await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
            }

            // Timeout
            console.error(`❌ Suno music generation timed out after 20 minutes`);
            return { error: 'Music generation timed out after 20 minutes' };

        } catch (err) {
            console.error(`❌ Suno music generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async generateInstrumentalMusic(prompt, options = {}) {
        try {
            console.log(`🎼 Starting Suno instrumental music generation`);
            
            const cleanPrompt = sanitizeText(prompt);
            
            // Simple instrumental mode - let Suno handle everything automatically
            const musicOptions = {
                prompt: cleanPrompt,
                customMode: false, // Let Suno be creative  
                instrumental: true, // No lyrics
                model: options.model || 'V4_5',
                callBackUrl: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/music/callback`
            };

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

        // Poll for completion
        const maxWaitTime = 20 * 60 * 1000; // 20 minutes
        const startTime = Date.now();
        let pollAttempts = 0;

        while (Date.now() - startTime < maxWaitTime) {
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Suno ${type} music task ${taskId}`);

            const statusResponse = await fetch(`${this.baseUrl}/api/v1/generate/record-info?taskId=${taskId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            const statusData = await statusResponse.json();

            if (!statusResponse.ok || statusData.code !== 200) {
                console.error(`❌ Suno ${type} music status check failed:`, statusData.msg);
                return { error: statusData.msg || `${type} music status check failed` };
            }

            const status = statusData.data;
            console.log(`📊 Suno ${type} music status: ${status.status}`);

            if (status.status === 'SUCCESS') {
                // Success - process and download
                if (!status.response?.sunoData?.length) {
                    return { error: `${type} music generation completed but no tracks returned` };
                }

                const firstTrack = status.response.sunoData[0];
                if (!firstTrack.audioUrl) {
                    return { error: 'No audio URL found in generated tracks' };
                }

                // Download audio
                const tempFileName = `temp_music_${uuidv4()}.mp3`;
                const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
                const tmpDir = path.dirname(tempFilePath);

                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }

                const audioResponse = await fetch(firstTrack.audioUrl);
                if (!audioResponse.ok) {
                    throw new Error(`Failed to download audio: HTTP ${audioResponse.status}`);
                }

                const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
                fs.writeFileSync(tempFilePath, audioBuffer);

                // Verify file
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 10000) {
                    return { error: 'Audio file was not downloaded successfully' };
                }

                console.log(`✅ Suno ${type} music generated successfully`);
                
                const finalAudioBuffer = fs.readFileSync(tempFilePath);
                const filename = path.basename(tempFilePath);
                const publicPath = `/static/${filename}`;
                
                return {
                    text: musicOptions.prompt || musicOptions.title || `Generated ${type} music`,
                    audioBuffer: finalAudioBuffer,
                    result: publicPath, // This will be processed to create full URL
                    metadata: {
                        title: firstTrack.title,
                        duration: firstTrack.duration,
                        tags: firstTrack.tags,
                        model: firstTrack.modelName,
                        type: type,
                        totalTracks: status.response.sunoData.length
                    }
                };

            } else if (['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR'].includes(status.status)) {
                return { error: status.errorMessage || `Music generation failed: ${status.status}` };
            }

            // Still processing
            await new Promise(resolve => setTimeout(resolve, 30000));
        }

        return { error: `${type} music generation timed out after 20 minutes` };
    }

    async generateSongFromSpeech(audioBuffer, options = {}) {
        try {
            console.log(`🎤 Starting Speech-to-Song generation with Add Instrumental`);
            
            // Step 1: Upload audio file and get public URL
            const uploadResult = await this._uploadAudioFile(audioBuffer);
            if (uploadResult.error) {
                return { error: `Audio upload failed: ${uploadResult.error}` };
            }

            // Step 2: Generate song with maximum voice preservation
            const styles = [
                'voice preservation, minimal instrumental',
                'original voice, subtle backing', 
                'clear speech, light accompaniment',
                'voice-first, background music',
                'natural speech melody, soft instruments',
                'unmodified vocals, gentle support',
                'speech clarity, atmospheric backing',
                'original voice character, minimal processing'
            ];

            const negativeStyles = [
                'heavy autotune, voice modification',
                'pitch correction, vocal effects', 
                'voice transformation, heavy processing',
                'artificial vocals, distorted speech',
                'melody override, voice replacement',
                'synthetic vocals, robotic processing'
            ];

            const selectedStyle = styles[Math.floor(Math.random() * styles.length)];
            const selectedNegative = negativeStyles[Math.floor(Math.random() * negativeStyles.length)];
            
            // Create add-instrumental request (maximum voice preservation)
            const instrumentalOptions = {
                uploadUrl: uploadResult.uploadUrl,
                title: options.title || 'Generated Song from Speech',
                tags: options.style || selectedStyle,
                negativeTags: options.negativeStyle || selectedNegative,
                callBackUrl: uploadResult.callbackUrl,
                vocalGender: options.vocalGender || (Math.random() > 0.5 ? 'm' : 'f'),
                styleWeight: options.styleWeight || 0.1, // Minimal style influence - keep original voice
                audioWeight: options.audioWeight || 1.0, // Maximum audio weight - preserve original voice completely
                weirdnessConstraint: options.weirdnessConstraint || 0.1 // Minimal weirdness - keep speech natural
            };

            return await this._generateInstrumental(instrumentalOptions);
        } catch (err) {
            console.error('❌ Speech-to-Song generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async _uploadAudioFile(audioBuffer) {
        try {
            const filename = `speech_${uuidv4()}.mp3`;
            const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', filename);
            const outputDir = path.dirname(tempFilePath);
            
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // Save audio file temporarily with proper headers
            fs.writeFileSync(tempFilePath, audioBuffer);
            
            // Verify file was written correctly
            const fileStats = fs.statSync(tempFilePath);
            console.log(`💾 Audio file saved: ${filename}, size: ${fileStats.size} bytes`);
            
            // Test if the file is a valid audio file by reading first few bytes
            const buffer = fs.readFileSync(tempFilePath);
            const header = buffer.toString('hex', 0, 4);
            console.log(`🔍 File header (first 4 bytes): ${header}`);
            
            // MP3 files should start with ID3 tag (494433) or MPEG frame sync (FFFB/FFF3/etc)
            if (!header.startsWith('4944') && !header.startsWith('fff')) {
                console.log(`⚠️ Warning: File may not be a valid MP3. Header: ${header}`);
            }
            
            // Create public URL for the uploaded file
            let baseUrl = process.env.BASE_URL;
            
            // Debug environment variables
            console.log('🔍 Environment debug:');
            console.log('  BASE_URL:', process.env.BASE_URL);
            console.log('  HEROKU_APP_NAME:', process.env.HEROKU_APP_NAME);
            console.log('  PORT:', process.env.PORT);
            
            // Auto-detect based on environment
            if (!baseUrl) {
                if (process.env.HEROKU_APP_NAME) {
                    baseUrl = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
                    console.log('🟢 Detected Heroku environment');
                } else if (process.env.PORT && process.env.PORT !== '3000') {
                    // Likely Heroku without HEROKU_APP_NAME - construct from request
                    baseUrl = `https://tasker-server-eb22b09c778f.herokuapp.com`; // Temporary hardcode
                    console.log('🟡 Detected Heroku-like environment (using hardcoded URL)');
                } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
                    baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
                    console.log('🟢 Detected Railway environment');
                } else if (process.env.VERCEL_URL) {
                    baseUrl = `https://${process.env.VERCEL_URL}`;
                    console.log('🟢 Detected Vercel environment');
                } else {
                    baseUrl = 'http://localhost:3000';
                    console.warn('⚠️  Using localhost - this will not work with external APIs!');
                }
            }
            
            const uploadUrl = `${baseUrl}/static/${filename}`;
            const callbackUrl = this._getCallbackUrl();
            
            console.log(`✅ Audio file uploaded successfully: ${uploadUrl}`);
            console.log(`📞 Callback URL: ${callbackUrl}`);
            
            // Test if file is accessible (optional debug)
            try {
                const testResponse = await fetch(uploadUrl, { method: 'HEAD' });
                console.log(`🌐 File accessibility test: ${testResponse.status} ${testResponse.statusText}`);
            } catch (testError) {
                console.warn(`⚠️  File accessibility test failed: ${testError.message}`);
            }
            
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

            // Poll for completion
            const maxWaitTime = 20 * 60 * 1000; // 20 minutes
            const startTime = Date.now();
            let pollAttempts = 0;

            while (Date.now() - startTime < maxWaitTime) {
                pollAttempts++;
                console.log(`🔄 Polling attempt ${pollAttempts} for task ${taskId}`);

                const statusResponse = await fetch(`${this.baseUrl}/api/v1/generate/record-info?taskId=${taskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${this.apiKey}` }
                });

                const statusData = await statusResponse.json();

                if (!statusResponse.ok || statusData.code !== 200) {
                    console.error('❌ Status check error:', statusData);
                    return { error: `Status check failed: ${statusData.message || 'Unknown error'}` };
                }

                const status = statusData.data;
                console.log(`📊 Add Instrumental status: ${status.status}`);
                
                if (status.status === 'SUCCESS') {
                    console.log(`🎉 Add Instrumental completed successfully!`);
                    
                    // Extract songs from the response
                    let songs = [];
                    if (status.response && status.response.sunoData) {
                        songs = status.response.sunoData.map(result => ({
                            id: result.id,
                            title: result.title,
                            audioUrl: result.audioUrl,
                            sourceAudioUrl: result.sourceAudioUrl,
                            imageUrl: result.imageUrl,
                            tags: result.tags,
                            duration: result.duration,
                            createdAt: result.createTime
                        }));
                    }
                    
                    return {
                        taskId: taskId,
                        status: 'completed',
                        songs: songs
                    };

                } else if (['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR'].includes(status.status)) {
                    console.error(`❌ Add Instrumental failed: ${status.status}`);
                    return { error: status.errorMessage || `Add Instrumental generation failed: ${status.status}` };
                }

                // Still processing
                await new Promise(resolve => setTimeout(resolve, 30000));
            }

            return { error: `Add Instrumental generation timed out after 20 minutes` };
        } catch (err) {
            console.error('❌ Add Instrumental generation error:', err);
            return { error: err.message || 'Unknown error' };
        }
    }

    _getCallbackUrl() {
        let baseUrl = process.env.BASE_URL;
        
        // Auto-detect the base URL based on environment
        if (!baseUrl) {
            if (process.env.HEROKU_APP_NAME) {
                baseUrl = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
            } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
                baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
            } else if (process.env.VERCEL_URL) {
                baseUrl = `https://${process.env.VERCEL_URL}`;
            } else {
                baseUrl = 'http://localhost:3000';
                console.warn('⚠️  No BASE_URL configured. Using localhost for callbacks - this may not work with external APIs!');
            }
        }
        
        return `${baseUrl}/api/music/callback`;
    }
}

// Create and export instance
const musicService = new MusicService();

module.exports = {
    generateMusicWithLyrics: musicService.generateMusicWithLyrics.bind(musicService),
    generateInstrumentalMusic: musicService.generateInstrumentalMusic.bind(musicService),
    generateSongFromSpeech: musicService.generateSongFromSpeech.bind(musicService)
};
