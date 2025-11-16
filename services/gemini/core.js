/**
 * Gemini AI Service
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genai = require('@google/genai');
const { sanitizeText } = require('../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const { getGeminiErrorMessage, cleanThinkingPatterns } = require('./utils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const veoClient = new genai.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// getGeminiErrorMessage is now imported from ./utils.js (SSOT)

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        let cleanPrompt = sanitizeText(prompt);
        
        // Remove image creation instructions from prompt (Gemini Image gets confused by them)
        // Hebrew patterns: "לצייר תמונה של", "צייר תמונה של", "צור תמונה של", "הפוך לתמונה את", etc.
        // English patterns: "draw image of", "create image of", "make image of", etc.
        cleanPrompt = cleanPrompt
            .replace(/^(ל)?(צייר|צור|הפוך|צרי|תצייר|תצור)\s+(תמונה\s+)?(של\s+)?/i, '')
            .replace(/^(to\s+)?(draw|create|make|generate|produce)\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
            .trim();
        
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
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { error: errorMsg };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { error: errorMsg };
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
            
            // If we got text instead, it means Gemini failed to generate image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    error: 'Gemini לא הצליח ליצור תמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { error: 'No image or text data found in response' };
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
        let cleanPrompt = sanitizeText(prompt);
        
        // Remove image creation instructions from prompt (Gemini Image gets confused by them)
        // Hebrew patterns: "לצייר תמונה של", "צייר תמונה של", "צור תמונה של", "הפוך לתמונה את", etc.
        // English patterns: "draw image of", "create image of", "make image of", etc.
        cleanPrompt = cleanPrompt
            .replace(/^(ל)?(צייר|צור|הפוך|צרי|תצייר|תצור)\s+(תמונה\s+)?(של\s+)?/i, '')
            .replace(/^(to\s+)?(draw|create|make|generate|produce)\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
            .trim();
        
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
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { 
                success: false, 
                error: errorMsg
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { 
                success: false, 
                error: errorMsg
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
            
            // If we got text instead, it means Gemini failed to edit/generate image
            // Return the text so the user knows what Gemini said
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - edit/generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    success: false, 
                    error: text.trim()  // Return Gemini's actual response
                };
            }
            
            return { 
                success: false, 
                error: 'No image or text data found in response'
            };
        }
        
        // Save image to tmp folder and create accessible URL
        const fs = require('fs');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');
        
        const imageId = uuidv4();
        const fileName = `${imageId}.png`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        
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
        
        // Log diagnostic info
        console.log(`   Finish reason: ${cand.finishReason}`);
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini edit: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { error: errorMsg };
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
            
            // If we got text instead, it means Gemini failed to generate image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    error: 'Gemini לא הצליח ליצור תמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { error: 'No image or text data found in response' };
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
            
            // Check for safety/policy blocks
            if (cand.finishReason === 'SAFETY' || 
                cand.finishReason === 'IMAGE_SAFETY' || 
                cand.finishReason === 'RECITATION' || 
                cand.finishReason === 'PROHIBITED_CONTENT') {
                
                // Use finishMessage if available (contains the actual error)
                const errorMessage = cand.finishMessage || 
                    `Gemini blocked the request due to: ${cand.finishReason}. Try a different image or prompt.`;
                
                return { 
                    success: false, 
                    error: errorMessage
                };
            }
            
            // Check for other finish reasons with messages
            if (cand.finishMessage) {
                return { 
                    success: false, 
                    error: cand.finishMessage
                };
            }
            
            return { 
                success: false, 
                error: `Gemini returned no content (reason: ${cand.finishReason || 'unknown'})` 
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
            
            // If we got text instead, it means Gemini failed to edit image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - edit failed');
                return { 
                    success: false, 
                    error: 'Gemini לא הצליח לערוך את התמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { 
                success: false, 
                error: 'No image or text data found in response' 
            };
        }
        
        // Save to public directory
        const fileName = `gemini_edit_${uuidv4()}.png`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        
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

// ⚡ Pre-compiled regex patterns for performance (created once, not on every call)
const META_PHRASE_PATTERNS = [
    /^This (directly )?addresses? the question[^.]*\.\s*/i,
    /^I('| a)m (understanding|explaining|providing|answering)[^.]*\.\s*/i,
    /^Let me (answer|explain|clarify|tell you)[^.]*\.\s*/i,
    /^As (an AI|requested)[^.]*\.\s*/i,
    /^My (response|answer) (is|should be)[^.]*\.\s*/i,
    /^I should (answer|respond|explain)[^.]*\.\s*/i,
    /^To answer (this|the question)[^.]*\.\s*/i,
    /^The (answer|response) (is|should be)[^.]*\.\s*/i,
    /^Based on (the question|what you asked)[^.]*\.\s*/i,
    /^Got it\.\s+I need to[^.]*\.\s*/gi,
    /^I need to (pivot|move|shift|change)[^.]*\.\s*/gi,
    /^I'll (acknowledge|recognize|note|pivot)[^.]*\.\s*/gi
];

const THINKING_SECTION_PATTERNS = [
    /My thought process:[\s\S]*?(?=\n\n|\n[א-ת]|$)/gi,
    /My internal thoughts?:[\s\S]*?(?=\n\n|\n[א-ת]|$)/gi,
    /Internal thoughts?:[\s\S]*?(?=\n\n|\n[א-ת]|$)/gi,
    /Thoughts?:[\s\S]*?(?=\n\n|\n[א-ת]|$)/gi,
    /\(thinking:[\s\S]*?\)/gi,
    /^-\s+(Acknowledge|Be friendly|Do not|Wait for)[\s\S]*?(?=\n\n|$)/gmi
];

const PARENTHETICAL_PATTERNS = [
    /\([^)]*without asking[^)]*\)/gi,
    /\([^)]*as the rules state[^)]*\)/gi,
    /\([^)]*as requested[^)]*\)/gi
];

/**
 * Clean meta-linguistic thinking patterns and duplicate text from Gemini responses
 * Gemini sometimes ignores instructions and adds reasoning/thinking in English
 * @param {string} text - The raw text from Gemini
 * @returns {string} - Cleaned text without thinking patterns or duplicates
 */
