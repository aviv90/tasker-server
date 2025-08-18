const Replicate = require('replicate');
const { sanitizeText } = require('../utils/textSanitizer');
const { detectLanguage, enhancePromptForMusic } = require('../utils/textUtils');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

const MODELS = {
    TEXT_TO_SONG_BARK: "suno-ai/bark:b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787",
    TEXT_TO_MUSIC: "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb"
};

async function generateSongWithText(prompt) {
    try {
        console.log('🎵 Starting song generation with Replicate');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect language for better speaker selection
        const language = detectLanguage(cleanPrompt);
        
        // Enhance prompt for music (handle Hebrew translation if needed)
        const musicPrompt = enhancePromptForMusic(cleanPrompt);
        
        console.log(`🔍 Detected language: ${language}`);
        console.log(`📝 Original: "${cleanPrompt}" -> Music: "${musicPrompt}"`);
        
        // For Hebrew content, go directly to MusicGen with vocal styling
        if (language === 'hebrew') {
            console.log('🎵 Hebrew detected - using MusicGen with vocal styling');
            return await generateVocalInstrumentalWithText(cleanPrompt, musicPrompt);
        }
        
        // For English content, try Bark first
        const enhancedPrompt = createEnhancedMusicPrompt(musicPrompt);
        const randomSpeaker = getRandomSpeaker(language);
        
        console.log(`🎼 Enhanced prompt: ${enhancedPrompt}`);
        console.log(`🎤 Using speaker: ${randomSpeaker}`);
        
        // Use Suno Bark model for vocals + music
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_SONG_BARK,
            input: {
                prompt: enhancedPrompt,
                text_temp: 0.7,
                waveform_temp: 0.7,
                history_prompt: randomSpeaker
            }
        });

        if (!prediction?.id) {
            console.error('❌ No prediction ID received from Replicate for song');
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for song completion...');
        
        const maxAttempts = 120;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts}/${maxAttempts}, Status: ${result.status}`);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Song generation completed successfully');
                    
                    return { 
                        text: cleanPrompt, 
                        result: result.output,
                        provider: 'replicate-bark'
                    };
                } else if (result.status === 'failed') {
                    console.error('❌ Song generation failed:', result.error);
                    return await generateInstrumentalWithText(cleanPrompt);
                }
            } catch (pollError) {
                console.error(`❌ Error polling prediction ${prediction.id}:`, pollError.message);
                if (attempts >= maxAttempts) {
                    throw pollError;
                }
            }
        }

        console.log('⏰ Song generation timed out, trying fallback...');
        return await generateInstrumentalWithText(cleanPrompt);

    } catch (err) {
        console.error('❌ Replicate song generation error:', err.message);
        
        try {
            console.log('🔄 Trying fallback with MusicGen...');
            return await generateInstrumentalWithText(prompt);
        } catch (fallbackErr) {
            console.error('❌ Fallback also failed:', fallbackErr.message);
            return { error: `Song generation failed: ${err.message}` };
        }
    }
}

async function generateVocalInstrumentalWithText(originalPrompt, musicPrompt) {
    try {
        console.log('🎤 Starting vocal-style instrumental generation with MusicGen');
        
        const vocalPrompt = createVocalInstrumentalPrompt(musicPrompt);
        console.log(`🎵 Vocal instrumental prompt: ${vocalPrompt}`);
        
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
            console.error('❌ No prediction ID received for vocal instrumental');
            return { error: 'No prediction ID received from MusicGen' };
        }

        console.log('🔄 Polling for vocal instrumental completion...');
        
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts}/${maxAttempts}, Status: ${result.status}`);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Vocal instrumental generation completed');
                    
                    return { 
                        text: originalPrompt, 
                        result: result.output,
                        provider: 'replicate-musicgen-vocal'
                    };
                } else if (result.status === 'failed') {
                    console.error('❌ Vocal instrumental generation failed:', result.error);
                    return { error: result.error || 'Vocal instrumental generation failed' };
                }
            } catch (pollError) {
                console.error(`❌ Error polling vocal instrumental prediction ${prediction.id}:`, pollError.message);
                if (attempts >= maxAttempts) {
                    throw pollError;
                }
            }
        }

        return { error: 'Vocal instrumental generation timed out' };

    } catch (error) {
        console.error('❌ MusicGen vocal instrumental generation error:', error);
        // Return the full error object as-is
        return { error: error };
    }
}

async function generateInstrumentalWithText(prompt) {
    try {
        console.log('🎼 Starting instrumental generation with MusicGen');
        
        const cleanPrompt = sanitizeText(prompt);
        const musicPrompt = enhancePromptForMusic(cleanPrompt);
        const instrumentalPrompt = createInstrumentalPrompt(musicPrompt);
        
        console.log(`🎵 Instrumental prompt: ${instrumentalPrompt}`);
        
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
            console.error('❌ No prediction ID received for instrumental');
            return { error: 'No prediction ID received from MusicGen' };
        }

        console.log('🔄 Polling for instrumental completion...');
        
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts}/${maxAttempts}, Status: ${result.status}`);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Instrumental generation completed');
                    
                    return { 
                        text: cleanPrompt, 
                        result: result.output,
                        provider: 'replicate-musicgen'
                    };
                } else if (result.status === 'failed') {
                    console.error('❌ Instrumental generation failed:', result.error);
                    return { error: result.error || 'Instrumental generation failed' };
                }
            } catch (pollError) {
                console.error(`❌ Error polling instrumental prediction ${prediction.id}:`, pollError.message);
                if (attempts >= maxAttempts) {
                    throw pollError;
                }
            }
        }

        return { error: 'Instrumental generation timed out' };

    } catch (error) {
        console.error('❌ MusicGen instrumental generation error:', error);
        // Return the full error object as-is
        return { error: error };
    }
}

function createEnhancedMusicPrompt(prompt) {
    const styles = [
        "acoustic guitar, soft vocals, melodic",
        "pop ballad, emotional singing, heartfelt", 
        "folk style, storytelling vocals, warm",
        "indie rock, melodic voice, uplifting",
        "contemporary, smooth vocals, gentle",
        "acoustic folk, heartfelt singing, intimate"
    ];
    
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    return `[${randomStyle}] ${prompt}`;
}

function createVocalInstrumentalPrompt(prompt) {
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
    const speakersByLanguage = {
        english: [
            "en_speaker_0", "en_speaker_1", "en_speaker_2", "en_speaker_3", 
            "en_speaker_4", "en_speaker_5", "en_speaker_6", "en_speaker_7",
            "en_speaker_8", "en_speaker_9"
        ],
        hebrew: [
            // Hebrew not directly supported, use multilingual speakers
            "en_speaker_0", "en_speaker_1", "en_speaker_2",
            "es_speaker_0", "es_speaker_1",
            "fr_speaker_0", "fr_speaker_1"
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
    generateSongWithText
};
