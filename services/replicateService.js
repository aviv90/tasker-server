const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

const MODELS = {
    TEXT_TO_VIDEO: "kwaivgi/kling-v2.1-master",
    IMAGE_TO_VIDEO: "kwaivgi/kling-v2.1-master", 
    VIDEO_TO_VIDEO: "runwayml/gen4-aleph",
    VEO3_TEXT_TO_VIDEO: "google/veo-3",
    VEO3_IMAGE_TO_VIDEO: "google/veo-3"
};

async function generateVideoWithText(prompt, model = 'kling') {
    try {
        const isVeo3 = model === 'veo3';
        const modelName = isVeo3 ? 'Veo 3' : 'Kling v2.1 Master';
        const modelVersion = isVeo3 ? MODELS.VEO3_TEXT_TO_VIDEO : MODELS.TEXT_TO_VIDEO;
        
        console.log(`🎬 Starting ${modelName} text-to-video generation`);
        
        // Configure input parameters based on model
        let inputParams = {
            prompt: prompt,
        };
        
        if (isVeo3) {
            // Veo 3 parameters
            inputParams = {
                ...inputParams,
                duration: 8, // Veo 3 default duration
                width: 1920,
                height: 1080,
                aspect_ratio: "16:9"
            };
        } else {
            // Kling v2.1 Master parameters  
            inputParams = {
                ...inputParams,
                aspect_ratio: "9:16",
                duration: 5,
                negative_prompt: ""
            };
        }
        
        const prediction = await replicate.predictions.create({
            version: modelVersion,
            input: inputParams
        });

        if (!prediction?.id) {
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = isVeo3 ? 60 : 80; // Kling can take longer
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
            
            console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for text-to-video generation`);
            
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
                        cost: calculateCost(result, isVeo3)
                    };
                }
                
                if (result.status === 'failed' || result.status === 'canceled') {
                    const errorMsg = result.error || `Task ${result.status}`;
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                console.log(`❌ Polling attempt ${attempts} failed:`, pollError.message);
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

function calculateCost(prediction, isVeo3 = false) {
    try {
        if (isVeo3) {
            // Veo 3 costs $6 per 8-second video ($0.75 per second)
            return "6.00";
        } else {
            // Kling v2.1 Master costs $0.28 per second (5s = $1.40)
            return "1.40"; // Fixed cost for 5-second Kling video
        }
    } catch (err) {
        return isVeo3 ? "6.00" : "1.40";
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

async function generateVideoFromImage(imageBuffer, prompt = null, model = 'kling') {
    try {
        const isVeo3 = model === 'veo3';
        const modelName = isVeo3 ? 'Veo 3' : 'Kling v2.1 Master';
        const modelVersion = isVeo3 ? MODELS.VEO3_IMAGE_TO_VIDEO : MODELS.IMAGE_TO_VIDEO;
        
        console.log(`🎬 Starting ${modelName} image-to-video generation`);
        
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        
        // Configure input parameters based on model
        let input = {
            image: base64Image,
        };
        
        if (isVeo3) {
            // Veo 3 parameters for image-to-video
            input = {
                ...input,
                duration: 8,
                aspect_ratio: "16:9"
            };
        } else {
            // Kling v2.1 Master parameters
            input = {
                ...input,
                start_image: base64Image, // Kling uses start_image instead of image
                duration: 5,
                aspect_ratio: "9:16" // Vertical format for mobile
            };
            // Remove the image key for Kling
            delete input.image;
        }
        
        if (prompt) {
            input.prompt = prompt;
        } else if (!isVeo3) {
            // Kling needs a default prompt when none provided
            input.prompt = "animate this image with smooth motion";
        }
        
        const prediction = await replicate.predictions.create({
            version: modelVersion,
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
            
            console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for image-to-video generation`);
            
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
                        cost: calculateCost(result, isVeo3)
                    };
                }
                
                if (result.status === 'failed' || result.status === 'canceled') {
                    const errorMsg = result.error || `Task ${result.status}`;
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                console.log(`❌ Polling attempt ${attempts} failed:`, pollError.message);
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

async function generateVideoFromImageForWhatsApp(imageBuffer, prompt, req = null) {
    try {
        console.log('🎬 Starting Kling v2.1 Master image-to-video generation (WhatsApp format)');
        
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        
        // Kling v2.1 Master parameters for WhatsApp (9:16 format)
        const input = {
            start_image: base64Image,
            prompt: prompt || "animate this image with smooth motion",
            duration: 5,
            aspect_ratio: "9:16" // Vertical format for mobile
        };
        
        const prediction = await replicate.predictions.create({
            version: MODELS.IMAGE_TO_VIDEO,
            input: input
        });

        if (!prediction?.id) {
            return { 
                success: false, 
                error: 'No prediction ID received from Replicate' 
            };
        }

        console.log('🔄 Polling for completion');
        
        const maxAttempts = 80; // Kling can take longer
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            const status = await replicate.predictions.get(prediction.id);
            attempts++;
            
            console.log(`🔄 Attempt ${attempts}/${maxAttempts} - Status: ${status.status}`);
            
            if (status.status === 'succeeded' && status.output) {
                console.log('✅ Kling v2.1 Master image-to-video generation completed');
                
                // Save video to tmp folder and create accessible URL
                const { getStaticFileUrl } = require('../utils/urlUtils');
                const fs = require('fs');
                const path = require('path');
                const { v4: uuidv4 } = require('uuid');
                const axios = require('axios');
                
                const videoId = uuidv4();
                const fileName = `kling_image_video_${videoId}.mp4`;
                const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
                
                // Ensure tmp directory exists
                const tmpDir = path.dirname(filePath);
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }
                
                // Download video from Replicate URL
                const videoResponse = await axios.get(status.output, { 
                    responseType: 'arraybuffer' 
                });
                
                // Write video file
                fs.writeFileSync(filePath, videoResponse.data);
                
                // Create public URL using centralized URL utility
                const videoUrl = getStaticFileUrl(fileName, req);
                
                console.log('✅ Kling v2.1 Master image-to-video generated successfully (WhatsApp format)');
                console.log(`🎬 Video saved to: ${filePath}`);
                console.log(`🔗 Public URL: ${videoUrl}`);
                
                return { 
                    success: true,
                    videoUrl: videoUrl,
                    description: prompt || "וידאו נוצר מתמונה",
                    fileName: fileName
                };
            }
            
            if (status.status === 'failed') {
                const errorMessage = extractErrorDetails(status.error);
                console.error('❌ Kling v2.1 Master image-to-video generation failed:', errorMessage);
                return { 
                    success: false, 
                    error: errorMessage 
                };
            }
        }
        
        console.error('❌ Kling v2.1 Master image-to-video generation timed out');
        return { 
            success: false, 
            error: `Video generation timed out after ${maxAttempts} attempts` 
        };
        
    } catch (err) {
        console.error('❌ Kling v2.1 Master image-to-video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image-to-video generation' 
        };
    }
}

