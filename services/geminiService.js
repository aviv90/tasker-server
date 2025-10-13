/**
 * Gemini AI Service
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genai = require('@google/genai');
const { sanitizeText } = require('../utils/textSanitizer');
const { getStaticFileUrl } = require('../utils/urlUtils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const veoClient = new genai.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
            generationConfig: { 
                responseModalities: ["IMAGE", "TEXT"], // Allow both - Gemini can add description/caption
                temperature: 0.7
            }
        });
        
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            return { error: 'Invalid response structure from Gemini' };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini: No image data found in response');
            return { error: 'No image data found in response' };
        }
        
        console.log('✅ Gemini image generated successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function generateImageForWhatsApp(prompt, req = null) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
            generationConfig: { 
                responseModalities: ["IMAGE", "TEXT"], // Allow text captions/descriptions alongside image
                temperature: 0.7
            }
        });
        
        
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            return { 
                success: false, 
                error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' 
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            return { 
                success: false, 
                error: 'Invalid response structure from Gemini' 
            };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini: No image data found in response');
            
            // Return the text response if we got text but no image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image, sending text response');
                return { 
                    success: false, 
                    error: 'No image data found in response',
                    textResponse: text.trim() // Send exactly what Gemini wrote
                };
            }
            
            return { 
                success: false, 
                error: 'No image data found in response',
                textResponse: 'מצטער, לא הצלחתי ליצור תמונה כרגע. אנא נסה שוב עם תיאור אחר או מאוחר יותר.'
            };
        }
        
        // Save image to tmp folder and create accessible URL
        const fs = require('fs');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');
        
        const imageId = uuidv4();
        const fileName = `${imageId}.png`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(filePath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Write image file
        fs.writeFileSync(filePath, imageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Gemini image generated successfully');
        console.log(`🖼️ Image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: text.trim() || "", // Send exactly what Gemini writes
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image generation' 
        };
    }
}

async function editImageWithText(prompt, base64Image) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini edit: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini edit: No content or parts found in candidate');
            return { error: 'Invalid response structure from Gemini' };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini edit: No image data found in response');
            return { error: 'No image data found in response' };
        }
        
        console.log('✅ Gemini image edited successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function editImageForWhatsApp(prompt, base64Image, req) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini edit: No candidates returned');
            console.log('   Prompt feedback:', JSON.stringify(response.promptFeedback));
            return { 
                success: false, 
                error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' 
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Log detailed diagnostic info
        console.log(`   Finish reason: ${cand.finishReason}`);
        if (cand.safetyRatings) {
            console.log(`   Safety ratings:`, JSON.stringify(cand.safetyRatings));
        }
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini edit: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            
            // Check for safety blocks
            if (cand.finishReason === 'SAFETY' || cand.finishReason === 'RECITATION' || cand.finishReason === 'PROHIBITED_CONTENT') {
                return { 
                    success: false, 
                    error: `Gemini blocked the request due to: ${cand.finishReason}. Try a different image or prompt.` 
                };
            }
            
            return { 
                success: false, 
                error: 'Invalid response structure from Gemini' 
            };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini edit: No image data found in response');
            console.log(`   Got text response (${text.length} chars): ${text.substring(0, 200)}...`);
            
            // If we got text but no image, try to generate a new image based on the text
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini edit returned text instead of image, attempting to generate new image');
                console.log(`   Will try to generate image from: "${text.trim().substring(0, 100)}..."`);
                
                try {
                    // Try to generate a new image based on the text response
                    const generateResult = await generateImageForWhatsApp(text.trim(), req);
                    if (generateResult.success && generateResult.imageUrl) {
                        console.log('✅ Successfully generated new image from text response');
                        return {
                            success: true,
                            imageUrl: generateResult.imageUrl,
                            description: text.trim(),
                            fileName: generateResult.fileName,
                            generatedFromText: true // Flag to indicate this was generated from text
                        };
                    } else {
                        console.log(`❌ Image generation failed: ${generateResult.error}`);
                    }
                } catch (generateError) {
                    console.error('❌ Failed to generate image from text:', generateError.message);
                }
                
                // If image generation failed, return error instead of text-only
                return { 
                  success: false, 
                  error: 'לא הצלחתי ליצור תמונה ערוכה. נסה שוב.' 
                };
            }
            
            return { 
                success: false, 
                error: 'No image data found in response' 
            };
        }
        
        // Save to public directory
        const fileName = `gemini_edit_${uuidv4()}.png`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(filePath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Write image file
        fs.writeFileSync(filePath, imageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Gemini image edited successfully');
        console.log(`🖼️ Edited image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: text.trim() || "", // Include text description from Gemini
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image editing' 
        };
    }
}

async function analyzeImageWithText(prompt, base64Image) {
    try {
        console.log('🔍 Starting Gemini image analysis (text-only response)');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect if prompt is in Hebrew
        const hasHebrew = /[\u0590-\u05FF]/.test(cleanPrompt);
        const languageInstruction = hasHebrew 
            ? '\n\nחשוב: ענה בעברית בלבד.' 
            : '';
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" // Use regular model for text analysis
        });
        
        const result = await model.generateContent({
            contents: [
                { 
                    role: "user", 
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: base64Image } }, 
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
            console.log('❌ Gemini image analysis: No candidates returned');
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
            console.log('❌ Gemini image analysis: No text found in response');
            return { 
                success: false, 
                error: 'No text response from Gemini' 
            };
        }
        
        console.log('✅ Gemini image analysis completed');
        return { 
            success: true,
            text: text.trim(),
            description: text.trim()
        };
    } catch (err) {
        console.error('❌ Gemini image analysis error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image analysis' 
        };
    }
}

async function analyzeVideoWithText(prompt, videoBuffer) {
    try {
        console.log('🔍 Starting Gemini video analysis (text-only response)');
        console.log(`📹 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect if prompt is in Hebrew
        const hasHebrew = /[\u0590-\u05FF]/.test(cleanPrompt);
        const languageInstruction = hasHebrew 
            ? '\n\nחשוב: ענה בעברית בלבד.' 
            : '';
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" // Use regular model for text analysis
        });
        
        let videoPart;
        
        // For videos larger than 2MB, use Files API; otherwise use inline data
        if (videoBuffer.length > 2 * 1024 * 1024) {
            console.log('📤 Video is large, uploading to Files API first...');
            
            // Save video to temporary file
            const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
            const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
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
            model: "veo-3.0-generate-001", // Stable version
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
        const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
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
            model: "veo-3.0-generate-001", // Stable version
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
        const tempFilePath = path.join(__dirname, '..', 'public', 'tmp', tempFileName);
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
        console.log('🎬 Starting Veo 3 text-to-video generation - Stable version');
        const cleanPrompt = sanitizeText(prompt);
        
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.0-generate-001", // Stable version
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
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
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
            model: "veo-3.0-generate-001", // Stable version
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
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
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
        
        console.log('✅ Veo 3 image-to-video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${videoUrl}`);
        
        return { 
            success: true,
            videoUrl: videoUrl,
            description: cleanPrompt, // Include the prompt as description
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Veo 3 image-to-video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image-to-video generation' 
        };
    }
}

/**
 * Generate text response using Gemini with conversation history support
 * @param {string} prompt - User input text
 * @param {Array} conversationHistory - Previous messages in conversation
 * @param {Object} options - Additional options
 * @returns {Object} - Response with generated text
 */
