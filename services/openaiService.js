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
        console.error('❌ OpenAI image generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
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
        console.error('❌ OpenAI image edit error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

/**
 * Generate text response using OpenAI Chat API
 * @param {string} prompt - User's input text
 * @param {Array} conversationHistory - Previous messages (for future context support)
 * @returns {Promise<{text: string, usage: object}>}
 */
async function generateTextResponse(prompt, conversationHistory = []) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // For now we'll send only the current message
    // Later we'll add conversationHistory support
    const messages = [
      {
        role: 'system',
        content: 'אתה עוזר AI ידידותי שמסוגל לענות בעברית ובאנגלית. תן תשובות מועילות וקצרות.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    console.log('🤖 Sending to OpenAI Chat:', prompt);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective and good model
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    const aiResponse = response.choices[0].message.content;
    const usage = response.usage;

    console.log('✅ OpenAI Chat response received');
    console.log('💰 Tokens used:', usage);

    return {
      text: aiResponse,
      usage: usage
    };

  } catch (error) {
    console.error('❌ Error generating OpenAI response:', error);
    
    // Emergency response
    return {
      text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך. נסה שוב מאוחר יותר.',
      usage: null
    };
  }
}

module.exports = { generateImageWithText, editImageWithText, generateTextResponse };