async function generateVideoFromVideoForWhatsApp(videoBuffer, prompt, req = null) {
    try {
        console.log('🎬 Starting RunwayML Gen4 video-to-video generation (WhatsApp format)');
        
        // Create temporary file for video processing
        const tempDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
        fs.writeFileSync(tempVideoPath, videoBuffer);

        const videoBase64 = fs.readFileSync(tempVideoPath).toString('base64');
        const videoDataUrl = `data:video/mp4;base64,${videoBase64}`;

        const input = {
            prompt: prompt || "enhance and transform this video",
            video: videoDataUrl,
            aspect_ratio: "9:16" // Vertical format for mobile
        };
        
        console.log('🔄 Calling RunwayML Gen4 API');
        const output = await replicate.run(MODELS.VIDEO_TO_VIDEO, { input });
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempVideoPath);
        } catch (cleanupError) {
            console.warn('Could not clean up temp file:', cleanupError.message);
        }
        
        if (!output) {
            return { 
                success: false, 
                error: 'No output received from RunwayML Gen4' 
            };
        }
        
        // Handle different response types
        let videoURL = null;
        
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
                
                const processedVideoBuffer = Buffer.concat(chunks);
                const outputFilename = `runway_video_${Date.now()}.mp4`;
                const outputPath = path.join(tempDir, outputFilename);
                
                fs.writeFileSync(outputPath, processedVideoBuffer);
                
                // Create public URL using centralized URL utility
                const { getStaticFileUrl } = require('../utils/urlUtils');
                videoURL = getStaticFileUrl(outputFilename, req);
                
                console.log('✅ RunwayML Gen4 video-to-video completed (WhatsApp format)');
                
            } catch (streamError) {
                return { 
                    success: false, 
                    error: `Failed to read video stream: ${streamError.message}` 
                };
            }
        } else {
            // Handle direct URL response
            if (Array.isArray(output)) {
                videoURL = output[0];
            } else if (typeof output === 'object' && output.video) {
                videoURL = output.video;
            } else if (typeof output === 'object' && output.output) {
                videoURL = output.output;
            } else {
                videoURL = output;
            }
            
            console.log('✅ RunwayML Gen4 video-to-video completed (WhatsApp format)');
        }
        
        if (!videoURL) {
            return { 
                success: false, 
                error: 'No video URL received from RunwayML Gen4' 
            };
        }
        
        return { 
            success: true,
            videoUrl: videoURL,
            description: prompt || "וידאו עובד מחדש",
            fileName: `runway_video_${Date.now()}.mp4`
        };
        
    } catch (err) {
        console.error('❌ RunwayML Gen4 video-to-video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during video-to-video generation' 
        };
    }
}

module.exports = { 
    generateVideoWithText, 
    generateVideoFromImage, 
    generateVideoFromVideo,
    generateVideoFromImageForWhatsApp,
    generateVideoFromVideoForWhatsApp
};