async function generateTextResponse(prompt, conversationHistory = [], options = {}) {
    try {
        console.log('💬 Gemini text generation');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: options.model || "gemini-2.5-flash" 
        });

        // Build conversation contents for Gemini
        const contents = [];

        // Add system prompt as first user message (Gemini format)
        contents.push({
            role: 'user',
            parts: [{ text: 'אתה עוזר AI ידידותי, אדיב ונעים. תן תשובות טבעיות ונעימות.\n\nחשוב מאוד:\n1. אל תכתב את תהליך החשיבה שלך. אל תכתב "THOUGHT", "This response:", "*Drafting*" או כל הערות מטא אחרות. תשיב ישירות עם התשובה הסופית בלבד.\n2. תמיד תשיב באותה שפה שבה המשתמש שואל - אם השאלה בעברית, התשובה תהיה בעברית. אם באנגלית, התשובה תהיה באנגלית.' }]
        });
        
        // Add system prompt response
        contents.push({
            role: 'model',
            parts: [{ text: 'הבנתי. אשיב ישירות ללא כתיבת תהליך חשיבה, ותמיד באותה שפה שבה נשאלת השאלה.' }]
        });

        // Normalize conversation history to an array to avoid undefined lengths
        if (!Array.isArray(conversationHistory)) {
            conversationHistory = [];
        }

        // Add conversation history if exists
        if (conversationHistory.length > 0) {
            console.log(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
            
            for (const msg of conversationHistory) {
                // Convert OpenAI format to Gemini format
                const role = msg.role === 'assistant' ? 'model' : 'user';
                contents.push({
                    role: role,
                    parts: [{ text: msg.content }]
                });
            }
        }

        // Add current user message
        contents.push({
            role: 'user',
            parts: [{ text: cleanPrompt }]
        });

        console.log(`🔮 Gemini processing (${Array.isArray(conversationHistory) ? conversationHistory.length : 0} context messages)`);

        // Generate response with history
        const result = await model.generateContent({ contents });
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        let text = response.text();
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini: Empty text response');
            return { error: 'Empty response from Gemini' };
        }
        
        // Clean up verbose thinking patterns that sometimes appear
        text = text.trim();
        
        // Detect various thinking/reasoning patterns that should be removed
        const hasThinkingPattern = 
            text.includes('SPECIAL INSTRUCTION:') || 
            text.includes('Think step-by-step') ||
            text.startsWith('THOUGHT') ||
            /^THOUGHT\s/m.test(text) || // THOUGHT at start of a line
            text.includes('*Drafting the response:*') ||
            text.includes('This response:');
        
        if (hasThinkingPattern) {
            console.log('🧹 Detected verbose thinking pattern, extracting final answer...');
            
            // Split by common delimiters that separate thinking from final answer
            let finalAnswer = '';
            
            // Try to find the actual answer after thinking patterns
            // Often the final answer comes after patterns like:
            // - "This response:" followed by bullet points, then the actual text
            // - Just after markdown formatting like "*text*" or numbered lists
            
            const lines = text.split('\n');
            let inThinkingSection = false;
            let answerLines = [];
            let foundAnswerStart = false;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Skip empty lines at the start
                if (!foundAnswerStart && !line) continue;
                
                // Detect thinking section markers
                if (line.startsWith('THOUGHT') || 
                    line.includes('SPECIAL INSTRUCTION') ||
                    line.includes('Think step-by-step') ||
                    line.includes('I need to:') ||
                    line.includes('*Drafting the response:*') ||
                    line.includes('This response:')) {
                    inThinkingSection = true;
                    continue;
                }
                
                // Skip lines that look like internal reasoning
                if (inThinkingSection && (
                    line.startsWith('*') && line.endsWith('*') || // Markdown emphasis for meta-comments
                    line.match(/^\d+\.\s+\*.*\*:/) || // Numbered list with emphasized headers
                    line.includes('The user is') ||
                    line.includes('My current instruction') ||
                    line.includes('Let\'s consider') ||
                    line.includes('I should'))) {
                    continue;
                }
                
                // If we find a line that looks like actual content (Hebrew/English text, reasonable length)
                // and doesn't have meta-markers, consider it the start of the answer
                if (line.length > 0 && 
                    !line.startsWith('*') && 
                    !line.match(/^\d+\.\s+\*/) &&
                    !line.includes('THOUGHT')) {
                    foundAnswerStart = true;
                    inThinkingSection = false;
                    answerLines.push(lines[i]); // Keep original formatting
                } else if (foundAnswerStart && !inThinkingSection) {
                    answerLines.push(lines[i]); // Keep building the answer
                }
            }
            
            if (answerLines.length > 0) {
                finalAnswer = answerLines.join('\n').trim();
                
                // Additional cleanup: remove any remaining markdown meta-comments at the start
                finalAnswer = finalAnswer.replace(/^\*.*?\*\s*\n/gm, '');
                
                // If the answer is still wrapped in quotes (from drafting), extract it
                // e.g., "זו שאלה מעניינת..." -> זו שאלה מעניינת...
                const quotedMatch = finalAnswer.match(/^"(.+)"$/s);
                if (quotedMatch) {
                    finalAnswer = quotedMatch[1].trim();
                    console.log('🧹 Removed surrounding quotes from answer');
                }
                
                if (finalAnswer && finalAnswer.length > 10) {
                    text = finalAnswer;
                    console.log(`🎯 Extracted final answer (${finalAnswer.length} chars)`);
                    console.log(`   Preview: ${finalAnswer.substring(0, 100)}...`);
                }
            }
        }
        
        console.log(`✅ Gemini text generated: ${text.substring(0, 100)}...`);
        
        return {
            text: text,
            originalPrompt: cleanPrompt,
            metadata: {
                service: 'Gemini',
                model: options.model || "gemini-2.5-flash",
                type: 'text_generation',
                characterCount: text.length,
                created_at: new Date().toISOString()
            }
        };
        
    } catch (err) {
        console.error('❌ Gemini text generation error:', err);
        
        // Emergency response
        return { 
            text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Gemini. נסה שוב מאוחר יותר.',
            error: err.message || 'Text generation failed' 
        };
    }
}

