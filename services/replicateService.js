const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const { sanitizeText } = require('../utils/textSanitizer');
const { detectLanguage, enhancePromptForMusic } = require('../utils/textUtils');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

const MODELS = {
    TEXT_TO_VIDEO: "ali-vilab/i2vgen-xl:5821a338d00033abaaba89080a17eb8783d9a17ed710a6b4246a18e0900ccad4",
    IMAGE_TO_VIDEO: "wan-video/wan-2.2-i2v-a14b",
    VIDEO_TO_VIDEO: "runwayml/gen4-aleph",
    TEXT_TO_SONG_VOCALS: "minimax/music-01", // Best model for songs with lyrics and vocals
    TEXT_TO_SONG_BARK: "suno-ai/bark:b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787",
    TEXT_TO_MUSIC: "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb"
};

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting Replicate text-to-video generation');
        
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_VIDEO,
            input: {
                prompt: prompt,
                duration: 5,
                width: 608,
                height: 1080,
                guidance_scale: 7.5,
                num_inference_steps: 50
            }
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Text-to-video completed');
                    
                    let videoURL = result.output;
                    if (Array.isArray(result.output)) {
                        videoURL = result.output[0];
                    }
                    
                    return { 
                        text: prompt, 
                        result: videoURL,
                        cost: calculateCost(result)
                    };
                }
                
                if (result.status === 'failed' || result.status === 'canceled') {
                    const errorMsg = result.error || `Task ${result.status}`;
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
                    return { error: extractErrorDetails(pollError) };
                }
            }
        }
        
        return { error: 'Text-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Text-to-video generation error:', err.message);
        return { error: extractErrorDetails(err) };
    }
}

function calculateCost(prediction) {
    try {
        if (prediction.metrics?.predict_time) {
            const timeInSeconds = prediction.metrics.predict_time;
            return (timeInSeconds * 0.02).toFixed(4);
        }
        return null;
    } catch (err) {
        return null;
    }
}

function extractErrorDetails(error) {
    let errorMessage = error.message || error.toString();
    
    if (error.response?.data) {
        const errorDetails = {
            message: error.response.data.detail || error.message,
            status: error.response.status,
            statusText: error.response.statusText,
            type: error.response.data.type,
            title: error.response.data.title
        };
        
        const cleanDetails = Object.entries(errorDetails)
            .filter(([key, value]) => value !== undefined)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
            
        errorMessage = cleanDetails || errorMessage;
    }
    
    return errorMessage;
}

async function generateVideoFromImage(imageBuffer, prompt = null) {
    try {
        console.log('🎬 Starting Replicate image-to-video generation');
        
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        
        const input = {
            image: base64Image,
            duration: 5,
            fps: 24,
            resolution: "720p"
        };
        
        if (prompt) {
            input.prompt = prompt;
        }
        
        const prediction = await replicate.predictions.create({
            version: MODELS.IMAGE_TO_VIDEO,
            input: input
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Image-to-video completed');
                    
                    let videoURL = result.output;
                    if (Array.isArray(result.output)) {
                        videoURL = result.output[0];
                    }
                    
                    return { 
                        text: prompt || 'Image to video conversion', 
                        result: videoURL,
                        cost: calculateCost(result)
                    };
                }
                
                if (result.status === 'failed' || result.status === 'canceled') {
                    const errorMsg = result.error || `Task ${result.status}`;
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
                    return { error: extractErrorDetails(pollError) };
                }
            }
        }
        
        return { error: 'Image-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Image-to-video generation error:', err.message);
        return { error: extractErrorDetails(err) };
    }
}

async function generateVideoFromVideo(inputVideoBuffer, prompt) {
    try {
        console.log('🎬 Starting video-to-video generation');

        const tempDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
        fs.writeFileSync(tempVideoPath, inputVideoBuffer);

        const videoBase64 = fs.readFileSync(tempVideoPath).toString('base64');
        const videoDataUrl = `data:video/mp4;base64,${videoBase64}`;

        const input = {
            prompt: prompt,
            video: videoDataUrl,
            aspect_ratio: "16:9"
        };
        
        console.log('🔄 Calling Replicate API');
        const output = await replicate.run(MODELS.VIDEO_TO_VIDEO, { input });
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempVideoPath);
        } catch (cleanupError) {
            console.warn('Could not clean up temp file:', cleanupError.message);
        }
        
        if (!output) {
            throw new Error('No output received from Replicate');
        }
        
        // Handle ReadableStream response
        if (output && typeof output.getReader === 'function') {
            console.log('🔄 Converting ReadableStream to file');
            
            const reader = output.getReader();
            const chunks = [];
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
                
                const videoBuffer = Buffer.concat(chunks);
                const outputFilename = `video_${Date.now()}.mp4`;
                const outputDir = path.join(__dirname, '..', 'public', 'tmp');
                const outputPath = path.join(outputDir, outputFilename);
                
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }
                
                fs.writeFileSync(outputPath, videoBuffer);
                console.log('✅ Video-to-video completed');
                
                return { result: `/static/${outputFilename}` };
                
            } catch (streamError) {
                throw new Error(`Failed to read video stream: ${streamError.message}`);
            }
        } else {
            // Handle direct URL response
            let videoURL = output;
            if (Array.isArray(output)) {
                videoURL = output[0];
            } else if (typeof output === 'object' && output.video) {
                videoURL = output.video;
            } else if (typeof output === 'object' && output.output) {
                videoURL = output.output;
            }
            
            return { result: videoURL };
        }
    } catch (error) {
        console.error('❌ Video-to-video generation error:', error.message);
        throw error;
    }
}

