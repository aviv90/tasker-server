const { Runware } = require('@runware/sdk-js');

const runware = new Runware({
    apiKey: process.env.RUNWARE_API_KEY,
    timeout: 300000, // 5 minutes timeout
    retries: 5
});

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting video generation with prompt:', prompt);
        
        // Use KlingAI model for video generation with longer timeout
        const response = await runware.videoInference({
            positivePrompt: prompt,
            model: "klingai:5@3",
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
            const errorMsg = typeof videoData.error === 'string' ? videoData.error : videoData.error.message || JSON.stringify(videoData.error);
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
                            const errorMsg = typeof taskResult.error === 'string' ? taskResult.error : taskResult.error.message || JSON.stringify(taskResult.error);
                            return { error: errorMsg };
                        }
                        
                        // Check for completion - the actual status is 'success'
                        if (taskResult.status === 'success' && taskResult.videoURL) {
                            console.log('✅ Video generated successfully');
                            return { 
                                text: prompt, 
                                videoURL: taskResult.videoURL,
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
                
                // Extract error message from poll error
                const errorMessage = pollError.error?.message || pollError.message || pollError.toString();
                
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
        
        // Extract error message from the actual error structure
        const errorMessage = err.error?.message || err.message || err.toString();
        return { error: errorMessage };
    }
}

async function generateVideoFromImage(prompt, base64Image) {
    try {
        console.log('🎬 Starting image-to-video generation');
        
        // Use KlingAI model for image-to-video generation
        const response = await runware.videoInference({
            positivePrompt: prompt,
            model: "klingai:5@3",
            duration: 5,
            width: 608,
            height: 1080,
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
            const errorMsg = typeof videoData.error === 'string' ? videoData.error : videoData.error.message || JSON.stringify(videoData.error);
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
                            const errorMsg = typeof taskResult.error === 'string' ? taskResult.error : taskResult.error.message || JSON.stringify(taskResult.error);
                            return { error: errorMsg };
                        }
                        
                        // Check for completion - the actual status is 'success'
                        if (taskResult.status === 'success' && taskResult.videoURL) {
                            console.log('✅ Image-to-video generated successfully');
                            return { 
                                text: prompt, 
                                videoURL: taskResult.videoURL,
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
                
                // Extract error message from poll error
                const errorMessage = pollError.error?.message || pollError.message || pollError.toString();
                
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
        
        // Extract error message from the actual error structure
        const errorMessage = err.error?.message || err.message || err.toString();
        return { error: errorMessage };
    }
}

module.exports = { generateVideoWithText, generateVideoFromImage };