/**
 * Generate chat summary using Gemini
 */
async function generateChatSummary(messages) {
    try {
        console.log(`📝 Generating chat summary for ${messages.length} messages`);
        
        // Format messages for Gemini
        let formattedMessages = '';
        messages.forEach((msg, index) => {
            const timestamp = new Date(msg.timestamp * 1000).toLocaleString('he-IL');
            
            // Use WhatsApp display name only (chatName), fallback to phone number
            let sender = 'משתמש';
            if (msg.chatName) {
                sender = msg.chatName;
            } else if (msg.sender) {
                // Extract phone number from sender ID (e.g., "972543995202@c.us" -> "972543995202")
                const phoneMatch = msg.sender.match(/^(\d+)@/);
                sender = phoneMatch ? phoneMatch[1] : msg.sender;
            }
            
            const messageText = msg.textMessage || msg.caption || '[מדיה]';
            
            formattedMessages += `${index + 1}. ${timestamp} - ${sender}: ${messageText}\n`;
        });
        
        const summaryPrompt = `אנא צור סיכום קצר וברור של השיחה הבאה. התמקד בנושאים העיקריים, החלטות שהתקבלו, ונקודות חשובות.

חשוב: הסיכום חייב להיות בעברית.

הודעות השיחה:
${formattedMessages}

סיכום השיחה:`;

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(summaryPrompt);
        
        if (!result.response) {
            throw new Error('No response from Gemini');
        }
        
        const summaryText = result.response.text();
        console.log(`✅ Chat summary generated: ${summaryText.length} characters`);
        
        return {
            success: true,
            text: summaryText
        };
        
    } catch (err) {
        console.error('❌ Chat summary generation error:', err);
        return {
            success: false,
            error: err.message || 'Chat summary generation failed'
        };
    }
}