async function generateSongWithText(prompt) {
    try {
        console.log('🎵 Starting song generation with minimax/music-01');
        
        // Sanitize and prepare prompt
        const cleanPrompt = sanitizeText(prompt);
        const language = detectLanguage(cleanPrompt);
        
        console.log(`🔍 Language: ${language}, Text: "${cleanPrompt}"`);
        
        // Prepare lyrics (max 400 characters for minimax)
        const lyrics = cleanPrompt.length > 400 ? cleanPrompt.substring(0, 400) : cleanPrompt;
        
        // Create prediction with minimax model
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_SONG_VOCALS,
            input: { lyrics }
        });

        if (!prediction?.id) {
            console.error('❌ No prediction ID from minimax');
            return await fallbackToAlternativeModel(cleanPrompt, language);
        }

        // Poll for completion
        console.log('🔄 Polling minimax for vocal song...');
        const result = await pollPrediction(prediction.id, 120);
        
        if (result.success) {
            console.log('✅ Vocal song completed successfully');
            return { 
                text: cleanPrompt, 
                result: result.output,
                provider: 'minimax-vocals',
                language: language
            };
        } else {
            console.log('� Minimax failed, trying fallback...');
            return await fallbackToAlternativeModel(cleanPrompt, language);
        }

    } catch (err) {
        console.error('❌ Song generation error:', err.message);
        return await fallbackToAlternativeModel(prompt);
    }
}

async function fallbackToAlternativeModel(prompt, language = null) {
    try {
        if (!language) language = detectLanguage(prompt);
        
        // For Hebrew, use MusicGen with vocal-style prompts
        if (language === 'hebrew') {
            console.log('🎵 Hebrew fallback: MusicGen vocal-style');
            return await generateVocalInstrumentalWithText(prompt);
        }
        
        // For other languages, try Bark
        console.log('🎤 Fallback: Bark model');
        const musicPrompt = enhancePromptForMusic(prompt);
        const enhancedPrompt = createEnhancedMusicPrompt(musicPrompt);
        const speaker = getRandomSpeaker(language);
        
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_SONG_BARK,
            input: {
                prompt: enhancedPrompt,
                text_temp: 0.7,
                waveform_temp: 0.7,
                history_prompt: speaker
            }
        });

        if (!prediction?.id) {
            return await generateInstrumentalWithText(prompt);
        }

        const result = await pollPrediction(prediction.id, 120);
        
        if (result.success) {
            return { 
                text: prompt, 
                result: result.output,
                provider: 'replicate-bark'
            };
        } else {
            return await generateInstrumentalWithText(prompt);
        }

    } catch (err) {
        console.error('❌ Fallback failed:', err.message);
        return { error: `Song generation failed: ${err.message}` };
    }
}

async function pollPrediction(predictionId, maxAttempts = 60) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        try {
            const result = await replicate.predictions.get(predictionId);
            
            if (attempt % 10 === 0) {
                console.log(`🔄 Polling: ${attempt}/${maxAttempts}, Status: ${result.status}`);
            }
            
            if (result.status === 'succeeded' && result.output) {
                return { success: true, output: result.output };
            }
            
            if (result.status === 'failed') {
                console.error('❌ Prediction failed:', result.error);
                return { success: false, error: result.error };
            }
            
        } catch (pollError) {
            if (pollError.response?.status >= 400 && pollError.response?.status < 500) {
                console.error('❌ Client error during polling:', extractErrorDetails(pollError));
                return { success: false, error: extractErrorDetails(pollError) };
            }
        }
    }
    
    console.log('⏰ Prediction timed out');
    return { success: false, error: 'Generation timed out' };
}

