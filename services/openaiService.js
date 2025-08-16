const OpenAI = require('openai');
const axios = require('axios');
const { sanitizeText } = require('../utils/textSanitizer');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting OpenAI image generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Use gpt-image-1 which always returns base64
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: cleanPrompt,
            n: 1,
            quality: "high",
            output_format: "png"
            // Note: response_format is not supported for gpt-image-1 - it always returns base64
        });
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI: No image generated');
            return { error: 'No image generated' };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
            console.log('✅ OpenAI image generated successfully');
            return { 
                text: revisedPrompt, 
                imageBuffer 
            };
        }
        
        console.log('❌ OpenAI: No base64 image data found');
        return { error: 'No base64 image data found in response' };
    } catch (err) {
        console.error('❌ OpenAI image generation error:', err.message);
        
        // Handle specific OpenAI error types
        if (err.status === 400) {
            if (err.message.includes('safety system')) {
                return { error: 'Content rejected by safety system. Please try a different description.' };
            }
            return { error: `Request error: ${err.message}` };
        } else if (err.status === 401) {
            return { error: 'Authentication failed. Please check API key.' };
        } else if (err.status === 429) {
            return { error: 'Rate limit exceeded. Please try again later.' };
        } else if (err.status === 500) {
            return { error: 'OpenAI server error. Please try again later.' };
        }
        
        return { error: err.message || 'Image generation failed' };
    }
}

async function editImageWithText(prompt, imageBuffer) {
    try {
        console.log('🖼️ Starting OpenAI image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert Buffer to File-like object for OpenAI API
        const imageFile = new File([imageBuffer], 'image.jpg', { type: 'image/jpeg' });
        
        const response = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: cleanPrompt,
            input_fidelity: "high",
            quality: "high",
            output_format: "png"
            // Note: gpt-image-1 always returns base64-encoded images
        });
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI edit: No image generated');
            return { error: 'No image generated' };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
            console.log('✅ OpenAI image edited successfully');
            return { 
                text: revisedPrompt, 
                imageBuffer 
            };
        }
        
        console.log('❌ OpenAI edit: No base64 image data found');
        return { error: 'No base64 image data found in response' };
    } catch (err) {
        console.error('❌ OpenAI image edit error:', err.message);
        
        // Handle specific OpenAI error types
        if (err.status === 400) {
            if (err.message.includes('safety system')) {
                return { error: 'Content rejected by safety system. Please try a different image or description.' };
            } else if (err.message.includes('invalid image')) {
                return { error: 'Invalid image format. Please use JPEG, PNG, or WebP format.' };
            }
            return { error: `Request error: ${err.message}` };
        } else if (err.status === 401) {
            return { error: 'Authentication failed. Please check API key.' };
        } else if (err.status === 429) {
            return { error: 'Rate limit exceeded. Please try again later.' };
        } else if (err.status === 500) {
            return { error: 'OpenAI server error. Please try again later.' };
        }
        
        return { error: err.message || 'Image editing failed' };
    }
}

module.exports = { generateImageWithText, editImageWithText };