/**
 * Parse music generation request to detect if video is requested
 * @param {string} prompt - User's music request
 * @returns {Object} - { wantsVideo: boolean, cleanPrompt: string }
 */
async function parseMusicRequest(prompt) {
    try {
        console.log('🔍 Parsing music request for video option');
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const analysisPrompt = `Analyze this music generation request and determine if the user wants a video along with the song.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "wantsVideo": true/false,
  "cleanPrompt": "the music description without video request"
}

Rules:
1. If user explicitly requests video or clip (e.g., "with video", "כולל וידאו", "עם וידאו", "גם וידאו", "plus video", "and video", "ועם וידאו", "קליפ", "כולל קליפ", "עם קליפ", "clip", "with clip", "video clip"), set wantsVideo=true
2. Extract the actual music description (without the video/clip instruction)
3. Keep the cleanPrompt focused on music style, theme, mood, lyrics topic
4. If no video/clip is mentioned, set wantsVideo=false and keep original prompt

Examples:
Input: "צור שיר בסגנון רוק על אהבה כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר בסגנון רוק על אהבה"}

Input: "create a pop song about summer with video"
Output: {"wantsVideo":true,"cleanPrompt":"create a pop song about summer"}

Input: "שיר עצוב על פרידה עם קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר עצוב על פרידה"}

Input: "שיר רומנטי כולל קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר רומנטי"}

Input: "make a rock song with clip"
Output: {"wantsVideo":true,"cleanPrompt":"make a rock song"}

Input: "צור שיר ג'אז"
Output: {"wantsVideo":false,"cleanPrompt":"צור שיר ג'אז"}

Input: "make a happy song"
Output: {"wantsVideo":false,"cleanPrompt":"make a happy song"}`;

        const result = await model.generateContent(analysisPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini music parsing: No candidates returned');
            return { wantsVideo: false, cleanPrompt: prompt };
        }
        
        let rawText = response.text().trim();
        
        // Remove markdown code fences if present
        rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const parsed = JSON.parse(rawText);
        
        console.log('✅ Music request parsed:', parsed);
        return parsed;
        
    } catch (err) {
        console.error('❌ Error parsing music request:', err);
        // Fallback: no video
        return { wantsVideo: false, cleanPrompt: prompt };
    }
}

