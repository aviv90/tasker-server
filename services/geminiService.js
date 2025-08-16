const { GoogleGenerativeAI, GenerateContentConfig } = require('@google/generative-ai');
const { sanitizeText } = require('../utils/textSanitizer');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-preview-image-generation" 
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
            return { error: 'No image data found in response' };
        }
        
        console.log('✅ Gemini image generated successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err.message);
        
        // Handle specific Gemini error types
        if (err.message.includes('SAFETY')) {
            return { error: 'Content rejected by safety filters. Please try a different description.' };
        } else if (err.message.includes('QUOTA_EXCEEDED')) {
            return { error: 'API quota exceeded. Please try again later.' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            return { error: 'Invalid request. Please check your prompt.' };
        } else if (err.status === 429) {
            return { error: 'Rate limit exceeded. Please try again later.' };
        }
        
        return { error: err.message || 'Image generation failed' };
    }
}

async function editImageWithText(prompt, base64Image) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-preview-image-generation" 
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
            return { error: 'No image data found in response' };
        }
        
        console.log('✅ Gemini image edited successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err.message);
        
        // Handle specific Gemini error types
        if (err.message.includes('SAFETY')) {
            return { error: 'Content rejected by safety filters. Please try a different image or description.' };
        } else if (err.message.includes('QUOTA_EXCEEDED')) {
            return { error: 'API quota exceeded. Please try again later.' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            return { error: 'Invalid image format or request. Please check your input.' };
        } else if (err.status === 429) {
            return { error: 'Rate limit exceeded. Please try again later.' };
        }
        
        return { error: err.message || 'Image editing failed' };
    }
}

module.exports = { generateImageWithText, editImageWithText };