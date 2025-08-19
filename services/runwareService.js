const { Runware } = require('@runware/sdk-js');
const { sanitizeText } = require('../utils/textSanitizer');

const runware = new Runware({
    apiKey: process.env.RUNWARE_API_KEY,
    timeout: 300000, // 5 minutes timeout
    retries: 5
});

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting video generation with prompt:', prompt);
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Use KlingAI model for video generation with longer timeout
        const response = await runware.videoInference({
            positivePrompt: cleanPrompt,
            model: "google:3@0",
            duration: 5,
            width: 608,
            height: 1080,
            numberResults: 1,
            includeCost: true,
            skipResponse: true // Skip waiting, we'll poll manually
        });

        if (!response) {
            console.error('❌ No response from Runware API');
            return { error: 'No response from Runware API' };
        }

        // Handle both single object and array responses
        const videoData = Array.isArray(response) ? response[0] : response;
        
        // Safely check for error
        if (videoData?.error) {
            console.error('❌ Runware API error:', videoData.error);
            
            // Return full error details if it's an object
            let errorMsg = videoData.error;
            if (typeof videoData.error === 'object') {
                const errorDetails = Object.entries(videoData.error)
                    .filter(([key, value]) => value !== undefined)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                errorMsg = errorDetails || videoData.error.message || JSON.stringify(videoData.error);
            }
            
            return { error: errorMsg };
        }

        // Get taskUUID for polling
        const taskUUID = videoData?.taskUUID;
        
        if (!taskUUID) {
            console.error('❌ No taskUUID received');
            return { error: 'No taskUUID received for polling' };
        }

        // Poll for completion
        console.log('🔄 Polling for video, taskUUID:', taskUUID);
        
        // Poll for up to 10 minutes with 10-second intervals
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            attempts++;
            
            try {
                const pollResponse = await runware.getResponse({ taskUUID });
                
                if (pollResponse && Array.isArray(pollResponse) && pollResponse.length > 0) {
                    const taskResult = pollResponse.find(video => video?.taskUUID === taskUUID);
                    
                    if (taskResult) {
                        console.log(`🔄 Attempt ${attempts} - Status: ${taskResult.status}`);
                        
                        // Check for errors
                        if (taskResult.error) {
                            console.error('❌ Task error:', taskResult.error);
                            
                            // Return full error details if it's an object
                            let errorMsg = taskResult.error;
                            if (typeof taskResult.error === 'object') {
                                const errorDetails = Object.entries(taskResult.error)
                                    .filter(([key, value]) => value !== undefined)
                                    .map(([key, value]) => `${key}: ${value}`)
                                    .join(', ');
                                errorMsg = errorDetails || taskResult.error.message || JSON.stringify(taskResult.error);
                            }
                            
                            return { error: errorMsg };
                        }
                        
                        // Check for completion - the actual status is 'success'
                        if (taskResult.status === 'success' && taskResult.videoURL) {
                            console.log('✅ Video generated successfully');
                            return { 
                                text: prompt, 
                                result: taskResult.videoURL,
                                cost: taskResult.cost || null
                            };
                        }
                        
                        // Check for failure statuses
                        if (taskResult.status === 'failed' || taskResult.status === 'error') {
                            console.error('❌ Video generation failed with status:', taskResult.status);
                            return { error: taskResult.statusMessage || taskResult.message || `Task ${taskResult.status}` };
                        }
                        
                        // Continue polling for other statuses (processing, etc.)
                    }
                }
            } catch (pollError) {
                console.log(`⚠️ Poll attempt ${attempts} failed`);
                console.error('❌ Poll error details:', pollError);
                
                // Extract full error details
                let errorMessage = pollError.error?.message || pollError.message || pollError.toString();
                
                // If there's a full error object, include all its details
                if (pollError.error && typeof pollError.error === 'object') {
                    const errorDetails = {
                        message: pollError.error.message,
                        code: pollError.error.code,
                        error: pollError.error.error,
                        documentation: pollError.error.documentation,
                        taskType: pollError.error.taskType,
                        taskUUID: pollError.error.taskUUID
                    };
                    
                    // Remove undefined fields and create readable text
                    const cleanDetails = Object.entries(errorDetails)
                        .filter(([key, value]) => value !== undefined)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                        
                    errorMessage = cleanDetails || errorMessage;
                }
                
                // Only return error if it's a critical failure, otherwise continue polling
                if (pollError.error?.code === 'insufficientCredits' || pollError.error?.status === 'error') {
                    console.error('❌ Critical provider error:', errorMessage);
                    return { error: errorMessage };
                }
                
                // Otherwise continue polling
            }
        }
        
        console.error('❌ Video generation timed out');
        return { error: 'Video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Video generation error:', err);
        // Return the full error object as-is
        return { error: err };
    }
}

