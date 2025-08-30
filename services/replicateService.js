const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const { sanitizeText } = require('../utils/textSanitizer');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

const MODELS = {
    TEXT_TO_VIDEO: "kwaivgi/kling-v2.1-master",
    IMAGE_TO_VIDEO: "kwaivgi/kling-v2.1-master",
    VIDEO_TO_VIDEO: "runwayml/gen4-aleph"
};

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting Kling v2.1 Master text-to-video generation');
        
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_VIDEO,
            input: {
                prompt: prompt,
                aspect_ratio: "9:16",
                duration: 5,
                negative_prompt: ""
            }
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = 80; // Kling can take longer
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 15000)); // Longer wait for Kling
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Kling text-to-video completed');
                    
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
                
                console.log(`⏳ Kling progress: ${result.status} (attempt ${attempts}/${maxAttempts})`);
                
            } catch (pollError) {
                console.error('❌ Polling error:', pollError.message);
                return { error: `Polling failed: ${pollError.message}` };
            }
        }
        
        return { error: 'Kling text-to-video generation timed out after 20 minutes' };

    } catch (err) {
        console.error('❌ Kling text-to-video generation error:', err.message || err);
        return { error: `Kling text-to-video failed: ${err.message || err}` };
    }
}

function calculateCost(prediction) {
    try {
        if (prediction.metrics?.predict_time) {
            const timeInSeconds = prediction.metrics.predict_time;
            // Kling costs $0.28 per second of output video (5s = $1.40)
            return (5 * 0.28).toFixed(2); // Fixed cost for 5-second video
        }
        return "1.40"; // Default cost for 5-second Kling video
    } catch (err) {
        return "1.40";
    }
}



async function generateVideoFromImage(imageBuffer, prompt = null) {
    try {
        console.log('🎬 Starting Kling v2.1 Master image-to-video generation');
        
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        
        const input = {
            start_image: base64Image,
            duration: 5
        };
        
        if (prompt) {
            input.prompt = prompt;
        } else {
            input.prompt = "animate this image with smooth motion";
        }
        
        const prediction = await replicate.predictions.create({
            version: MODELS.IMAGE_TO_VIDEO,
            input: input
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = 80; // Kling can take longer
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 15000)); // Longer wait for Kling
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Kling image-to-video completed');
                    
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
                
                console.log(`⏳ Kling progress: ${result.status} (attempt ${attempts}/${maxAttempts})`);
                
            } catch (pollError) {
                console.error('❌ Polling error:', pollError.message);
                return { error: `Polling failed: ${pollError.message}` };
            }
        }
        
        return { error: 'Kling image-to-video generation timed out after 20 minutes' };

    } catch (err) {
        console.error('❌ Kling image-to-video generation error:', err.message || err);
        return { error: `Kling image-to-video failed: ${err.message || err}` };
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
        console.error('❌ Video-to-video generation error:', error.message || error);
        return { error: `Video-to-video failed: ${error.message || error}` };
    }
}



module.exports = { 
    generateVideoWithText, 
    generateVideoFromImage, 
    generateVideoFromVideo
};
