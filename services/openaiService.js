const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function generateImageWithText(prompt) {
    try {
        // Use gpt-image-1 which always returns base64
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: prompt,
            n: 1,
            quality: "high",
            output_format: "png"
            // Note: response_format is not supported for gpt-image-1 - it always returns base64
        });
        
        if (!response.data || response.data.length === 0) {
            return { error: 'No image generated' };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
            return { 
                text: revisedPrompt, 
                imageBuffer 
            };
        }
        
        return { error: 'No base64 image data found in response' };
    } catch (err) {
        console.error('❌ OpenAI text-to-image error:', err.message);
        return { error: err.message };
    }
}

async function editImageWithText(prompt, imageBuffer) {
    try {
        // Convert Buffer to File-like object for OpenAI API
        const imageFile = new File([imageBuffer], 'image.jpg', { type: 'image/jpeg' });
        
        const response = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: prompt,
            input_fidelity: "high",
            quality: "high",
            output_format: "png"
            // Note: gpt-image-1 always returns base64-encoded images
        });
        
        if (!response.data || response.data.length === 0) {
            return { error: 'No image generated' };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
            return { 
                text: revisedPrompt, 
                imageBuffer 
            };
        }
        
        return { error: 'No base64 image data found in response' };
    } catch (err) {
        console.error('❌ OpenAI image-edit error:', err.message);
        return { error: err.message };
    }
}

module.exports = { generateImageWithText, editImageWithText };
