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
            throw new Error('No response from Runware API');
        }

        // Handle both single object and array responses
        const videoData = Array.isArray(response) ? response[0] : response;
        
        // Safely check for error
        if (videoData?.error) {
            throw new Error(videoData.error);
        }

        // Get taskUUID for polling
        const taskUUID = videoData?.taskUUID;
        
        if (!taskUUID) {
            throw new Error('No taskUUID received for polling');
        }

        // Poll for completion
        console.log('🔄 Polling for video completion, taskUUID:', taskUUID);
        
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
                        console.log(`� Attempt ${attempts}/${maxAttempts} - Status: ${taskResult.status}`);
                        
                        // Check for errors
                        if (taskResult.error) {
                            throw new Error(`Video generation failed: ${taskResult.error}`);
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
                            throw new Error(`Video generation failed with status: ${taskResult.status}`);
                        }
                        
                        // Continue polling for other statuses (processing, etc.)
                    }
                }
            } catch (pollError) {
                console.log(`⚠️ Polling attempt ${attempts} failed:`, pollError.message);
            }
        }
        
        throw new Error('Video generation timed out after 10 minutes');

    } catch (err) {
        console.error('❌ Video generation error:', err.message);
        
        // Return user-friendly error messages
        if (err.message.includes('timed out') || err.message.includes('timeout')) {
            return { error: 'Video generation timed out - please try again with a shorter prompt.' };
        } else if (err.message.includes('insufficient credits') || err.message.includes('credit')) {
            return { error: 'Insufficient credits in Runware account' };
        } else if (err.message.includes('422') || err.response?.status === 422) {
            return { error: 'Video generation request rejected - check credits or model availability' };
        } else if (err.message.includes('authentication') || err.message.includes('API key')) {
            return { error: 'Invalid API key or authentication failed' };
        } else {
            return { error: err.message || 'Video generation failed' };
        }
    }
}

module.exports = { generateVideoWithText };
