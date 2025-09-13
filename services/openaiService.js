const OpenAI = require('openai');
const axios = require('axios');
const { sanitizeText } = require('../utils/textSanitizer');
const { getStaticFileUrl } = require('../utils/urlUtils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
 * Generate text response using OpenAI Chat API with conversation history
 * @param {string} prompt - User's input text
 * @param {Array} conversationHistory - Previous messages in conversation
 * @returns {Promise<{text: string, usage: object}>}
 */
async function generateTextResponse(prompt, conversationHistory = []) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Build messages array with system prompt + conversation history + current message
    const messages = [
      {
        role: 'system',
        content: 'אתה עוזר AI מ-Green API שמשיב הודעות אוטומטיות. אתה מועיל, יצירתי, חכם ומאוד ידידותי. אתה תמיד נותן תשובה. אתה מסוגל לענות בעברית ובאנגלית ואתה זוכר את השיחה הקודמת.'
      }
    ];

    // Add conversation history if exists
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
      console.log(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: prompt
    });

    console.log(`🤖 Sending to OpenAI Chat: "${prompt}" (with ${conversationHistory.length} context messages)`);

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

async function generateImageForWhatsApp(prompt, req) {
    try {
        console.log('🎨 Starting OpenAI image generation (WhatsApp format)');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Use gpt-image-1 which always returns base64
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: cleanPrompt,
            n: 1,
            quality: "high",
            output_format: "png"
        });
        
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI: No image generated');
            return { 
                success: false, 
                error: 'No image generated' 
            };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || null;
        
        // OpenAI gpt-image-1 returns base64 data directly
        if (!imageData.b64_json) {
            console.log('❌ OpenAI: No base64 data found');
            return { 
                success: false, 
                error: 'No image data found' 
            };
        }
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        
        // Save to public directory
        const fileName = `openai_${uuidv4()}.png`;
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
        
        console.log('✅ OpenAI image generated successfully (WhatsApp format)');
        console.log(`🖼️ Image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: revisedPrompt || "", // Include revised prompt as description if available
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ OpenAI image generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image generation' 
        };
    }
}

async function editImageForWhatsApp(prompt, base64Image, req) {
    try {
        console.log('🖼️ Starting OpenAI image editing (WhatsApp format)');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Convert base64 to Buffer first
        const imageBuffer = Buffer.from(base64Image, 'base64');
        
        // Convert Buffer to File-like object for OpenAI API
        const imageFile = new File([imageBuffer], 'image.jpg', { type: 'image/jpeg' });
        
        const response = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: cleanPrompt,
            input_fidelity: "high",
            quality: "high",
            output_format: "png"
        });
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI edit: No image generated');
            return { 
                success: false, 
                error: 'No image generated' 
            };
        }
        
        const imageData = response.data[0];
        const revisedPrompt = imageData.revised_prompt || null;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (!imageData.b64_json) {
            console.log('❌ OpenAI edit: No base64 data found');
            return { 
                success: false, 
                error: 'No image data found' 
            };
        }
        
        // Convert base64 to buffer
        const editedImageBuffer = Buffer.from(imageData.b64_json, 'base64');
        
        // Save to public directory
        const fileName = `openai_edit_${uuidv4()}.png`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(filePath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Write image file
        fs.writeFileSync(filePath, editedImageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ OpenAI image edited successfully (WhatsApp format)');
        console.log(`🖼️ Edited image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: revisedPrompt || "", // Include revised prompt as description
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ OpenAI image edit error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image editing' 
        };
    }
}

module.exports = { generateImageWithText, editImageWithText, generateTextResponse, generateImageForWhatsApp, editImageForWhatsApp };
