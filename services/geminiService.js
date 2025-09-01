const { GoogleGenerativeAI, GenerateContentConfig } = require('@google/generative-ai');
const genai = require('@google/genai');
const { sanitizeText } = require('../utils/textSanitizer');

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
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
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
            return { error: { message: 'No image data found in response', code: 'NO_IMAGE_DATA', provider: 'gemini' } };
        }
        
        console.log('✅ Gemini image generated successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
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
            return { error: { message: 'No image data found in response', code: 'NO_IMAGE_DATA', provider: 'gemini-edit' } };
        }
        
        console.log('✅ Gemini image edited successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function generateVideoWithText(prompt) {
    try {
        const fs = require('fs');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');
        console.log('🎬 Starting Veo 3 text-to-video generation');
        const cleanPrompt = sanitizeText(prompt);
        
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.0-generate-preview",
            prompt: cleanPrompt,
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 text-to-video generation timed out');
                return { error: { message: 'Video generation timed out after 10 minutes', code: 'TIMEOUT', provider: 'gemini' } };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 text-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
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
            return { error: { message: `Failed to download video file: ${downloadError.message}`, code: 'DOWNLOAD_FAILED', provider: 'gemini' } };
        }
        
        // בדיקה שהקובץ נוצר ושלם
        let retries = 0;
        let fileReady = false;
        
        while (!fileReady && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            if (fs.existsSync(tempFilePath)) {
                try {
                    const stats = fs.statSync(tempFilePath);
                    
                    // בדיקה שהקובץ לא ריק ושהוא יציב (גודל לא משתנה)
                    if (stats.size > 0) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const newStats = fs.statSync(tempFilePath);
                        
                        if (newStats.size === stats.size && stats.size > 10000) { // לפחות 10KB
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
            return { error: { message: 'Video file was not downloaded successfully', code: 'NO_FILE', provider: 'gemini' } };
        }
        
        // לא מוחקים את הקובץ, כי צריך לינק להורדה
        // מחזירים רק buffer ו-text, הלינק הציבורי ייבנה ב-finalizeTask
        console.log('✅ Veo 3 text-to-video generated successfully.');
        return {
            text: cleanPrompt,
            videoBuffer: fs.readFileSync(tempFilePath)
        };
    } catch (err) {
        console.error('❌ Veo 3 text-to-video generation error:', err);
        return { error: { message: err.message || 'Unknown error', code: 'GENERIC_ERROR', provider: 'gemini' } };
    }
}

async function generateVideoWithImage(prompt, imageBuffer) {
    try {
        const fs = require('fs');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');
        console.log('🎬 Starting Veo 3 image-to-video generation');
        
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert image buffer to base64 string as expected by the API
        const imageBase64 = imageBuffer.toString('base64');
        
        // Step 1: Generate video with Veo 3 using the provided image
        let operation = await veoClient.models.generateVideos({
            model: "veo-3.0-generate-preview",
            prompt: cleanPrompt,
            image: {
                imageBytes: imageBase64,
                mimeType: "image/png",
            },
        });
        
        console.log('⏳ Polling for video generation completion...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        while (!operation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 image-to-video generation timed out');
                return { error: { message: 'Video generation timed out after 10 minutes', code: 'TIMEOUT', provider: 'gemini' } };
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 image-to-video generation`);
            operation = await veoClient.operations.getVideosOperation({ operation });
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
            return { error: { message: `Failed to download video file: ${downloadError.message}`, code: 'DOWNLOAD_FAILED', provider: 'gemini' } };
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
            return { error: { message: 'Video file was not downloaded successfully', code: 'NO_FILE', provider: 'gemini' } };
        }
        
        console.log('✅ Veo 3 image-to-video generated successfully.');
        return {
            text: cleanPrompt,
            videoBuffer: fs.readFileSync(tempFilePath)
        };
    } catch (err) {
        console.error('❌ Veo 3 image-to-video generation error:', err);
        return { error: { message: err.message || 'Unknown error', code: 'GENERIC_ERROR', provider: 'gemini' } };
    }
}

module.exports = { generateImageWithText, editImageWithText, generateVideoWithText, generateVideoWithImage };