/**
 * Parse text-to-speech request to detect if translation is needed
 * @param {string} prompt - User's TTS request
 * @returns {Object} - { needsTranslation: boolean, text: string, targetLanguage?: string, languageCode?: string }
 */
async function parseTextToSpeechRequest(prompt) {
    try {
        console.log('🔍 Parsing TTS request for translation needs');
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const analysisPrompt = `Analyze this text-to-speech request and determine if the user wants the output in a specific language.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "needsTranslation": true/false,
  "text": "the text to speak",
  "targetLanguage": "language name in English (e.g., Japanese, French, Spanish)",
  "languageCode": "ISO 639-1 code (e.g., ja, fr, es, he, en, ar)"
}

Rules:
1. If user explicitly requests a language (e.g., "say X in Japanese", "אמור X ביפנית", "read X in French"), set needsTranslation=true
2. Extract the actual text to speak (without the language instruction)
3. Map the target language to its ISO code
4. If no specific language is requested, set needsTranslation=false, use the original text, and omit targetLanguage/languageCode

Examples:
Input: "אמור היי מה נשמע ביפנית"
Output: {"needsTranslation":true,"text":"היי מה נשמע","targetLanguage":"Japanese","languageCode":"ja"}

Input: "say hello world in French"
Output: {"needsTranslation":true,"text":"hello world","targetLanguage":"French","languageCode":"fr"}

Input: "קרא את הטקסט הזה בערבית: שלום עולם"
Output: {"needsTranslation":true,"text":"שלום עולם","targetLanguage":"Arabic","languageCode":"ar"}

Input: "אמור שלום"
Output: {"needsTranslation":false,"text":"אמור שלום"}

Input: "read this text"
Output: {"needsTranslation":false,"text":"read this text"}`;

        const result = await model.generateContent(analysisPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini TTS parsing: No candidates returned');
            return { needsTranslation: false, text: prompt };
        }
        
        let rawText = response.text().trim();
        
        // Remove markdown code fences if present
        rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const parsed = JSON.parse(rawText);
        
        console.log('✅ TTS request parsed:', parsed);
        return parsed;
        
    } catch (err) {
        console.error('❌ Error parsing TTS request:', err);
        // Fallback: no translation
        return { needsTranslation: false, text: prompt };
    }
}

/**
 * Translate text to target language using Gemini
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language name
 * @returns {Object} - { success: boolean, translatedText?: string, error?: string }
 */
async function translateText(text, targetLanguage) {
    try {
        console.log(`🌐 Translating "${text}" to ${targetLanguage}`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const translationPrompt = `Translate the following text to ${targetLanguage}. Return ONLY the translated text, nothing else.

Text to translate: "${text}"

Important: Return only the translation, no explanations, no quotes, no extra text.`;

        const result = await model.generateContent(translationPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini translation: No candidates returned');
            return { 
                success: false, 
                error: 'Translation failed: No response from Gemini' 
            };
        }
        
        const translatedText = response.text().trim();
        
        console.log(`✅ Translation complete: "${translatedText}"`);
        
        return {
            success: true,
            translatedText: translatedText
        };
        
    } catch (err) {
        console.error('❌ Translation error:', err);
        return { 
            success: false, 
            error: err.message || 'Translation failed' 
        };
    }
}

module.exports = { 
    generateImageWithText, 
    generateImageForWhatsApp, 
    editImageWithText, 
    editImageForWhatsApp, 
    analyzeImageWithText,
    analyzeVideoWithText,
    generateVideoWithText, 
    generateVideoWithImage, 
    generateVideoForWhatsApp, 
    generateVideoFromImageForWhatsApp, 
    generateTextResponse, 
    generateChatSummary,
    parseMusicRequest,
    parseTextToSpeechRequest,
    translateText
};