function cleanThinkingPatterns(text) {
    if (!text || typeof text !== 'string') return text;
    
    let cleaned = text;
    const originalLength = text.length;
    
    // 1. Remove English meta-linguistic phrases that appear at the start
    for (const pattern of META_PHRASE_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    
    // 1.5. Remove "My internal thoughts:" sections (CRITICAL!)
    for (const pattern of THINKING_SECTION_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    
    // 2. Remove parenthetical thinking/reasoning in English
    for (const pattern of PARENTHETICAL_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    
    // 3. Remove duplicate paragraphs/sentences
    // Sometimes Gemini repeats the same text twice
    const lines = cleaned.split('\n');
    const uniqueLines = [];
    const seenLines = new Set();
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines in deduplication (but keep them in output)
        if (trimmedLine === '') {
            uniqueLines.push(line);
            continue;
        }
        
        // Only add non-duplicate content lines
        if (!seenLines.has(trimmedLine)) {
            seenLines.add(trimmedLine);
            uniqueLines.push(line);
        } else {
            console.log(`🧹 Removed duplicate line: "${trimmedLine.substring(0, 50)}..."`);
        }
    }
    
    cleaned = uniqueLines.join('\n');
    
    // 4. Remove consecutive duplicate words (sometimes Gemini stutters)
    // Example: "אני מבין מבין את השאלה" -> "אני מבין את השאלה"
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/g, '$1');
    
    // 5. Detect and handle mixed languages - remove English paragraphs if main content is Hebrew
    // Count Hebrew vs English characters to determine primary language
    const hebrewChars = (cleaned.match(/[\u0590-\u05FF]/g) || []).length;
    const englishChars = (cleaned.match(/[a-zA-Z]/g) || []).length;
    
    // If primary language is Hebrew (Hebrew chars > English chars), remove English-only paragraphs
    if (hebrewChars > englishChars && hebrewChars > 10) {
        console.log(`🌐 Detected Hebrew as primary language (${hebrewChars} Hebrew vs ${englishChars} English chars)`);
        
        // Split by double newlines (paragraphs)
        const paragraphs = cleaned.split(/\n\n+/);
        const filteredParagraphs = [];
        
        for (const para of paragraphs) {
            const paraHebrew = (para.match(/[\u0590-\u05FF]/g) || []).length;
            const paraEnglish = (para.match(/[a-zA-Z]/g) || []).length;
            
            // Keep paragraph if it has Hebrew OR if it's very short (like a single word/emoji)
            if (paraHebrew > 0 || para.trim().length < 20) {
                filteredParagraphs.push(para);
            } else if (paraEnglish > paraHebrew * 2) {
                // This paragraph is mostly English - likely meta-text
                console.log(`🧹 Removed English-only paragraph: "${para.substring(0, 60)}..."`);
            } else {
                // Keep it if unclear
                filteredParagraphs.push(para);
            }
        }
        
        cleaned = filteredParagraphs.join('\n\n');
    }
    
    // 6. Trim extra whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
    cleaned = cleaned.trim();
    
    // Log if significant cleaning happened
    if (cleaned.length < originalLength * 0.8) {
        console.log(`🧹 Cleaned thinking patterns: ${originalLength} -> ${cleaned.length} chars (removed ${originalLength - cleaned.length})`);
    }
    
    return cleaned;
}

/**
 * Generate text response using Gemini with conversation history support
 * @param {string} prompt - User input text
 * @param {Array} conversationHistory - Previous messages in conversation
 * @param {Object} options - Additional options (model, useGoogleSearch)
 * @returns {Object} - Response with generated text
 */
async function generateTextResponse(prompt, conversationHistory = [], options = {}) {
    try {
        console.log('💬 Gemini text generation');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Check if Google Search should be enabled
        const useGoogleSearch = options.useGoogleSearch === true;
        if (useGoogleSearch) {
            console.log('🔍 Google Search enabled for this request');
        }
        
        const model = genAI.getGenerativeModel({ 
            model: options.model || "gemini-2.5-flash" 
        });

        // Build conversation contents for Gemini
        const contents = [];

        // Build system prompt - optimized but detailed for Google Search
        let systemPrompt = `אתה עוזר AI ידידותי. תן תשובות ישירות וטבעיות.

כללי תשובה:
• תשיב ישירות בלבד - ללא הסברים על תהליך החשיבה
• אסור: "As an AI", "My thought process", "Let's break down", "translates to", "I should"
• תמיד תשיב באותה שפה שבה המשתמש שואל`;

        // Add Google Search specific instructions - MUST BE DETAILED
        if (useGoogleSearch) {
            systemPrompt += `

🔍 **כלי Google Search מופעל עבורך - חובה להשתמש בו!**

**הוראות קריטיות:**
1. ✅ יש לך גישה לכלי Google Search - **השתמש בו לכל בקשת קישור!**
2. ❌ **אסור מוחלט** לענות מהזיכרון שלך (אימון 2023) - הקישורים ישנים ושבורים
3. ❌ **אסור להמציא קישורים** - אם Google Search לא מצא, תגיד "לא מצאתי קישור זמין"
4. ⚠️ הזיכרון שלך מ-2023 - קישורי YouTube/חדשות/אתרים כבר לא עובדים!

**תהליך נכון (חובה!):**
משתמש מבקש קישור → השתמש בכלי Google Search → העתק קישור מהתוצאות → שלח למשתמש

**דוגמה למה שאסור:**
❌ "אין לי אפשרות לשלוח קישורים" - **שקר! יש לך Google Search!**
❌ "הנה קישור: youtube.com/watch?v=abc123" - **מומצא! חפש ב-Google Search!**

**דוגמה נכונה:**
✅ [משתמש ב-Google Search tool] → "הנה קישור מאתר ynet: [קישור אמיתי מהחיפוש]"
✅ אם החיפוש לא הצליח: "לא מצאתי קישור זמין, נסה לחפש ב-Google בעצמך"`;
        }

        // Add system prompt as first user message (Gemini format)
        contents.push({
            role: 'user',
            parts: [{ text: systemPrompt }]
        });
        
        // Add system prompt response
        let modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
        
        if (useGoogleSearch) {
            modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
        }
        
        contents.push({
            role: 'model',
            parts: [{ text: modelResponse }]
        });
        
        // Add example of Google Search usage ONLY when Google Search is enabled
        // This helps Gemini understand it MUST use the tool
        if (useGoogleSearch) {
            contents.push({
                role: 'user',
                parts: [{ text: 'שלח לי קישור למזג האוויר בתל אביב' }]
            });
            contents.push({
                role: 'model',
                parts: [{ text: '[משתמש בכלי Google Search לחיפוש "מזג אוויר תל אביב"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423' }]
            });
        }

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

        // Build generation config
        // Lower temperature for Google Search to get more deterministic/factual responses
        const generateConfig = {
            contents,
            generationConfig: {
                temperature: useGoogleSearch ? 0.3 : 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 2048
            }
        };
        
        // Add Google Search tool if requested
        if (useGoogleSearch) {
            generateConfig.tools = [{
                googleSearch: {}
            }];
            console.log('🔍 Google Search tool enabled');
        }
        
        // Generate response with history (and optionally Google Search)
        const result = await model.generateContent(generateConfig);
        const response = result.response;
        
        // Log if Google Search was actually used and extract grounding metadata
        let groundingMetadata = null;
        if (useGoogleSearch) {
            groundingMetadata = response.candidates?.[0]?.groundingMetadata;
            const searchQueries = response.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;
            
            if (groundingMetadata) {
                console.log('✅ Google Search was used by Gemini');
                const chunksCount = groundingMetadata.groundingChunks?.length || 0;
                console.log(`🔍 Found ${chunksCount} grounding chunks`);
                
                if (searchQueries) {
                    console.log('🔎 Search query executed');
                }
            } else {
                console.warn('⚠️ WARNING: Google Search tool was enabled but Gemini did NOT use it!');
                console.warn('   Gemini likely answered from its training data (2023) instead of searching.');
                console.warn('   User may receive old/broken links.');
            }
        }
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { error: errorMsg };
        }
        
        let text = response.text();
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini: Empty text response');
            return { error: 'Empty response from Gemini' };
        }
        
        // Clean up verbose thinking patterns that sometimes appear
        text = text.trim();
        
        // Remove meta-linguistic reasoning and English thinking patterns
        // Sometimes Gemini ignores the system prompt and adds reasoning anyway
        text = cleanThinkingPatterns(text);
        
        // CRITICAL FIX: Resolve redirect URLs to get actual destinations
        // Google Search grounding returns vertexaisearch redirect URLs, not real URLs
        if (useGoogleSearch && groundingMetadata?.groundingChunks?.length > 0) {
            console.log('🔗 Processing grounding metadata...');
            
            // Extract redirect URLs from groundingMetadata
            const redirectUrls = groundingMetadata.groundingChunks
                .filter(chunk => chunk.web?.uri)
                .map(chunk => ({
                    redirectUrl: chunk.web.uri,
                    title: chunk.web.title || null
                }));
            
            if (redirectUrls.length > 0) {
                console.log(`🔄 Found ${redirectUrls.length} redirect URLs, resolving to real URLs...`);
                
                // Resolve redirects to get actual URLs using native https module
                const https = require('https');
                const http = require('http');
                const { URL } = require('url');
                
                const realUrls = await Promise.all(
                    redirectUrls.map(async (urlData) => {
                        return new Promise((resolve) => {
                            try {
                                const parsedUrl = new URL(urlData.redirectUrl);
                                const httpModule = parsedUrl.protocol === 'https:' ? https : http;
                                
                                const options = {
                                    method: 'HEAD',
                                    timeout: 5000,
                                    // Don't follow redirects automatically
                                    maxRedirects: 0
                                };
                                
                                let currentUrl = urlData.redirectUrl;
                                let redirectCount = 0;
                                const maxRedirects = 5;
                                
                                const followRedirect = (url) => {
                                    if (redirectCount >= maxRedirects) {
                                        console.log(`✅ Resolved (max redirects): ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: currentUrl,
                                            title: urlData.title
                                        });
                                        return;
                                    }
                                    
                                    const parsed = new URL(url);
                                    const module = parsed.protocol === 'https:' ? https : http;
                                    
                                    const req = module.request(url, options, (res) => {
                                        // Check if redirect
                                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                            redirectCount++;
                                            // Handle relative redirects
                                            const newUrl = res.headers.location.startsWith('http') 
                                                ? res.headers.location 
                                                : new URL(res.headers.location, url).href;
                                            currentUrl = newUrl;
                                            followRedirect(newUrl);
                                        } else {
                                            // Final destination
                                            console.log(`✅ Resolved: ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                                            resolve({
                                                uri: currentUrl,
                                                title: urlData.title
                                            });
                                        }
                                    });
                                    
                                    req.on('error', (error) => {
                                        console.warn(`⚠️ Failed to resolve redirect for ${urlData.title}: ${error.message}`);
                                        console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: urlData.redirectUrl,
                                            title: urlData.title
                                        });
                                    });
                                    
                                    req.on('timeout', () => {
                                        req.destroy();
                                        console.warn(`⚠️ Timeout resolving redirect for ${urlData.title}`);
                                        console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: urlData.redirectUrl,
                                            title: urlData.title
                                        });
                                    });
                                    
                                    req.end();
                                };
                                
                                followRedirect(currentUrl);
                            } catch (error) {
                                console.warn(`⚠️ Error resolving redirect for ${urlData.title}: ${error.message}`);
                                console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                resolve({
                                    uri: urlData.redirectUrl,
                                    title: urlData.title
                                });
                            }
                        });
                    })
                );
                
                // Remove any hallucinated URLs from Gemini's text
                // Gemini sometimes generates fake YouTube URLs or other links
                const urlRegex = /(https?:\/\/[^\s)<]+)/g;
                const foundUrls = text.match(urlRegex) || [];
                
                if (foundUrls.length > 0) {
                    console.log(`🔍 Found ${foundUrls.length} URLs in text, removing hallucinated ones...`);
                    
                    // Remove URLs that are likely hallucinated (not from grounding)
                    text = text.replace(urlRegex, '');
                    text = text.replace(/\s+/g, ' ').trim();
                }
                
                // Append resolved URLs directly (without "מקורות:" header to avoid duplication)
                // Gemini already includes links in the text via grounding
                const sourcesText = realUrls
                    .map((urlData) => urlData.uri)
                    .join('\n');
                
                text = `${text}\n${sourcesText}`;
                console.log(`✅ Appended ${realUrls.length} resolved URLs`);
            }
        }
        
        // Fix URLs with parentheses - Gemini sometimes wraps URLs in parentheses
        // or uses Markdown link syntax [text](url)
        // Example: "הנה השיר (https://youtube.com/...)" becomes broken in WhatsApp
        
        // 1. Convert Markdown links [text](url) to plain text with URL
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1: $2');
        
        // 2. Add space between URL and closing parenthesis to prevent WhatsApp from including ) in URL
        text = text.replace(/(\bhttps?:\/\/[^\s)]+)\)/g, '$1 )');
        
        // 3. Add space between opening parenthesis and URL
        text = text.replace(/\((\bhttps?:\/\/[^\s)]+)/g, '( $1');
        
        // 4. Detect suspicious YouTube URLs (likely hallucinated)
        // YouTube video IDs are exactly 11 characters (alphanumeric, -, _)
        // If we find a YouTube URL with a suspicious ID, log a warning
        if (useGoogleSearch) {
            const youtubeUrls = text.match(/https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([^\s&)]+)/g);
            if (youtubeUrls) {
                youtubeUrls.forEach(url => {
                    const videoIdMatch = url.match(/(?:watch\?v=|youtu\.be\/)([^\s&)]+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        const videoId = videoIdMatch[1];
                        // YouTube video IDs should be 11 characters
                        if (videoId.length < 10 || videoId.length > 12) {
                            console.warn(`⚠️ Suspicious YouTube URL detected (ID length: ${videoId.length}): ${url}`);
                            console.warn(`   This URL might be hallucinated by Gemini!`);
                        }
                        // Check for obvious hallucination patterns (e.g., "abc123", "example", "xxx")
                        if (/^(abc|test|example|xxx|demo|sample)/i.test(videoId)) {
                            console.warn(`⚠️ Likely hallucinated YouTube URL detected: ${url}`);
                            console.warn(`   Video ID "${videoId}" looks fake!`);
                        }
                    }
                });
            }
        }
        
        // Detect various thinking/reasoning patterns that should be removed
        const hasThinkingPattern = 
            text.includes('SPECIAL INSTRUCTION:') || 
            text.includes('Think step-by-step') ||
            text.startsWith('THOUGHT') ||
            /^THOUGHT\s/m.test(text) || // THOUGHT at start of a line
            text.includes('*Drafting the response:*') ||
            text.includes('This response:') ||
            text.includes('As an AI, I should:') ||
            text.includes('My response should:') ||
            text.includes('Let\'s break down') ||
            text.includes('The user is essentially asking') ||
            (text.includes('translates to') && text.includes('In the context of')) ||
            text.startsWith('If I were to') || // Chain of thought reasoning
            (text.includes('However, as an AI') || text.includes('However, from a technical perspective')) ||
            text.includes('Let\'s consider the implications') ||
            text.includes('Given the instructions to be');
        
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
                    line.includes('This response:') ||
                    line.includes('As an AI, I should:') ||
                    line.includes('My response should:') ||
                    line.includes('The user is essentially asking') ||
                    line.includes('translates to') ||
                    line.includes('Let\'s break down') ||
                    line.includes('In the context of') ||
                    line.startsWith('If I were to') ||
                    line.includes('However, as an AI') ||
                    line.includes('However, from a technical perspective') ||
                    line.includes('Let\'s consider the implications') ||
                    line.includes('Given the instructions')) {
                    inThinkingSection = true;
                    continue;
                }
                
                // Skip lines that look like internal reasoning
                if (inThinkingSection && (
                    line.startsWith('*') && line.endsWith('*') || // Markdown emphasis for meta-comments
                    line.match(/^\d+\.\s+\*.*\*:/) || // Numbered list with emphasized headers
                    line.match(/^\d+\.\s+/) || // Any numbered list during thinking
                    line.startsWith('-   ') || // Bullet points with extra spacing (markdown)
                    line.includes('The user is') ||
                    line.includes('My current instruction') ||
                    line.includes('Let\'s consider') ||
                    line.includes('I should') ||
                    line.includes('I cannot') ||
                    line.includes('I must') ||
                    line.includes('refers to') ||
                    line.includes('meaning is'))) {
                    continue;
                }
                
                // If we find a line that looks like actual content (Hebrew/English text, reasonable length)
                // and doesn't have meta-markers, consider it the start of the answer
                // Additional check: line should start with actual content, not analysis/meta-discussion
                const looksLikeMetaDiscussion = 
                    line.includes('translates to') ||
                    line.includes('refers to') ||
                    line.includes('means') ||
                    line.includes('can mean') ||
                    line.includes('evokes') ||
                    line.includes('Together, it') ||
                    line.includes('In the context') ||
                    line.includes('Given') ||
                    line.startsWith('The contrast is') ||
                    line.match(/^-\s+["'].*["']:/) || // Definition list format
                    line.match(/^".*".*:$/); // Quoted term with colon (definition)
                
                if (line.length > 0 && 
                    !line.startsWith('*') && 
                    !line.match(/^\d+\.\s+\*/) &&
                    !line.match(/^\d+\.\s+/) && // Skip numbered lists
                    !line.startsWith('-   ') && // Skip markdown bullets
                    !looksLikeMetaDiscussion &&
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
            } else {
                // Fallback: If mostly English text with Hebrew ending, extract Hebrew part
                const allLines = text.split('\n');
                const hebrewLines = [];
                let foundHebrewSection = false;
                
                // Hebrew character detection
                const hasHebrew = (str) => /[\u0590-\u05FF]/.test(str);
                
                // Scan from bottom up for Hebrew content
                for (let i = allLines.length - 1; i >= 0; i--) {
                    const line = allLines[i].trim();
                    if (!line) continue;
                    
                    if (hasHebrew(line)) {
                        hebrewLines.unshift(allLines[i]); // Keep original formatting
                        foundHebrewSection = true;
                    } else if (foundHebrewSection) {
                        // Stop when we hit English after finding Hebrew
                        break;
                    }
                }
                
                if (hebrewLines.length > 0 && hebrewLines.join('').length > 20) {
                    const hebrewAnswer = hebrewLines.join('\n').trim();
                    text = hebrewAnswer;
                    console.log(`🎯 Extracted Hebrew final answer from mixed response (${hebrewAnswer.length} chars)`);
                    console.log(`   Preview: ${hebrewAnswer.substring(0, 100)}...`);
                } else {
                    // Fallback: Try to find the last substantial paragraph that looks like a real answer
                    // Split by double newlines to get paragraphs
                    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
                    
                    // Look for the last paragraph that doesn't contain meta-discussion markers
                    for (let i = paragraphs.length - 1; i >= 0; i--) {
                        const para = paragraphs[i].trim();
                        
                        // Check if this paragraph looks like a real answer (not meta-discussion)
                        const isMetaParagraph = 
                            para.includes('As an AI') ||
                            para.includes('translates to') ||
                            para.includes('refers to') ||
                            para.includes('Let\'s break down') ||
                            para.includes('My response should') ||
                            para.match(/^\d+\.\s+\*/) || // Numbered list with emphasis
                            para.match(/^-\s+["'].*["']:/) || // Definition list
                            para.startsWith('THOUGHT');
                        
                        if (!isMetaParagraph && para.length > 20) {
                            finalAnswer = para;
                            console.log('🎯 Found final answer paragraph (fallback method)');
                            console.log(`   Preview: ${finalAnswer.substring(0, 100)}...`);
                            text = finalAnswer;
                            break;
                        }
                    }
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
        // First, try simple regex detection for common patterns (fast and reliable)
        // Hebrew patterns: כולל וידאו, עם וידאו, גם וידאו, כולל קליפ, עם קליפ, וידאו, קליפ
        // English patterns: with video, and video, plus video, with clip, and clip, video, clip
        const videoPatterns = /\b(with|and|plus|including|include)\s+(video|clip)\b|כולל\s+(וידאו|קליפ)|עם\s+(וידאו|קליפ)|גם\s+(וידאו|קליפ)|ועם\s+(וידאו|קליפ)|\bvideo\s*clip\b|\bmusic\s*video\b/i;
        
        const regexMatch = videoPatterns.test(prompt);
        
        if (regexMatch) {
            console.log('🎬 Video requested with music');
            // Clean the prompt by removing video/clip mentions
            const cleanPrompt = prompt
                .replace(/\s*(with|and|plus|including|include)\s+(video|clip)\s*/gi, ' ')
                .replace(/\s*כולל\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*עם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*גם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*ועם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*video\s*clip\s*/gi, ' ')
                .replace(/\s*music\s*video\s*/gi, ' ')
                .trim()
                .replace(/\s+/g, ' '); // normalize spaces
            
            return {
                wantsVideo: true,
                cleanPrompt: cleanPrompt || prompt
            };
        }
        
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
1. If user explicitly requests video or clip (e.g., "with video", "כולל וידאו", "עם וידאו", "גם וידאו", "plus video", "and video", "ועם וידאו", "קליפ", "כולל קליפ", "עם קליפ", "clip", "with clip", "video clip", "music video"), set wantsVideo=true
2. Extract the actual music description (without the video/clip instruction)
3. Keep the cleanPrompt focused on music style, theme, mood, lyrics topic
4. If no video/clip is mentioned, set wantsVideo=false and keep original prompt
5. IMPORTANT: The presence of other words (like "Suno", "בעזרת", "באמצעות") should NOT affect video detection - focus ONLY on video/clip keywords

Examples:
Input: "צור שיר בסגנון רוק על אהבה כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר בסגנון רוק על אהבה"}

Input: "צור שיר על הכלב דובי בעזרת Suno, כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר על הכלב דובי בעזרת Suno"}

Input: "create a pop song about summer with video"
Output: {"wantsVideo":true,"cleanPrompt":"create a pop song about summer"}

Input: "שיר עצוב על פרידה עם קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר עצוב על פרידה"}

Input: "שיר רומנטי כולל קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר רומנטי"}

Input: "make a rock song with clip"
Output: {"wantsVideo":true,"cleanPrompt":"make a rock song"}

Input: "make a song with Suno and video"
Output: {"wantsVideo":true,"cleanPrompt":"make a song with Suno"}

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
        
        if (parsed.wantsVideo) {
            console.log('🎬 Video requested with music (LLM detected)');
        }
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

/**
 * Generate a creative poll with optional rhyming options
 * @param {string} topic - Poll topic (e.g., "חתולים", "כלבים", "פיצה")
 * @param {boolean} withRhyme - Whether options should rhyme (default: true)
 * @returns {Object} - Poll data with question and options
 */
async function generateCreativePoll(topic, withRhyme = true) {
    try {
        console.log(`📊 Generating creative poll about: ${topic} ${withRhyme ? '(with rhyme)' : '(without rhyme)'}`);
        
        const cleanTopic = sanitizeText(topic);
        
        // Randomly choose number of options (2-4)
        const crypto = require('crypto');
        const numOptions = crypto.randomInt(2, 5); // 2, 3, or 4
        console.log(`🎲 Randomly selected ${numOptions} poll options`);
        
        // Create prompt based on rhyming preference
        let pollPrompt;
        
        if (withRhyme) {
            pollPrompt = `אתה יוצר סקרים יצירתיים ומשעשעים בעברית עם חריזה מושלמת.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. ⭐ חשוב ביותר: כל התשובות חייבות לחרוז זו עם זו בחריזה מושלמת! ⭐
4. החריזה חייבת להיות בסוף כל תשובה (המילה האחרונה)
5. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
6. התשובות צריכות להיות קשורות לנושא
7. התשובות חייבות להיות משעשעות ויצירתיות

דוגמאות לחרוזים מושלמים:
- נושא: חתולים (2 תשובות)
  שאלה: "מה היית מעדיפ/ה?"
  תשובה 1: "חתול כועס"
  תשובה 2: "נמר לועס"
  (חרוז: כועס / לועס)

- נושא: כלבים (3 תשובות)
  שאלה: "איזה כלב הכי טוב?"
  תשובה 1: "גולדן רטריבר נהדר"
  תשובה 2: "ביגל קטן ויפה בחדר"
  תשובה 3: "פודל לבן שמתגבר"
  (חרוז: נהדר / בחדר / מתגבר)

- נושא: פיצה (4 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "פיצה עם זיתים"
  תשובה 2: "פלאפל עם חומוס שלמים"
  תשובה 3: "בורקס במילוי עשיר ושמנים"
  תשובה 4: "שווארמה עם בצל וחצילים"
  (חרוז: זיתים / שלמים / שמנים / חצילים)

- נושא: קפה (2 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "עם חלב וסוכר"
  תשובה 2: "שחור וחזק כמו נמר"
  (חרוז: סוכר / נמר)

חוקים קפדניים:
⭐ החרוז חייב להיות מושלם - המילה האחרונה בכל תשובה חייבת לחרוז!
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- כל התשובות (${numOptions}) חייבות לחרוז ביחד!

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
        } else {
            pollPrompt = `אתה יוצר סקרים יצירתיים ומשעשעים בעברית.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
4. התשובות צריכות להיות קשורות לנושא
5. התשובות חייבות להיות משעשעות, יצירתיות, ומעניינות
6. ⭐ חשוב: התשובות לא צריכות לחרוז! ⭐

דוגמאות ללא חריזה:
- נושא: חתולים (2 תשובות)
  שאלה: "איזה חתול היית מעדיפ/ה?"
  תשובה 1: "חתול פרסי רך ונחמד"
  תשובה 2: "חתול רחוב עצמאי ופראי"

- נושא: פיצה (3 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "מרגריטה קלאסית"
  תשובה 2: "פפרוני עם גבינה"
  תשובה 3: "ירקות טריים ובריאים"

- נושא: קפה (4 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "אספרסו חזק"
  תשובה 2: "קפוצ'ינו מוקצף"
  תשובה 3: "לאטה עם חלב שקדים"
  תשובה 4: "קר עם קרח"

חוקים קפדניים:
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- התשובות לא צריכות לחרוז (זה חשוב!)

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
        }

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const result = await model.generateContent(pollPrompt);
        
        if (!result.response) {
            throw new Error('No response from Gemini');
        }
        
        const responseText = result.response.text();
        
        // Try to extract JSON from response
        let jsonText = responseText.trim();
        
        // If wrapped in code fences, strip them
        const fenceMatch = jsonText.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
        if (fenceMatch && fenceMatch[1]) {
            jsonText = fenceMatch[1].trim();
        }
        
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('❌ Failed to parse Gemini poll response:', jsonText);
            throw new Error('Failed to parse poll data from Gemini');
        }
        
        // Validate the response
        if (!parsed.question || !parsed.options || !Array.isArray(parsed.options)) {
            throw new Error('Invalid poll data structure from Gemini');
        }
        
        // Validate number of options (must be between 2-4 and match what we requested)
        if (parsed.options.length < 2 || parsed.options.length > 4) {
            throw new Error(`Invalid number of options: ${parsed.options.length} (expected ${numOptions})`);
        }
        
        // Ensure limits
        if (parsed.question.length > 255) {
            parsed.question = parsed.question.substring(0, 252) + '...';
        }
        
        // Truncate each option if needed
        parsed.options = parsed.options.map(opt => {
            if (opt.length > 100) {
                return opt.substring(0, 97) + '...';
            }
            return opt;
        });
        
        console.log(`✅ Poll generated successfully with ${parsed.options.length} ${withRhyme ? 'rhyming' : 'non-rhyming'} options:`);
        console.log(`   Question: "${parsed.question}"`);
        parsed.options.forEach((opt, idx) => {
            console.log(`   Option ${idx + 1}: "${opt}"`);
        });
        
        return {
            success: true,
            question: parsed.question,
            options: parsed.options,
            numOptions: parsed.options.length
        };
        
    } catch (err) {
        console.error('❌ Poll generation error:', err);
        return {
            success: false,
            error: err.message || 'Failed to generate poll'
        };
    }
}

/**
 * Get location information using Google Maps grounding
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Object} - Location information
 */
async function getLocationInfo(latitude, longitude) {
    try {
        console.log(`🗺️ Getting location info for: ${latitude}, ${longitude}`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        // HYBRID APPROACH:
        // 1. Try Google Maps Grounding first (best for populated areas)
        // 2. If it fails or returns unhelpful response, fallback to general Gemini knowledge
        
        let text = '';
        let usedMapsGrounding = false;
        
        try {
            console.log('🗺️ Trying Google Maps Grounding first...');
            const mapsPrompt = `תאר את המיקום בקואורדינטות: קו רוחב ${latitude}°, קו אורך ${longitude}°.
            
באיזו עיר או אזור זה נמצא? באיזו מדינה? מה מעניין או מפורסם במקום הזה?

תשובה קצרה ומעניינת בעברית (2-3 שורות).`;

            const mapsResult = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: mapsPrompt }] }],
                tools: [{
                    googleMaps: {}
                }],
                toolConfig: {
                    retrievalConfig: {
                        latLng: {
                            latitude: latitude,
                            longitude: longitude
                        }
                    }
                }
            });
            
            const mapsResponse = mapsResult.response;
            if (mapsResponse.candidates && mapsResponse.candidates.length > 0) {
                text = mapsResponse.text();
                
                // Check if Maps Grounding gave a useful answer
                // If it asks for more info or says it needs a specific location, it means no data
                const unhelpfulPatterns = [
                    'אני זקוק למיקום',
                    'אני צריך מיקום',
                    'איזה מיקום',
                    'איזה מקום',
                    'ספק את שם',
                    'ספק שם',
                    'ספקי את',
                    'ספק לי פרטים',
                    'ספקו פרטים',
                    'כדי שאוכל לתאר',
                    'כדי לתאר',
                    'אנא ספק',
                    'לא צוין מיקום',
                    'לא צוינה',
                    'לא ניתן מיקום',
                    'I need a location',
                    'I need more information',
                    'which location',
                    'which place',
                    'provide the location',
                    'provide the place',
                    'provide a location',
                    'provide more details',
                    'provide details',
                    'not specified',
                    'no location specified',
                    'location not specified',
                    'אנא ציין',
                    'please specify',
                    'לא ברור',
                    'unclear',
                    'לא יכול לתאר',
                    'cannot describe'
                ];
                
                const isUnhelpful = unhelpfulPatterns.some(pattern => 
                    text.toLowerCase().includes(pattern.toLowerCase())
                );
                
                if (!isUnhelpful && text.trim().length > 20) {
                    console.log('✅ Google Maps Grounding provided useful info');
                    usedMapsGrounding = true;
                } else {
                    console.log('⚠️ Google Maps Grounding response not useful, falling back to general knowledge...');
                    text = ''; // Reset for fallback
                }
            }
        } catch (mapsError) {
            console.log(`⚠️ Google Maps Grounding failed: ${mapsError.message}, falling back to general knowledge...`);
            text = ''; // Reset for fallback
        }
        
        // Fallback: Use Gemini's general geographic knowledge
        if (!text || text.trim().length === 0) {
            console.log('🌍 Using Gemini general geographic knowledge...');
            const generalPrompt = `תאר את המיקום הגיאוגרפי: קו רוחב ${latitude}°, קו אורך ${longitude}°.

ספר בקצרה (2-3 שורות):
- באיזו מדינה, אזור או אוקיינוס זה נמצא
- מה האקלים והטבע של האזור
- אם יש שם משהו מעניין או מפורסם, ציין את זה

תשובה מעניינת בעברית.`;

            const generalResult = await model.generateContent(generalPrompt);
            const generalResponse = generalResult.response;
            
            if (!generalResponse.candidates || generalResponse.candidates.length === 0) {
                console.log('❌ Gemini: No candidates returned');
                return { 
                    success: false, 
                    error: 'No response from Gemini' 
                };
            }
            
            text = generalResponse.text();
        }
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini: Empty text response');
            return { 
                success: false, 
                error: 'Empty response from Gemini' 
            };
        }
        
        // CRITICAL: Clean JSON/snippets from response if Gemini accidentally returned structured data
        // Sometimes Gemini returns JSON with "snippets" and "link" instead of plain text
        text = text.trim();
        
        // Remove JSON blocks (```json ... ``` or naked JSON objects)
        if (text.includes('"snippets"') || text.includes('"link"') || (text.startsWith('{') && text.endsWith('}'))) {
            console.warn('⚠️ Detected JSON in location description, cleaning...');
            
            // Try to extract just the text content from JSON
            try {
                // Remove markdown code blocks
                let cleanText = text.replace(/```json?\s*|\s*```/g, '');
                
                // Try to parse as JSON
                const jsonData = JSON.parse(cleanText);
                
                // Extract meaningful text fields (not snippets or links)
                if (jsonData.description) {
                    text = jsonData.description;
                } else if (jsonData.text) {
                    text = jsonData.text;
                } else if (jsonData.answer) {
                    text = jsonData.answer;
                } else {
                    // Fallback: extract any long string values (likely the description)
                    for (const key in jsonData) {
                        if (typeof jsonData[key] === 'string' && jsonData[key].length > 30 && 
                            key !== 'link' && key !== 'snippets') {
                            text = jsonData[key];
                            break;
                        }
                    }
                }
                
                console.log(`✅ Cleaned JSON, extracted text: ${text.substring(0, 80)}...`);
            } catch (err) {
                // If JSON parsing fails, remove JSON-like patterns
                console.warn(`⚠️ Could not parse JSON, removing patterns: ${err.message}`);
                text = text
                    .replace(/\{[^}]*"snippets"[^}]*\}/g, '')
                    .replace(/\{[^}]*"link"[^}]*\}/g, '')
                    .replace(/```json?\s*[\s\S]*?\s*```/g, '')
                    .trim();
            }
        }
        
        // Final validation: ensure we still have meaningful text
        if (!text || text.length < 10) {
            text = `מיקום: קו רוחב ${latitude}°, קו אורך ${longitude}°`;
        }
        
        console.log(`✅ Location info retrieved (${usedMapsGrounding ? 'Maps Grounding' : 'General Knowledge'}): ${text.substring(0, 100)}...`);
        
        return {
            success: true,
            description: text,
            latitude: latitude,
            longitude: longitude,
            usedMapsGrounding: usedMapsGrounding
        };
        
    } catch (err) {
        console.error('❌ Gemini error:', err);
        return { 
            success: false, 
            error: err.message || 'Failed to get location info' 
        };
    }
}