async function generateVideoFromImage(prompt, base64Image) {
    try {
        console.log('🎬 Starting image-to-video generation');
        
        // Use KlingAI model for image-to-video generation
        const response = await runware.videoInference({
            positivePrompt: prompt,
            model: "google:3@0",
            duration: 5,
            width: 1080,
            height: 1920,
            frameImages: [
                {
                    inputImage: `data:image/jpeg;base64,${base64Image}`
                }
            ],
            numberResults: 1,
            includeCost: true,
            skipResponse: true // Skip waiting, we'll poll manually
        });

        if (!response) {
            console.error('❌ No response from Runware API');
            return { error: 'No response from Runware API' };
        }

        // Handle both single object and array responses
        const videoData = Array.isArray(response) ? response[0] : response;
        
        // Safely check for error
        if (videoData?.error) {
            console.error('❌ Runware API error:', videoData.error);
            
            // Return full error details if it's an object
            let errorMsg = videoData.error;
            if (typeof videoData.error === 'object') {
                const errorDetails = Object.entries(videoData.error)
                    .filter(([key, value]) => value !== undefined)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                errorMsg = errorDetails || videoData.error.message || JSON.stringify(videoData.error);
            }
            
            return { error: errorMsg };
        }

        // Get taskUUID for polling
        const taskUUID = videoData?.taskUUID;

        if (!taskUUID) {
            console.error('❌ No taskUUID received');
            return { error: 'No taskUUID received for polling' };
        }        // Poll for completion
        console.log('🔄 Polling for image-to-video, taskUUID:', taskUUID);
        
        // Poll for up to 10 minutes with 10-second intervals
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            attempts++;
            
            try {
                const pollResponse = await runware.getResponse({ taskUUID });
                
                if (pollResponse && Array.isArray(pollResponse) && pollResponse.length > 0) {
                    const taskResult = pollResponse.find(video => video?.taskUUID === taskUUID);
                    
                    if (taskResult) {
                        console.log(`🔄 Attempt ${attempts} - Status: ${taskResult.status}`);
                        
                        // Check for errors
                        if (taskResult.error) {
                            console.error('❌ Task error:', taskResult.error);
                            
                            // Return full error details if it's an object
                            let errorMsg = taskResult.error;
                            if (typeof taskResult.error === 'object') {
                                const errorDetails = Object.entries(taskResult.error)
                                    .filter(([key, value]) => value !== undefined)
                                    .map(([key, value]) => `${key}: ${value}`)
                                    .join(', ');
                                errorMsg = errorDetails || taskResult.error.message || JSON.stringify(taskResult.error);
                            }
                            
                            return { error: errorMsg };
                        }
                        
                        // Check for completion - the actual status is 'success'
                        if (taskResult.status === 'success' && taskResult.videoURL) {
                            console.log('✅ Image-to-video generated successfully');
                            return { 
                                text: prompt, 
                                result: taskResult.videoURL,
                                cost: taskResult.cost || null
                            };
                        }
                        
                        // Check for failure statuses
                        if (taskResult.status === 'failed' || taskResult.status === 'error') {
                            console.error('❌ Image-to-video generation failed with status:', taskResult.status);
                            return { error: taskResult.statusMessage || taskResult.message || `Task ${taskResult.status}` };
                        }
                        
                        // Continue polling for other statuses (processing, etc.)
                    }
                }
            } catch (pollError) {
                console.log(`⚠️ Poll attempt ${attempts} failed`);
                console.error('❌ Poll error details:', pollError);
                
                // Extract full error details
                let errorMessage = pollError.error?.message || pollError.message || pollError.toString();
                
                // If there's a full error object, include all its details
                if (pollError.error && typeof pollError.error === 'object') {
                    const errorDetails = {
                        message: pollError.error.message,
                        code: pollError.error.code,
                        error: pollError.error.error,
                        documentation: pollError.error.documentation,
                        taskType: pollError.error.taskType,
                        taskUUID: pollError.error.taskUUID
                    };
                    
                    // Remove undefined fields and create readable text
                    const cleanDetails = Object.entries(errorDetails)
                        .filter(([key, value]) => value !== undefined)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                        
                    errorMessage = cleanDetails || errorMessage;
                }
                
                // Only return error if it's a critical failure, otherwise continue polling
                if (pollError.error?.code === 'insufficientCredits' || pollError.error?.status === 'error') {
                    console.error('❌ Critical provider error:', errorMessage);
                    return { error: errorMessage };
                }
                
                // Otherwise continue polling
            }
        }
        
        console.error('❌ Image-to-video generation timed out');
        return { error: 'Image-to-video generation timed out after 10 minutes' };

    } catch (err) {
        console.error('❌ Image-to-video generation error:', err);
        // Return the full error object as-is
        return { error: err };
    }
}

module.exports = { generateVideoWithText, generateVideoFromImage };
