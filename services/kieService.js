const { sanitizeText } = require('../utils/textSanitizer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class KieService {
    constructor() {
        this.apiKey = process.env.KIE_API_KEY;
        this.baseUrl = 'https://api.kie.ai';
        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async generateVideoWithText(prompt, model = 'veo3') {
        try {
            console.log(`🎬 Starting Kie.ai ${model} text-to-video generation`);
            
            const cleanPrompt = sanitizeText(prompt);
            
            // Step 1: Submit video generation task
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/veo/generate`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    model: model,
                    aspectRatio: "16:9"
                })
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error(`❌ Kie.ai ${model} task submission failed:`, generateData.msg);
                return { error: generateData.msg || 'Task submission failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Kie.ai ${model} task submitted successfully. Task ID: ${taskId}`);

            // Step 2: Poll for completion
            console.log('⏳ Polling for video generation completion...');
            const maxWaitTime = 15 * 60 * 1000; // 15 minutes
            const startTime = Date.now();
            let pollAttempts = 0;

            while (Date.now() - startTime < maxWaitTime) {
                pollAttempts++;
                console.log(`🔄 Polling attempt ${pollAttempts} for Kie.ai ${model} task ${taskId}`);

                const statusResponse = await fetch(`${this.baseUrl}/api/v1/veo/record-info?taskId=${taskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${this.apiKey}` }
                });

                const statusData = await statusResponse.json();

                if (!statusResponse.ok || statusData.code !== 200) {
                    console.error(`❌ Kie.ai ${model} status check failed:`, statusData.msg);
                    return { error: statusData.msg || 'Status check failed' };
                }

                const status = statusData.data;
                console.log(`📊 Kie.ai ${model} status check - successFlag: ${status.successFlag}`);
                console.log(`📊 Full status data:`, JSON.stringify(status, null, 2));

                if (status.successFlag === 1) {
                    // Success - video is ready
                    // According to docs, resultUrls is in status.response.resultUrls
                    const responseData = status.response;
                    if (!responseData || !responseData.resultUrls) {
                        console.error(`❌ Kie.ai ${model} video generation completed but no URLs in response`);
                        return { error: 'Video generation completed but no URLs in response' };
                    }

                    let videoUrls;
                    // resultUrls should already be an array according to the docs
                    if (Array.isArray(responseData.resultUrls)) {
                        videoUrls = responseData.resultUrls;
                    } else if (typeof responseData.resultUrls === 'string') {
                        // Fallback: try to parse as JSON if it's a string
                        try {
                            videoUrls = JSON.parse(responseData.resultUrls);
                        } catch (parseError) {
                            console.error(`❌ Kie.ai ${model} failed to parse result URLs:`, parseError);
                            return { error: `Failed to parse result URLs: ${parseError.message}` };
                        }
                    } else {
                        console.error(`❌ Kie.ai ${model} resultUrls is not array or string:`, typeof responseData.resultUrls);
                        return { error: 'Invalid resultUrls format' };
                    }

                    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
                        console.error(`❌ Kie.ai ${model} no valid video URLs found`);
                        return { error: 'No valid video URLs found' };
                    }

                    console.log(`✅ Kie.ai ${model} video generation completed! Downloading...`);

                    // Step 3: Download the video
                    const videoUrl = videoUrls[0];
                    const tempFileName = `temp_video_${uuidv4()}.mp4`;
                    const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
                    const tmpDir = path.dirname(tempFilePath);

                    if (!fs.existsSync(tmpDir)) {
                        fs.mkdirSync(tmpDir, { recursive: true });
                    }

                    try {
                        const videoResponse = await fetch(videoUrl);
                        if (!videoResponse.ok) {
                            throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
                        }

                        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                        fs.writeFileSync(tempFilePath, videoBuffer);

                        // Verify file was written correctly
                        let retries = 0;
                        let fileReady = false;

                        while (!fileReady && retries < 15) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            
                            if (fs.existsSync(tempFilePath)) {
                                try {
                                    const stats = fs.statSync(tempFilePath);
                                    
                                    if (stats.size > 0) {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        const newStats = fs.statSync(tempFilePath);
                                        
                                        if (newStats.size === stats.size && stats.size > 10000) { // At least 10KB
                                            fileReady = true;
                                            break;
                                        }
                                    }
                                } catch (statError) {
                                    // Continue retrying
                                }
                            }
                            retries++;
                        }

                        if (!fileReady) {
                            console.error('❌ Video file was not properly downloaded');
                            return { error: 'Video file was not downloaded successfully' };
                        }

                        console.log(`✅ Kie.ai ${model} text-to-video generated successfully.`);
                        
                        const finalVideoBuffer = fs.readFileSync(tempFilePath);
                        const filename = path.basename(tempFilePath);
                        const publicPath = `/static/${filename}`;
                        
                        return {
                            text: cleanPrompt,
                            videoBuffer: finalVideoBuffer,
                            result: publicPath
                        };

                    } catch (downloadError) {
                        console.error(`❌ Kie.ai ${model} video download failed:`, downloadError);
                        return { error: `Video download failed: ${downloadError.message}` };
                    }

                } else if (status.successFlag === 2 || status.successFlag === 3) {
                    // Failed
                    console.error(`❌ Kie.ai ${model} video generation failed`);
                    return { error: 'Video generation failed' };
                }

                // Still processing (successFlag === 0), wait and retry
                await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
            }

            // Timeout
            console.error(`❌ Kie.ai ${model} video generation timed out after 15 minutes`);
            return { error: 'Video generation timed out after 15 minutes' };

        } catch (err) {
            console.error(`❌ Kie.ai ${model} text-to-video generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }

    async generateVideoWithImage(prompt, imageBuffer, model = 'veo3') {
        try {
            console.log(`🎬 Starting Kie.ai ${model} image-to-video generation`);
            
            const cleanPrompt = sanitizeText(prompt);

            // Step 1: Upload image first (we need to use their file upload API or convert to URL)
            // For now, we'll save the image temporarily and create a public URL
            const tempImageName = `temp_image_${uuidv4()}.png`;
            const tempImagePath = path.join(__dirname, '..', 'public', 'tmp', tempImageName);
            const tmpDir = path.dirname(tempImagePath);

            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            fs.writeFileSync(tempImagePath, imageBuffer);

            // Create public URL for the image
            const imageUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/tmp/${tempImageName}`;

            // Step 2: Submit video generation task with image
            const generateResponse = await fetch(`${this.baseUrl}/api/v1/veo/generate`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    imageUrls: [imageUrl],
                    model: model,
                    aspectRatio: "16:9"
                })
            });

            const generateData = await generateResponse.json();
            
            if (!generateResponse.ok || generateData.code !== 200) {
                console.error(`❌ Kie.ai ${model} image-to-video task submission failed:`, generateData.msg);
                // Clean up temp image
                try { fs.unlinkSync(tempImagePath); } catch (e) {}
                return { error: generateData.msg || 'Task submission failed' };
            }

            const taskId = generateData.data.taskId;
            console.log(`✅ Kie.ai ${model} image-to-video task submitted successfully. Task ID: ${taskId}`);

            // Step 3: Poll for completion (same logic as text-to-video)
            console.log('⏳ Polling for video generation completion...');
            const maxWaitTime = 15 * 60 * 1000; // 15 minutes
            const startTime = Date.now();
            let pollAttempts = 0;

            while (Date.now() - startTime < maxWaitTime) {
                pollAttempts++;
                console.log(`🔄 Polling attempt ${pollAttempts} for Kie.ai ${model} image-to-video task ${taskId}`);

                const statusResponse = await fetch(`${this.baseUrl}/api/v1/veo/record-info?taskId=${taskId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${this.apiKey}` }
                });

                const statusData = await statusResponse.json();

                if (!statusResponse.ok || statusData.code !== 200) {
                    console.error(`❌ Kie.ai ${model} status check failed:`, statusData.msg);
                    // Clean up temp image
                    try { fs.unlinkSync(tempImagePath); } catch (e) {}
                    return { error: statusData.msg || 'Status check failed' };
                }

                const status = statusData.data;
                console.log(`📊 Kie.ai ${model} image-to-video status check - successFlag: ${status.successFlag}`);
                console.log(`📊 Full image-to-video status data:`, JSON.stringify(status, null, 2));

                if (status.successFlag === 1) {
                    // Success - video is ready
                    // According to docs, resultUrls is in status.response.resultUrls
                    const responseData = status.response;
                    if (!responseData || !responseData.resultUrls) {
                        console.error(`❌ Kie.ai ${model} image-to-video generation completed but no URLs in response`);
                        // Clean up temp image
                        try { fs.unlinkSync(tempImagePath); } catch (e) {}
                        return { error: 'Video generation completed but no URLs in response' };
                    }

                    let videoUrls;
                    // resultUrls should already be an array according to the docs
                    if (Array.isArray(responseData.resultUrls)) {
                        videoUrls = responseData.resultUrls;
                    } else if (typeof responseData.resultUrls === 'string') {
                        // Fallback: try to parse as JSON if it's a string
                        try {
                            videoUrls = JSON.parse(responseData.resultUrls);
                        } catch (parseError) {
                            console.error(`❌ Kie.ai ${model} failed to parse image-to-video result URLs:`, parseError);
                            // Clean up temp image
                            try { fs.unlinkSync(tempImagePath); } catch (e) {}
                            return { error: `Failed to parse result URLs: ${parseError.message}` };
                        }
                    } else {
                        console.error(`❌ Kie.ai ${model} image-to-video resultUrls is not array or string:`, typeof responseData.resultUrls);
                        // Clean up temp image
                        try { fs.unlinkSync(tempImagePath); } catch (e) {}
                        return { error: 'Invalid resultUrls format' };
                    }

                    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
                        console.error(`❌ Kie.ai ${model} no valid video URLs found in image-to-video`);
                        // Clean up temp image
                        try { fs.unlinkSync(tempImagePath); } catch (e) {}
                        return { error: 'No valid video URLs found' };
                    }

                    console.log(`✅ Kie.ai ${model} image-to-video generation completed! Downloading...`);

                    // Download and process video (same logic as text-to-video)
                    const videoUrl = videoUrls[0];
                    const tempFileName = `temp_video_${uuidv4()}.mp4`;
                    const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);

                    try {
                        const videoResponse = await fetch(videoUrl);
                        if (!videoResponse.ok) {
                            throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
                        }

                        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                        fs.writeFileSync(tempFilePath, videoBuffer);

                        // Verify file was written correctly
                        let retries = 0;
                        let fileReady = false;

                        while (!fileReady && retries < 15) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            
                            if (fs.existsSync(tempFilePath)) {
                                try {
                                    const stats = fs.statSync(tempFilePath);
                                    
                                    if (stats.size > 0) {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        const newStats = fs.statSync(tempFilePath);
                                        
                                        if (newStats.size === stats.size && stats.size > 10000) {
                                            fileReady = true;
                                            break;
                                        }
                                    }
                                } catch (statError) {
                                    // Continue retrying
                                }
                            }
                            retries++;
                        }

                        if (!fileReady) {
                            console.error('❌ Video file was not properly downloaded');
                            // Clean up temp image
                            try { fs.unlinkSync(tempImagePath); } catch (e) {}
                            return { error: 'Video file was not downloaded successfully' };
                        }

                        // Clean up temp image
                        try { fs.unlinkSync(tempImagePath); } catch (e) {}

                        console.log(`✅ Kie.ai ${model} image-to-video generated successfully.`);
                        
                        const finalVideoBuffer = fs.readFileSync(tempFilePath);
                        const filename = path.basename(tempFilePath);
                        const publicPath = `/static/${filename}`;
                        
                        return {
                            text: cleanPrompt,
                            videoBuffer: finalVideoBuffer,
                            result: publicPath
                        };

                    } catch (downloadError) {
                        console.error(`❌ Kie.ai ${model} video download failed:`, downloadError);
                        // Clean up temp image
                        try { fs.unlinkSync(tempImagePath); } catch (e) {}
                        return { error: `Video download failed: ${downloadError.message}` };
                    }

                } else if (status.successFlag === 2 || status.successFlag === 3) {
                    // Failed
                    console.error(`❌ Kie.ai ${model} image-to-video generation failed`);
                    // Clean up temp image
                    try { fs.unlinkSync(tempImagePath); } catch (e) {}
                    return { error: 'Video generation failed' };
                }

                // Still processing, wait and retry
                await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
            }

            // Timeout
            console.error(`❌ Kie.ai ${model} image-to-video generation timed out after 15 minutes`);
            // Clean up temp image
            try { fs.unlinkSync(tempImagePath); } catch (e) {}
            return { error: 'Video generation timed out after 15 minutes' };

        } catch (err) {
            console.error(`❌ Kie.ai ${model} image-to-video generation error:`, err);
            return { error: err.message || 'Unknown error' };
        }
    }
}

// Create and export instance
const kieService = new KieService();

module.exports = {
    generateVideoWithText: kieService.generateVideoWithText.bind(kieService),
    generateVideoWithImage: kieService.generateVideoWithImage.bind(kieService)
};
