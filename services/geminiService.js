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
        console.log('🎬 Starting Veo 3 text-to-video generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Use Veo 3 for highest quality video generation
        const operation = await veoClient.models.generateVideos({
            model: "veo-3.0-generate-preview",
            prompt: cleanPrompt,
            config: {
                aspectRatio: "9:16", // Portrait format for social media
                personGeneration: "allow_adult"
            }
        });

        console.log('⏳ Polling for video generation completion...');
        
        // Poll the operation status until the video is ready
        let currentOperation = operation;
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        
        while (!currentOperation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 text-to-video generation timed out');
                throw new Error('Video generation timed out after 10 minutes');
            }
            
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            currentOperation = await veoClient.operations.get(currentOperation);
        }

        // Download the generated video
        const generatedVideo = currentOperation.response.generated_videos[0];
        const videoBuffer = await veoClient.files.download(generatedVideo.video);
        
        console.log('✅ Veo 3 text-to-video generated successfully');
        return { 
            text: cleanPrompt, 
            videoBuffer: Buffer.from(videoBuffer)
        };
    } catch (err) {
        console.error('❌ Veo 3 text-to-video generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function generateVideoFromImage(prompt, imageBuffer) {
    try {
        console.log('🎬 Starting Veo 3 image-to-video generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert image buffer to base64
        const base64Image = imageBuffer.toString('base64');
        const imageData = `data:image/png;base64,${base64Image}`;
        
        // Use Veo 3 for highest quality image-to-video generation
        const operation = await veoClient.models.generateVideos({
            model: "veo-3.0-generate-preview",
            prompt: cleanPrompt,
            image: imageData,
            config: {
                aspectRatio: "9:16", // Portrait format for social media
                personGeneration: "allow_adult"
            }
        });

        console.log('⏳ Polling for image-to-video generation completion...');
        
        // Poll the operation status until the video is ready
        let currentOperation = operation;
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        
        while (!currentOperation.done) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Veo 3 image-to-video generation timed out');
                throw new Error('Image-to-video generation timed out after 10 minutes');
            }
            
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            currentOperation = await veoClient.operations.get(currentOperation);
        }

        // Download the generated video
        const generatedVideo = currentOperation.response.generated_videos[0];
        const videoBuffer = await veoClient.files.download(generatedVideo.video);
        
        console.log('✅ Veo 3 image-to-video generated successfully');
        return { 
            text: cleanPrompt, 
            videoBuffer: Buffer.from(videoBuffer)
        };
    } catch (err) {
        console.error('❌ Veo 3 image-to-video generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

module.exports = { generateImageWithText, editImageWithText, generateVideoWithText, generateVideoFromImage };