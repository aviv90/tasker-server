const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const { sanitizeText } = require('../utils/textSanitizer');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

const MODELS = {
    TEXT_TO_VIDEO: "ali-vilab/i2vgen-xl:5821a338d00033abaaba89080a17eb8783d9a17ed710a6b4246a18e0900ccad4",
    IMAGE_TO_VIDEO: "wan-video/wan-2.2-i2v-a14b",
    VIDEO_TO_VIDEO: "runwayml/gen4-aleph"
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
                // Return the full polling error object as-is (text-to-video)
                return { error: pollError };
            }
        }
        
        return { error: 'Text-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Text-to-video generation error:', err);
        // Return the full error object as-is
        return { error: err };
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
                // Return the full polling error object as-is (image-to-video)
                return { error: pollError };
            }
        }
        
        return { error: 'Image-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Image-to-video generation error:', err);
        // Return the full error object as-is
        return { error: err };
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
        console.error('❌ Video-to-video generation error:', error);
        // Return the full error object as-is
        return { error: error };
    }
}



module.exports = { 
    generateVideoWithText, 
    generateVideoFromImage, 
    generateVideoFromVideo
};
