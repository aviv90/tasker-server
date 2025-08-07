const { Runware } = require('@runware/sdk-js');

const runware = new Runware({
    apiKey: process.env.RUNWARE_API_KEY
});

async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting video generation with prompt:', prompt);
        
        // Use KlingAI model for video generation
        const response = await runware.videoInference({
            positivePrompt: prompt,
            model: "klingai:5@3",
            duration: 5,
            width: 608,
            height: 1080,
            numberResults: 1,
            includeCost: true,
            skipResponse: false
        });

        if (!response || response.length === 0) {
            throw new Error('No response from Runware API');
        }

        const videoData = response[0];
        
        if (videoData.error) {
            throw new Error(videoData.error);
        }

        // Check for video URL in different possible field names
        const videoURL = videoData.videoURL || videoData.video_url || videoData.url || videoData.downloadURL;
        
        if (!videoURL) {
            console.log('Available fields in response:', Object.keys(videoData));
            throw new Error('No video URL found in response');
        }

        console.log('✅ Video generated successfully. URL:', videoURL);
        
        // Return the video URL directly instead of downloading
        return { 
            text: prompt, 
            videoURL: videoURL,
            cost: videoData.cost || null
        };

    } catch (err) {
        console.error('❌ Runware text-to-video error:', err.message);
        
        // Return user-friendly error messages
        if (err.message.includes('insufficient credits')) {
            return { error: 'Insufficient credits in Runware account' };
        } else if (err.message.includes('422') || err.response?.status === 422) {
            return { error: 'Video generation request rejected - check credits or model availability' };
        } else if (err.message.includes('No video URL')) {
            return { error: 'Video generated but URL not available' };
        } else {
            return { error: err.message || 'Video generation failed' };
        }
    }
}

module.exports = { generateVideoWithText };
