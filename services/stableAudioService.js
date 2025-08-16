// Temporarily commented out until we fix the loading issue
// const { default: StabilityAI } = require('stability-ai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize Stability AI client - temporarily disabled
let stability = null;
console.log('⚠️ Stability AI temporarily disabled for debugging');

/**
 * Available remix styles for Stable Audio
 */
const REMIX_STYLES = [
    { key: 'ambient', name: 'Ambient', description: 'atmospheric ambient music with ethereal sounds' },
    { key: 'electronic', name: 'Electronic', description: 'electronic music with synthesizers and digital effects' },
    { key: 'cinematic', name: 'Cinematic', description: 'cinematic orchestral music with dramatic elements' },
    { key: 'jazz', name: 'Jazz', description: 'smooth jazz with piano and saxophone' },
    { key: 'classical', name: 'Classical', description: 'classical orchestral arrangement' },
    { key: 'lofi', name: 'Lo-Fi', description: 'lo-fi hip hop with mellow beats and vinyl texture' },
    { key: 'rock', name: 'Rock', description: 'rock music with electric guitars' },
    { key: 'folk', name: 'Folk', description: 'acoustic folk music with natural instruments' },
    { key: 'blues', name: 'Blues', description: 'blues music with guitar and harmonica' },
    { key: 'hip-hop', name: 'Hip Hop', description: 'hip hop beat with heavy bass and drums' }
];

/**
 * Get random style
 */
function getRandomStyle() {
    const randomIndex = Math.floor(Math.random() * REMIX_STYLES.length);
    const style = REMIX_STYLES[randomIndex];
    return {
        ...style,
        isRandom: true
    };
}

/**
 * Get style by key
 */
function getStyleByKey(styleKey) {
    const style = REMIX_STYLES.find(s => s.key === styleKey);
    return style ? { ...style, isRandom: false } : null;
}

/**
 * Generate audio remix using Stable Audio 2.0
 */
async function generateAudioRemix(audioPath, options = {}) {
    try {
        console.log('🎵 Starting Stable Audio 2.0 remix generation');
        
        if (!fs.existsSync(audioPath)) {
            throw new Error('Audio file not found');
        }

        const {
            style = 'ambient music with vocal preservation',
            duration = 30,
            prompt = null
        } = options;

        // Create a prompt that emphasizes preserving the original audio while adding musical elements
        const remixPrompt = prompt || `Create a musical remix by adding ${style} underneath the provided audio. Preserve all spoken words and vocal elements while adding complementary musical instruments, beats, and atmospheric effects. Keep the original timing and speech intact while enhancing with musical layers.`;

        console.log(`🎨 Remix style: ${style}`);
        console.log(`📝 Prompt: ${remixPrompt}`);
        console.log(`⏱️ Duration: ${duration}s`);

        // Read audio file
        const audioBuffer = fs.readFileSync(audioPath);

        console.log('🔄 Running Stable Audio 2.0 model...');

        // Use Stability AI's audio generation
        const response = await stability.audio.generate({
            prompt: remixPrompt,
            audio: audioBuffer,
            seconds_total: duration,
            cfg_scale: 7,
            seed: Math.floor(Math.random() * 1000000)
        });

        console.log('✅ Stable Audio remix generation completed');

        if (!response || !response.audio) {
            throw new Error('No audio output from Stable Audio');
        }

        return {
            success: true,
            audioBuffer: response.audio,
            style: style,
            duration: duration,
            cost: 0.1 // Estimated cost
        };

    } catch (error) {
        console.error('❌ Stable Audio remix error:', error);
        
        // Enhanced error handling for Stable Audio
        if (error.response?.status === 401) {
            return { error: 'Stable Audio authentication failed. Please check your API key.' };
        }
        if (error.response?.status === 402) {
            return { error: 'Insufficient credits in your Stable Audio account. Please add credits to continue.' };
        }
        if (error.response?.status === 429) {
            return { error: 'Rate limit exceeded. Please wait a moment before trying again.' };
        }
        if (error.response?.status >= 500) {
            return { error: 'Stable Audio service is temporarily unavailable. Please try again later.' };
        }
        
        const errorMessage = error.message || error.toString();
        if (errorMessage.includes('insufficient credits') || errorMessage.includes('billing')) {
            return { error: 'Insufficient credits in your Stable Audio account. Please add credits to continue.' };
        }
        if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
            return { error: 'Rate limit exceeded. Please wait a moment before trying again.' };
        }
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
            return { error: 'Audio generation is taking longer than expected. Please try again.' };
        }
        
        return { 
            error: errorMessage,
            success: false
        };
    }
}