/**
 * Get bounds for a city/location name using Google Maps Geocoding
 * Optimized to get accurate bounds and handle various city sizes
 * @param {string} locationName - City or location name (e.g., "תל אביב", "ירושלים", "Barcelona")
 * @returns {Promise<Object|null>} - {minLat, maxLat, minLng, maxLng, foundName, country} or null if not found
 */
async function getLocationBounds(locationName) {
    try {
        console.log(`🔍 Getting bounds for location: "${locationName}"`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        // Improved prompt: request location name, country AND coordinates for validation
        const geocodePrompt = `מצא את המקום הבא ב-Google Maps וחזור עם המידע הגיאוגרפי המדויק שלו:

שם המקום שהמשתמש ביקש: ${locationName}

החזר JSON בלבד בפורמט הבא:
{
  "found_name": "שם המקום המלא שנמצא (כולל עיר ומדינה, לדוגמה: Tel Aviv, Israel)",
  "city": "שם העיר בלבד",
  "country": "שם המדינה",
  "latitude": מספר קו רוחב (נקודת מרכז),
  "longitude": מספר קו אורך (נקודת מרכז),
  "viewport": {
    "north": מספר (קו רוחב מקסימלי),
    "south": מספר (קו רוחב מינימלי),
    "east": מספר (קו אורך מקסימלי),
    "west": מספר (קו אורך מינימלי)
  },
  "type": "city/country/region",
  "found": true/false
}

חשוב מאוד:
- וודא שהמקום שמצאת תואם למה שהמשתמש ביקש
- אם המשתמש ביקש "תל אביב", אל תחזיר "טוקיו"
- אם יש viewport/bounds ב-Google Maps, השתמש בהם (מדויק יותר)
- אם אין viewport, השתמש בקואורדינטות המרכז בלבד
- וודא שהקואורדינטות בתוך הטווחים התקפים: קו רוחב בין -90 ל-90, קו אורך בין -180 ל-180
- אם לא מצאת את המקום או יש אי-התאמה, החזר {"found": false}`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: geocodePrompt }] }]
            // Note: Using Gemini's general knowledge + Google Search grounding (automatic)
            // Google Maps tool requires specific toolConfig which isn't suitable for geocoding by name
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log(`❌ No response for location: ${locationName}`);
            return null;
        }
        
        const text = response.text();
        console.log(`📍 Geocoding response for "${locationName}": ${text.substring(0, 200)}`);
        
        // Try to parse JSON from response with improved extraction
        let locationData = null;
        try {
            // First try: Extract JSON (might have markdown code blocks like ```json ... ```)
            let jsonText = text;
            
            // Remove markdown code blocks if present
            const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonText = codeBlockMatch[1];
            } else {
                // Extract JSON object
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonText = jsonMatch[0];
                }
            }
            
            locationData = JSON.parse(jsonText);
        } catch (parseErr) {
            console.warn(`⚠️ Could not parse JSON from geocoding response:`, parseErr.message);
            // Fallback: Try to extract coordinates and bounds from text using regex
            const latMatch = text.match(/latitude[":\s]+(-?[0-9.]+)/i);
            const lngMatch = text.match(/longitude[":\s]+(-?[0-9.]+)/i);
            
            // Try to extract viewport if available
            const northMatch = text.match(/north[":\s]+(-?[0-9.]+)/i);
            const southMatch = text.match(/south[":\s]+(-?[0-9.]+)/i);
            const eastMatch = text.match(/east[":\s]+(-?[0-9.]+)/i);
            const westMatch = text.match(/west[":\s]+(-?[0-9.]+)/i);
            
            if (latMatch && lngMatch) {
                locationData = {
                    latitude: parseFloat(latMatch[1]),
                    longitude: parseFloat(lngMatch[1]),
                    found: true
                };
                
                // If viewport found, add it
                if (northMatch && southMatch && eastMatch && westMatch) {
                    locationData.viewport = {
                        north: parseFloat(northMatch[1]),
                        south: parseFloat(southMatch[1]),
                        east: parseFloat(eastMatch[1]),
                        west: parseFloat(westMatch[1])
                    };
                }
            }
        }
        
        if (!locationData || !locationData.found) {
            console.log(`❌ Location not found: ${locationName}`);
            return null;
        }
        
        // Extract metadata
        const foundName = locationData.found_name || locationData.city || locationName;
        const city = locationData.city || null;
        const country = locationData.country || null;
        const locationType = locationData.type || 'unknown';
        
        // VALIDATION: Check if found location name reasonably matches requested name
        // This prevents cases like requesting "Tel Aviv" and getting "Tokyo"
        const requestedLower = locationName.toLowerCase().trim();
        const foundLower = foundName.toLowerCase().trim();
        const cityLower = (city || '').toLowerCase().trim();
        
        // Check if there's a reasonable match (contains, starts with, or similar)
        const isReasonableMatch = 
            foundLower.includes(requestedLower) || 
            requestedLower.includes(foundLower) ||
            cityLower.includes(requestedLower) ||
            requestedLower.includes(cityLower) ||
            // Allow some flexibility for translations/variations
            (requestedLower.length >= 3 && foundLower.slice(0, 3) === requestedLower.slice(0, 3));
        
        if (!isReasonableMatch) {
            console.warn(`⚠️ Location mismatch: requested "${locationName}" but got "${foundName}". Rejecting.`);
            return null;
        }
        
        console.log(`✅ Location validation passed: requested "${locationName}" → found "${foundName}" (${country || 'unknown country'})`);
        
        // Validate coordinates
        const centerLat = parseFloat(locationData.latitude);
        const centerLng = parseFloat(locationData.longitude);
        
        if (isNaN(centerLat) || isNaN(centerLng) || 
            centerLat < -90 || centerLat > 90 || 
            centerLng < -180 || centerLng > 180) {
            console.log(`❌ Invalid coordinates for "${locationName}": lat=${centerLat}, lng=${centerLng}`);
            return null;
        }
        
        // If viewport/bounds are available, use them (most accurate)
        if (locationData.viewport && 
            locationData.viewport.north && locationData.viewport.south &&
            locationData.viewport.east && locationData.viewport.west) {
            
            const bounds = {
                minLat: Math.min(locationData.viewport.south, locationData.viewport.north),
                maxLat: Math.max(locationData.viewport.south, locationData.viewport.north),
                minLng: Math.min(locationData.viewport.west, locationData.viewport.east),
                maxLng: Math.max(locationData.viewport.west, locationData.viewport.east),
                foundName,
                city,
                country,
                type: locationType
            };
            
            // Validate bounds
            if (bounds.minLat >= -90 && bounds.maxLat <= 90 && 
                bounds.minLng >= -180 && bounds.maxLng <= 180 &&
                bounds.minLat < bounds.maxLat && bounds.minLng < bounds.maxLng) {
                console.log(`✅ Found viewport bounds for "${locationName}" (${foundName}): ${JSON.stringify({minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng})}`);
                return bounds;
            }
        }
        
        // Fallback: Calculate bounds from center point with dynamic radius based on city size
        // Use smaller radius for better precision (covers most cities well)
        // Adjust radius slightly based on latitude (longitude degrees are shorter near poles)
        const baseRadius = 0.4; // ~44km at equator, smaller for better precision
        const latAdjustment = Math.cos(centerLat * Math.PI / 180); // Adjust for longitude spacing
        
        const bounds = {
            minLat: Math.max(-90, centerLat - baseRadius),
            maxLat: Math.min(90, centerLat + baseRadius),
            minLng: Math.max(-180, centerLng - (baseRadius / latAdjustment)),
            maxLng: Math.min(180, centerLng + (baseRadius / latAdjustment)),
            foundName,
            city,
            country,
            type: locationType
        };
        
        console.log(`✅ Found center-point bounds for "${locationName}" (${foundName}): ${JSON.stringify({minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng})}`);
        return bounds;
        
    } catch (err) {
        console.error(`❌ Error getting bounds for "${locationName}":`, err.message);
        console.error(`   Stack: ${err.stack}`);
        return null;
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
    translateText,
    generateCreativePoll,
    getLocationInfo,
    getLocationBounds,
    cleanThinkingPatterns  // Export for use in other services
};
