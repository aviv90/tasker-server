/**
 * Gemini Video Generation & Analysis
 * 
 * Video creation, editing, and analysis using Gemini Veo.
 * Extracted from gemini/core.js (Phase 4.5)
 */

const genai = require('@google/genai');
const { getGeminiErrorMessage } = require('./utils');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const { sanitizeText } = require('../../utils/textSanitizer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const veoClient = new genai.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function analyzeVideoWithText(prompt, videoBuffer) {
    try {
        console.log('🔍 Starting Gemini video analysis (text-only response)');
        console.log(`📹 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect user's language using proper detection (not just Hebrew check)
        const { detectLanguage } = require('../../utils/agentHelpers');
        const detectedLang = detectLanguage(cleanPrompt);
        
        // Build language instruction based on detected language
        let languageInstruction = '';
        switch (detectedLang) {
            case 'he':
                languageInstruction = '\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
                break;
            case 'en':
                languageInstruction = '\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
                break;
            case 'ar':
                languageInstruction = '\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
                break;
            case 'ru':
                languageInstruction = '\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
                break;
            default:
                // Default to Hebrew for unknown languages
                languageInstruction = '\n\nחשוב מאוד: ענה בעברית בלבד.';
        }
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" // Use regular model for text analysis
        });
        
        let videoPart;
        
        // For videos larger than 2MB, use Files API; otherwise use inline data
        if (videoBuffer.length > 2 * 1024 * 1024) {
            console.log('📤 Video is large, uploading to Files API first...');
            
            // Save video to temporary file
            const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
            const tempFilePath = path.join(__dirname, '../..', 'public', 'tmp', tempFileName);
            const tmpDir = path.dirname(tempFilePath);
            
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            fs.writeFileSync(tempFilePath, videoBuffer);
            
            try {
                // Upload video file to Gemini Files API
                const uploadResult = await veoClient.files.upload({
                    file: {
                        path: tempFilePath,
                        mimeType: 'video/mp4'
                    }
                });
                
                console.log('✅ Video uploaded to Files API');
                
                // Use fileData reference instead of inline data
                videoPart = { 
                    fileData: {
                        fileUri: uploadResult.file.uri,
                        mimeType: uploadResult.file.mimeType
                    }
                };
                
                // Clean up temp file after upload
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log('🧹 Cleaned up temporary video file');
                } catch (cleanupErr) {
                    console.warn('⚠️ Could not delete temp file:', cleanupErr.message);
                }
                
            } catch (uploadErr) {
                console.error('❌ Failed to upload video to Files API:', uploadErr);
                // Fallback to inline data if upload fails
                console.log('🔄 Falling back to inline data...');
                const base64Video = videoBuffer.toString('base64');
                videoPart = { inlineData: { mimeType: "video/mp4", data: base64Video } };
            }
        } else {
            console.log('📦 Video is small enough, using inline data');
            // Convert video buffer to base64 for inline data
            const base64Video = videoBuffer.toString('base64');
            videoPart = { inlineData: { mimeType: "video/mp4", data: base64Video } };
        }
        
        const result = await model.generateContent({
            contents: [
                { 
                    role: "user", 
                    parts: [
                        videoPart,
                        { text: cleanPrompt + languageInstruction }
                    ] 
                }
            ],
            generationConfig: { 
                responseModalities: ["TEXT"], // Text-only response
                temperature: 0.7
            }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini video analysis: No candidates returned');
            return { 
                success: false, 
                error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' 
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        
        // Extract text from response
        if (cand.content && cand.content.parts) {
            for (const part of cand.content.parts) {
                if (part.text) {
                    text += part.text;
                }
            }
        }
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini video analysis: No text found in response');
            return { 
                success: false, 
                error: 'No text response from Gemini' 
            };
        }
        
        console.log('✅ Gemini video analysis completed');
        return { 
            success: true,
            text: text.trim(),
            description: text.trim()
        };
    } catch (err) {
        console.error('❌ Gemini video analysis error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during video analysis' 
        };
    }
}
async function generateVideoWithText(prompt) {
    try {
        console.log('🎬 Starting Veo 3 text-to-video generation - Stable version');
        const cleanPrompt = sanitizeText(prompt);
        
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.1-generate-preview", // Latest Veo 3 Preview (September 2025)
            prompt: cleanPrompt,
            config: {
                aspectRatio: "9:16" // Vertical format for mobile (720p resolution)
            }
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 text-to-video generation timed out');
                return { error: 'Video generation timed out after 10 minutes' };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 text-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
        }
        
        // Check if we have a valid response structure
        if (!operation.response || !operation.response.generatedVideos || 
            !operation.response.generatedVideos.length || 
            !operation.response.generatedVideos[0] || 
            !operation.response.generatedVideos[0].video) {
            console.error('❌ Invalid Veo 3 response structure:', operation);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'Invalid response from Veo 3 API';
            if (operation.response && operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return { error: errorMessage };
        }
        
        const videoFile = operation.response.generatedVideos[0].video;
        
        const tempFileName = `temp_video_${uuidv4()}.mp4`;
        const tempFilePath = path.join(__dirname, '../..', 'public', 'tmp', tempFileName);
        const tmpDir = path.dirname(tempFilePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        try {
            await veoClient.files.download({ file: videoFile, downloadPath: tempFilePath });
            console.log('📥 SDK download completed');
        } catch (downloadError) {
            console.error('❌ SDK download failed:', downloadError);
            return { error: `Failed to download video file: ${downloadError.message}` };
        }
        
        // Check if the file was created and is complete
        let retries = 0;
        let fileReady = false;
        
        while (!fileReady && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (fs.existsSync(tempFilePath)) {
                try {
                    const stats = fs.statSync(tempFilePath);
                    
                    // Check that the file is not empty and stable (size doesn't change)
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
        
        // Don't delete the file, we need the download link
        // Return buffer, text and result path that will be prefixed in finalizeVideo
        console.log('✅ Veo 3 text-to-video generated successfully.');
        
        const videoBuffer = fs.readFileSync(tempFilePath);
        const filename = path.basename(tempFilePath);
        const publicPath = `/static/${filename}`;
        
        return {
            text: cleanPrompt,
            videoBuffer: videoBuffer,
            result: publicPath // This will be processed by finalizeVideo to create full URL
        };
    } catch (err) {
        console.error('❌ Veo 3 text-to-video generation error:', err);
        return { error: err.message || 'Unknown error' };
    }
}
async function generateVideoWithImage(prompt, imageBuffer) {
    try {
        console.log('🎬 Starting Veo 3 image-to-video generation');
        
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert image buffer to base64 string as expected by the API
        const imageBase64 = imageBuffer.toString('base64');
        
        // Step 1: Generate video with Veo 3 using the provided image
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.1-generate-preview", // Latest Veo 3 Preview (September 2025)
            prompt: cleanPrompt,
            image: {
                imageBytes: imageBase64,
                mimeType: "image/jpeg", // Try JPEG instead of PNG
            },
            config: {
                aspectRatio: "9:16" // Vertical format for mobile (720p resolution)
            }
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 image-to-video generation timed out');
                return { error: 'Video generation timed out after 10 minutes' };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 image-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
        }
        
        // Check if we have a valid response structure
        if (!operation.response || !operation.response.generatedVideos || 
            !operation.response.generatedVideos.length || 
            !operation.response.generatedVideos[0] || 
            !operation.response.generatedVideos[0].video) {
            console.error('❌ Invalid Veo 3 response structure:', operation);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'Invalid response from Veo 3 API';
            if (operation.response && operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return { error: errorMessage };
        }
        
        const videoFile = operation.response.generatedVideos[0].video;
        
        const tempFileName = `temp_video_${uuidv4()}.mp4`;
        const tempFilePath = path.join(__dirname, '../..', 'public', 'tmp', tempFileName);
        const tmpDir = path.dirname(tempFilePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        try {
            await veoClient.files.download({ file: videoFile, downloadPath: tempFilePath });
            console.log('📥 SDK download completed');
        } catch (downloadError) {
            console.error('❌ SDK download failed:', downloadError);
            return { error: `Failed to download video file: ${downloadError.message}` };
        }
        
        // Check that the file was created and is complete
        let retries = 0;
        let fileReady = false;
        
        while (!fileReady && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (fs.existsSync(tempFilePath)) {
                try {
                    const stats = fs.statSync(tempFilePath);
                    
                    // Check that the file is not empty and stable (size doesn't change)
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
        
        console.log('✅ Veo 3 image-to-video generated successfully.');
        
        const videoBuffer = fs.readFileSync(tempFilePath);
        const filename = path.basename(tempFilePath);
        const publicPath = `/static/${filename}`;
        
        return {
            text: cleanPrompt,
            videoBuffer: videoBuffer,
            result: publicPath // This will be processed by finalizeVideo to create full URL
        };
    } catch (err) {
        console.error('❌ Veo 3 image-to-video generation error:', err);
        return { error: err.message || 'Unknown error' };
    }
}
async function generateVideoForWhatsApp(prompt, req = null) {
    try {
        console.log('🎬 Starting Veo 3 text-to-video generation - Preview version');
        const cleanPrompt = sanitizeText(prompt);
        
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.1-generate-preview", // Latest Veo 3 Preview (September 2025)
            prompt: cleanPrompt,
            config: {
                aspectRatio: "9:16" // Vertical format for mobile (720p resolution)
            }
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 text-to-video generation timed out');
                return { 
                    success: false, 
                    error: 'Video generation timed out after 10 minutes' 
                };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 text-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
        }
        
        // Check if we have a valid response structure
        if (!operation.response) {
            console.error('❌ No response in operation:', operation);
            return {
                success: false,
                error: 'No response received from Veo 3 API'
            };
        }
        
        if (!operation.response.generatedVideos) {
            console.error('❌ No generatedVideos in response:', operation.response);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'No generated videos in Veo 3 response';
            if (operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
        
        if (!operation.response.generatedVideos.length || !operation.response.generatedVideos[0]) {
            console.error('❌ Empty generatedVideos array:', operation.response.generatedVideos);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'No videos were generated by Veo 3';
            if (operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
        
        if (!operation.response.generatedVideos[0].video) {
            console.error('❌ No video file in first generated video:', operation.response.generatedVideos[0]);
            return {
                success: false,
                error: 'Generated video has no file reference'
            };
        }
        
        const videoFile = operation.response.generatedVideos[0].video;
        
        const fileName = `veo3_video_${uuidv4()}.mp4`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        try {
            await veoClient.files.download({ file: videoFile, downloadPath: filePath });
            console.log('📥 SDK download completed');
        } catch (downloadError) {
            console.error('❌ SDK download failed:', downloadError);
            return { 
                success: false, 
                error: `Failed to download video file: ${downloadError.message}` 
            };
        }
        
        // Check if the file was created and is complete
        let retries = 0;
        let fileReady = false;
        
        while (!fileReady && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (fs.existsSync(filePath)) {
                try {
                    const stats = fs.statSync(filePath);
                    
                    // Check that the file is not empty and stable (size doesn't change)
                    if (stats.size > 0) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const newStats = fs.statSync(filePath);
                        
                        if (newStats.size === stats.size && stats.size > 100000) { // At least 100KB for video
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
            return { 
                success: false, 
                error: 'Video file was not downloaded successfully' 
            };
        }
        
        // Create public URL using centralized URL utility
        const videoUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Veo 3 text-to-video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${videoUrl}`);
        
        return { 
            success: true,
            videoUrl: videoUrl,
            description: cleanPrompt, // Include the prompt as description
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Veo 3 text-to-video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during video generation' 
        };
    }
}
async function generateVideoFromImageForWhatsApp(prompt, imageBuffer, req = null) {
    try {
        console.log('🎬 Starting Veo 3 image-to-video generation - Stable version');
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert image buffer to base64 string as expected by the API
        const imageBase64 = imageBuffer.toString('base64');
        
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.1-generate-preview", // Latest Veo 3 Preview (September 2025)
            prompt: cleanPrompt,
            image: {
                imageBytes: imageBase64,
                mimeType: "image/jpeg", // Try JPEG instead of PNG
            },
            config: {
                aspectRatio: "9:16" // Vertical format for mobile (720p resolution)
            }
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 image-to-video generation timed out');
                return { 
                    success: false, 
                    error: 'Video generation timed out after 10 minutes' 
                };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 image-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
        }
        
        // Check if we have a valid response structure
        if (!operation.response) {
            console.error('❌ No response in operation:', operation);
            return {
                success: false,
                error: 'No response received from Veo 3 API'
            };
        }
        
        if (!operation.response.generatedVideos) {
            console.error('❌ No generatedVideos in response:', operation.response);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'No generated videos in Veo 3 response';
            if (operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
        
        if (!operation.response.generatedVideos.length || !operation.response.generatedVideos[0]) {
            console.error('❌ Empty generatedVideos array:', operation.response.generatedVideos);
            
            // Check if there are filtered reasons from Veo 3
            let errorMessage = 'No videos were generated by Veo 3';
            if (operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                errorMessage = operation.response.raiMediaFilteredReasons[0]; // Use the original Veo 3 error message
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
        
        if (!operation.response.generatedVideos[0].video) {
            console.error('❌ No video file in first generated video:', operation.response.generatedVideos[0]);
            return {
                success: false,
                error: 'Generated video has no file reference'
            };
        }
        
        const videoFile = operation.response.generatedVideos[0].video;
        
        const fileName = `veo3_image_video_${uuidv4()}.mp4`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        try {
            await veoClient.files.download({ file: videoFile, downloadPath: filePath });
            console.log('📥 SDK download completed');
        } catch (downloadError) {
            console.error('❌ SDK download failed:', downloadError);
            return { 
                success: false, 
                error: `Failed to download video file: ${downloadError.message}` 
            };
        }
        
        // Check if the file was created and is complete
        let retries = 0;
        let fileReady = false;
        
        while (!fileReady && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (fs.existsSync(filePath)) {
                try {
                    const stats = fs.statSync(filePath);
                    
                    // Check that the file is not empty and stable (size doesn't change)
                    if (stats.size > 0) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const newStats = fs.statSync(filePath);
                        
                        if (newStats.size === stats.size && stats.size > 100000) { // At least 100KB for video
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
            return { 
                success: false, 
                error: 'Video file was not downloaded successfully' 
            };
        }
        
        // Convert video to WhatsApp-compatible format using ffmpeg
        // WhatsApp requires MP4 with H.264 video and AAC audio
        console.log('🎬 Converting video to WhatsApp-compatible format...');
        const { exec } = require('child_process');
        const convertedFileName = `veo3_image_video_converted_${uuidv4()}.mp4`;
        const convertedFilePath = path.join(__dirname, '../..', 'public', 'tmp', convertedFileName);
        
        try {
            await new Promise((resolve, reject) => {
                exec(`ffmpeg -i "${filePath}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart "${convertedFilePath}" -y`, 
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error('❌ FFmpeg conversion failed:', error);
                            console.error('❌ FFmpeg stderr:', stderr);
                            reject(error);
                        } else {
                            console.log('✅ Video converted successfully');
                            // Delete original file
                            fs.unlinkSync(filePath);
                            resolve();
                        }
                    });
            });
        } catch (convertError) {
            console.error('❌ Video conversion failed:', convertError);
            // Fallback: use original file
            console.log('⚠️ Using original file without conversion');
            const originalVideoUrl = getStaticFileUrl(fileName, req);
            return { 
                success: true,
                videoUrl: originalVideoUrl,
                description: cleanPrompt,
                fileName: fileName
            };
        }
        
        // Create public URL using centralized URL utility
        const videoUrl = getStaticFileUrl(convertedFileName, req);
        
        console.log('✅ Veo 3 image-to-video generated and converted successfully');
        console.log(`🎬 Video saved to: ${convertedFilePath}`);
        console.log(`🔗 Public URL: ${videoUrl}`);
        
        return { 
            success: true,
            videoUrl: videoUrl,
            description: cleanPrompt, // Include the prompt as description
            fileName: convertedFileName
        };
    } catch (err) {
        console.error('❌ Veo 3 image-to-video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image-to-video generation' 
        };
    }
}

module.exports = {
  analyzeVideoWithText,
  generateVideoWithText,
  generateVideoWithImage,
  generateVideoForWhatsApp,
  generateVideoFromImageForWhatsApp
};