/**
 * Save remix audio buffer to local file
 */
async function saveRemixAudio(audioBuffer, taskId) {
    try {
        console.log('💾 Saving remix audio...');
        
        // Create output directory if it doesn't exist
        const outputDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate filename
        const remixFilename = `remix_${taskId}.wav`;
        const outputPath = path.join(outputDir, remixFilename);

        // Save the audio buffer
        fs.writeFileSync(outputPath, audioBuffer);

        console.log(`✅ Remix audio saved as: ${remixFilename}`);
        
        return {
            success: true,
            filename: remixFilename,
            path: outputPath
        };

    } catch (error) {
        console.error('❌ Error saving remix audio:', error);
        throw error;
    }
}

/**
 * Main audio remix function
 */
async function createAudioRemix(audioPath, options = {}) {
    try {
        console.log('🎚️ Starting audio remix creation with Stable Audio 2.0');
        
        // Validate input
        if (!audioPath || !fs.existsSync(audioPath)) {
            throw new Error('Invalid audio file path');
        }

        console.log(`🎤 Source audio: ${path.basename(audioPath)}`);

        // Get style information
        let styleInfo;
        if (options.style) {
            styleInfo = getStyleByKey(options.style);
            if (!styleInfo) {
                throw new Error(`Unknown style: ${options.style}`);
            }
        } else {
            styleInfo = getRandomStyle();
        }

        console.log(`🎲 Style selection: ${styleInfo.name} ${styleInfo.isRandom ? '(randomly selected)' : '(user selected)'}`);

        // Generate remix using Stable Audio 2.0
        const remixResult = await generateAudioRemix(audioPath, {
            style: styleInfo.description,
            duration: options.duration || 30,
            prompt: options.customPrompt
        });

        if (!remixResult.success) {
            throw new Error(remixResult.error || 'Remix generation failed');
        }

        // Save the remix audio
        const taskId = uuidv4();
        const saveResult = await saveRemixAudio(remixResult.audioBuffer, taskId);

        if (!saveResult.success) {
            throw new Error('Failed to save remix audio');
        }

        return {
            success: true,
            result: saveResult.filename,
            style: styleInfo,
            duration: options.duration || 30,
            cost: remixResult.cost,
            taskId: taskId
        };

    } catch (error) {
        console.error('❌ Audio remix creation error:', error);
        
        // Enhanced error handling for Stable Audio
        if (error.response?.status === 401) {
            return { error: 'Stable Audio authentication failed. Please check your API key.' };
        }
        if (error.response?.status === 402) {
            return { error: 'Insufficient credits in your Stable Audio account. Please add credits to continue.' };
        }
        if (error.response?.status === 429) {
            return { error: 'Rate limit exceeded. Please wait a moment before trying again.' };
        }
        if (error.response?.status >= 500) {
            return { error: 'Stable Audio service is temporarily unavailable. Please try again later.' };
        }
        
        const errorMessage = error.message || error.toString();
        if (errorMessage.includes('insufficient credits') || errorMessage.includes('billing')) {
            return { error: 'Insufficient credits in your Stable Audio account. Please add credits to continue.' };
        }
        if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
            return { error: 'Rate limit exceeded. Please wait a moment before trying again.' };
        }
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
            return { error: 'Audio generation is taking longer than expected. Please try again.' };
        }
        
        return {
            error: errorMessage,
            success: false
        };
    }
}

module.exports = {
    createAudioRemix,
    generateAudioRemix,
    saveRemixAudio,
    getRandomStyle,
    getStyleByKey,
    REMIX_STYLES
};