async function generateVocalInstrumentalWithText(prompt) {
    try {
        console.log('🎤 MusicGen with vocal-style prompts');
        
        const musicPrompt = enhancePromptForMusic(prompt);
        const vocalPrompt = createVocalInstrumentalPrompt(musicPrompt);
        
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_MUSIC,
            input: {
                prompt: vocalPrompt,
                model_version: "stereo-large",
                output_format: "mp3",
                normalization_strategy: "peak",
                duration: 30
            }
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID from MusicGen' };
        }

        const result = await pollPrediction(prediction.id, 60);
        
        if (result.success) {
            return { 
                text: prompt, 
                result: result.output,
                provider: 'musicgen-vocal-style'
            };
        } else {
            return { error: result.error || 'Vocal instrumental generation failed' };
        }

    } catch (error) {
        console.error('❌ MusicGen error:', error.message);
        return { error: `Vocal instrumental failed: ${error.message}` };
    }
}

function createVocalInstrumentalPrompt(prompt) {
    // Create prompts that simulate vocal elements through instrumental means
    const vocalStyles = [
        "melodic pop with vocal-like synthesizer lead",
        "acoustic guitar with humming melody, folk style",
        "piano ballad with string melody representing vocals",
        "indie folk with acoustic guitar melody, vocal-style phrasing",
        "contemporary pop instrumental with melodic lead synth",
        "acoustic folk with guitar fingerpicking, vocal melody on strings"
    ];
    
    const randomVocalStyle = vocalStyles[Math.floor(Math.random() * vocalStyles.length)];
    return `${randomVocalStyle}, inspired by: ${prompt}`;
}

async function generateInstrumentalWithText(prompt) {
    try {
        console.log('🎼 MusicGen instrumental generation');
        
        const cleanPrompt = sanitizeText(prompt);
        const musicPrompt = enhancePromptForMusic(cleanPrompt);
        const instrumentalPrompt = createInstrumentalPrompt(musicPrompt);
        
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_MUSIC,
            input: {
                prompt: instrumentalPrompt,
                model_version: "stereo-large",
                output_format: "mp3",
                normalization_strategy: "peak",
                duration: 30
            }
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID from MusicGen' };
        }

        const result = await pollPrediction(prediction.id, 60);
        
        if (result.success) {
            return { 
                text: cleanPrompt, 
                result: result.output,
                provider: 'musicgen-instrumental'
            };
        } else {
            return { error: result.error || 'Instrumental generation failed' };
        }

    } catch (error) {
        console.error('❌ MusicGen instrumental error:', error.message);
        return { error: `Instrumental generation failed: ${error.message}` };
    }
}

function createEnhancedMusicPrompt(prompt) {
    // Check if this is Hebrew content
    const isHebrew = /[\u0590-\u05FF]/.test(prompt);
    
    // Random music styles for variety
    const styles = [
        "acoustic guitar, soft vocals, melodic",
        "pop ballad, emotional singing, heartfelt", 
        "folk style, storytelling vocals, warm",
        "indie rock, melodic voice, uplifting",
        "contemporary, smooth vocals, gentle",
        "acoustic folk, heartfelt singing, intimate"
    ];
    
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    
    if (isHebrew) {
        // For Hebrew content, focus on the English translation and add style
        // The prompt should already be enhanced by enhancePromptForMusic
        return `[${randomStyle}] ${prompt}`;
    } else {
        // For English content, create a simple, clear prompt
        return `[${randomStyle}] ${prompt}`;
    }
}

function createInstrumentalPrompt(prompt) {
    const instruments = [
        "acoustic guitar and piano, melodic",
        "soft piano melody, emotional", 
        "guitar and strings, uplifting",
        "ambient acoustic, peaceful",
        "gentle instrumental, warm",
        "melodic guitar, contemporary"
    ];
    
    const randomInstrument = instruments[Math.floor(Math.random() * instruments.length)];
    return `${randomInstrument}, inspired by: ${prompt}`;
}

function getRandomSpeaker(language = 'english') {
    // Choose speaker based on detected language
    const speakersByLanguage = {
        english: [
            "en_speaker_0", "en_speaker_1", "en_speaker_2", "en_speaker_3", 
            "en_speaker_4", "en_speaker_5", "en_speaker_6", "en_speaker_7",
            "en_speaker_8", "en_speaker_9"
        ],
        hebrew: [
            // Hebrew not directly supported, use multilingual speakers
            "en_speaker_0", "en_speaker_1", "en_speaker_2", // Clear English speakers
            "es_speaker_0", "es_speaker_1", // Spanish can handle some Semitic sounds
            "fr_speaker_0", "fr_speaker_1"  // French for different accent
        ],
        mixed: [
            "en_speaker_0", "en_speaker_1", "en_speaker_2", 
            "es_speaker_0", "es_speaker_1", "es_speaker_2",
            "fr_speaker_0", "fr_speaker_1", "fr_speaker_2",
            "it_speaker_0", "it_speaker_1", "it_speaker_2"
        ]
    };
    
    const speakers = speakersByLanguage[language] || speakersByLanguage.mixed;
    return speakers[Math.floor(Math.random() * speakers.length)];
}

module.exports = { 
    generateVideoWithText, 
    generateVideoFromImage, 
    generateVideoFromVideo,
    generateSongWithText
};
