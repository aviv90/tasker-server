const Replicate = require('replicate');

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_KEY,
});

// Best models for each task type
const MODELS = {
    TEXT_TO_VIDEO: "ali-vilab/i2vgen-xl:5821a338d00033abaaba89080a17eb8783d9a17ed710a6b4246a18e0900ccad4",
    IMAGE_TO_VIDEO: "wan-video/wan-2.2-i2v-a14b",
    VIDEO_TO_VIDEO: "bytedance/seedance-1-pro" // This supports both text-to-video and image-to-video, can be used for video editing
};

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting Replicate text-to-video generation with prompt:', prompt);
        
        // Start the prediction
        const prediction = await replicate.predictions.create({
            version: MODELS.TEXT_TO_VIDEO,
            input: {
                prompt: prompt,
                duration: 5, // 5 seconds
                width: 608,
                height: 1080,
                guidance_scale: 7.5,
                num_inference_steps: 50
            }
        });

        if (!prediction || !prediction.id) {
            console.error('❌ No prediction ID received from Replicate');
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for text-to-video completion, predictionId:', prediction.id);
        
        // Poll for completion - up to 10 minutes with 10-second intervals
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts} - Status: ${result.status}`);
                
                // Check for completion
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Text-to-video generated successfully');
                    
                    // Extract video URL from output
                    let videoURL = result.output;
                    if (Array.isArray(result.output)) {
                        videoURL = result.output[0];
                    }
                    
                    return { 
                        text: prompt, 
                        result: videoURL,
                        cost: calculateCost(result) || null
                    };
                }
                
                // Check for failure
                if (result.status === 'failed' || result.status === 'canceled') {
                    console.error('❌ Text-to-video generation failed with status:', result.status);
                    
                    // Return detailed error information
                    let errorMsg = result.error || `Task ${result.status}`;
                    if (result.logs) {
                        errorMsg += ` - Logs: ${result.logs}`;
                    }
                    
                    return { error: errorMsg };
                }
                
                // Continue polling for other statuses (starting, processing, etc.)
                
            } catch (pollError) {
                console.log(`⚠️ Poll attempt ${attempts} failed`);
                console.error('❌ Poll error details:', pollError);
                
                // Extract full error details
                let errorMessage = pollError.message || pollError.toString();
                
                // If there's a full error object, include all its details
                if (pollError.response?.data) {
                    const errorDetails = {
                        message: pollError.response.data.detail || pollError.message,
                        status: pollError.response.status,
                        statusText: pollError.response.statusText,
                        data: pollError.response.data
                    };
                    
                    // Remove undefined fields and create readable text
                    const cleanDetails = Object.entries(errorDetails)
                        .filter(([key, value]) => value !== undefined)
                        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                        .join(', ');
                        
                    errorMessage = cleanDetails || errorMessage;
                }
                
                // Only return error if it's a critical failure (auth, quota, etc.)
                if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
                    console.error('❌ Critical Replicate error:', errorMessage);
                    return { error: errorMessage };
                }
                
                // Otherwise continue polling
            }
        }
        
        console.error('❌ Text-to-video generation timed out');
        return { error: 'Text-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Text-to-video generation error:', err);
        
        // Return the full error object as text if it exists, otherwise just the message
        let errorMessage = err.message || err.toString();
        
        // If there's a response with error details
        if (err.response?.data) {
            const errorDetails = {
                message: err.response.data.detail || err.message,
                status: err.response.status,
                statusText: err.response.statusText,
                type: err.response.data.type,
                title: err.response.data.title
            };
            
            // Remove undefined fields and create readable text
            const cleanDetails = Object.entries(errorDetails)
                .filter(([key, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
                
            errorMessage = cleanDetails || errorMessage;
        }
        
        return { error: errorMessage };
    }
}

// Helper function to calculate cost based on prediction details
function calculateCost(prediction) {
    try {
        // Replicate usually charges based on prediction time and model
        // This is an estimation - actual costs may vary
        if (prediction.metrics?.predict_time) {
            const timeInSeconds = prediction.metrics.predict_time;
            // Rough estimate: $0.01-0.05 per second for video models
            return (timeInSeconds * 0.02).toFixed(4);
        }
        return null;
    } catch (err) {
        console.warn('⚠️ Could not calculate cost:', err.message);
        return null;
    }
}

async function generateVideoFromImage(imageBuffer, prompt = null) {
    try {
        console.log('🎬 Starting Replicate image-to-video generation');
        
        // Convert buffer to base64 data URL
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        
        // Prepare input for the Wan 2.2 i2v model
        const input = {
            image: base64Image,
            duration: 5, // Duration in seconds
            fps: 24, // Frames per second
            resolution: "720p" // Output resolution
        };
        
        // Add prompt if provided
        if (prompt) {
            input.prompt = prompt;
        }
        
        // Start the prediction
        const prediction = await replicate.predictions.create({
            version: MODELS.IMAGE_TO_VIDEO,
            input: input
        });

        if (!prediction || !prediction.id) {
            console.error('❌ No prediction ID received from Replicate for image-to-video');
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for image-to-video completion, predictionId:', prediction.id);
        
        // Poll for completion - up to 10 minutes with 10-second intervals
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts} - Status: ${result.status}`);
                
                // Check for completion
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Image-to-video generated successfully');
                    
                    // Extract video URL from output
                    let videoURL = result.output;
                    if (Array.isArray(result.output)) {
                        videoURL = result.output[0];
                    }
                    
                    return { 
                        text: prompt || 'Image to video conversion', 
                        result: videoURL,
                        cost: calculateCost(result) || null
                    };
                }
                
                // Check for failure
                if (result.status === 'failed' || result.status === 'canceled') {
                    console.error('❌ Image-to-video generation failed with status:', result.status);
                    
                    let errorMsg = result.error || `Task ${result.status}`;
                    if (result.logs) {
                        errorMsg += ` - Logs: ${result.logs}`;
                    }
                    
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                console.log(`⚠️ Poll attempt ${attempts} failed`);
                console.error('❌ Poll error details:', pollError);
                
                let errorMessage = pollError.message || pollError.toString();
                
                if (pollError.response?.data) {
                    const errorDetails = {
                        message: pollError.response.data.detail || pollError.message,
                        status: pollError.response.status,
                        statusText: pollError.response.statusText,
                        data: pollError.response.data
                    };
                    
                    const cleanDetails = Object.entries(errorDetails)
                        .filter(([key, value]) => value !== undefined)
                        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                        .join(', ');
                        
                    errorMessage = cleanDetails || errorMessage;
                }
                
                if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
                    console.error('❌ Critical Replicate error:', errorMessage);
                    return { error: errorMessage };
                }
            }
        }
        
        console.error('❌ Image-to-video generation timed out');
        return { error: 'Image-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Image-to-video generation error:', err);
        
        let errorMessage = err.message || err.toString();
        
        if (err.response?.data) {
            const errorDetails = {
                message: err.response.data.detail || err.message,
                status: err.response.status,
                statusText: err.response.statusText,
                type: err.response.data.type,
                title: err.response.data.title
            };
            
            const cleanDetails = Object.entries(errorDetails)
                .filter(([key, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
                
            errorMessage = cleanDetails || errorMessage;
        }
        
        return { error: errorMessage };
    }
}

async function generateVideoFromVideo(videoBuffer, prompt = null) {
    try {
        console.log('🎬 Starting Replicate video-to-video generation');
        
        // Convert buffer to base64 data URL
        const base64Video = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
        
        // Prepare input for the Seedance model
        const input = {
            image: base64Video, // Seedance uses 'image' field for both images and videos
            duration: 5, // Duration in seconds
            fps: 24, // Frames per second
            resolution: "720p" // Output resolution
        };
        
        // Add prompt if provided
        if (prompt) {
            input.prompt = prompt;
        }
        
        // Start the prediction
        const prediction = await replicate.predictions.create({
            version: MODELS.VIDEO_TO_VIDEO,
            input: input
        });

        if (!prediction || !prediction.id) {
            console.error('❌ No prediction ID received from Replicate for video-to-video');
            return { error: 'No prediction ID received from Replicate' };
        }

        console.log('🔄 Polling for video-to-video completion, predictionId:', prediction.id);
        
        // Poll for completion - up to 15 minutes with 15-second intervals (video-to-video takes longer)
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds
            attempts++;
            
            try {
                const result = await replicate.predictions.get(prediction.id);
                
                console.log(`🔄 Attempt ${attempts} - Status: ${result.status}`);
                
                // Check for completion
                if (result.status === 'succeeded' && result.output) {
                    console.log('✅ Video-to-video generated successfully');
                    
                    // Extract video URL from output
                    let videoURL = result.output;
                    if (Array.isArray(result.output)) {
                        videoURL = result.output[0];
                    }
                    
                    return { 
                        text: prompt || 'Video to video conversion', 
                        result: videoURL,
                        cost: calculateCost(result) || null
                    };
                }
                
                // Check for failure
                if (result.status === 'failed' || result.status === 'canceled') {
                    console.error('❌ Video-to-video generation failed with status:', result.status);
                    
                    let errorMsg = result.error || `Task ${result.status}`;
                    if (result.logs) {
                        errorMsg += ` - Logs: ${result.logs}`;
                    }
                    
                    return { error: errorMsg };
                }
                
            } catch (pollError) {
                console.log(`⚠️ Poll attempt ${attempts} failed`);
                console.error('❌ Poll error details:', pollError);
                
                let errorMessage = pollError.message || pollError.toString();
                
                if (pollError.response?.data) {
                    const errorDetails = {
                        message: pollError.response.data.detail || pollError.message,
                        status: pollError.response.status,
                        statusText: pollError.response.statusText,
                        data: pollError.response.data
                    };
                    
                    const cleanDetails = Object.entries(errorDetails)
                        .filter(([key, value]) => value !== undefined)
                        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                        .join(', ');
                        
                    errorMessage = cleanDetails || errorMessage;
                }
                
                if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
                    console.error('❌ Critical Replicate error:', errorMessage);
                    return { error: errorMessage };
                }
            }
        }
        
        console.error('❌ Video-to-video generation timed out');
        return { error: 'Video-to-video generation timed out after 15 minutes' };

    } catch (err) {
        console.error('❌ Video-to-video generation error:', err);
        
        let errorMessage = err.message || err.toString();
        
        if (err.response?.data) {
            const errorDetails = {
                message: err.response.data.detail || err.message,
                status: err.response.status,
                statusText: err.response.statusText,
                type: err.response.data.type,
                title: err.response.data.title
            };
            
            const cleanDetails = Object.entries(errorDetails)
                .filter(([key, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
                
            errorMessage = cleanDetails || errorMessage;
        }
        
        return { error: errorMessage };
    }
}

module.exports = { 
    generateVideoWithText, 
    generateVideoFromImage, 
    generateVideoFromVideo 
};
