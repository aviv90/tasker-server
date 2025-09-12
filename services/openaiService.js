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
        
        // Log response structure without base64 data to avoid flooding logs
        const responseForLog = JSON.parse(JSON.stringify(response, (key, value) => {
            if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                return `[BASE64_DATA_${value.length}_CHARS]`;
            }
            return value;
        }));
        console.log('🔍 OPENAI RAW RESPONSE (Tasker):', JSON.stringify(responseForLog, null, 2));
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI: No image generated');
            const responseDataForLog = JSON.parse(JSON.stringify(response, (key, value) => {
                if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                    return `[BASE64_DATA_${value.length}_CHARS]`;
                }
                return value;
            }));
            console.log('🔍 OPENAI RESPONSE DATA (Tasker):', JSON.stringify(responseDataForLog, null, 2));
            return { error: 'No image generated' };
        }
        
        const imageData = response.data[0];
        // Log image data structure without base64 data
        const imageDataForLog = JSON.parse(JSON.stringify(imageData, (key, value) => {
            if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                return `[BASE64_DATA_${value.length}_CHARS]`;
            }
            return value;
        }));
        console.log('🔍 OPENAI IMAGE DATA (Tasker):', JSON.stringify(imageDataForLog, null, 2));
        
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
            console.log('🖼️ OPENAI IMAGE BUFFER CREATED (Tasker): Buffer length =', imageBuffer.length);
            console.log('✅ OpenAI image generated successfully');
            return { 
                text: revisedPrompt, 
                imageBuffer 
            };
        }
        
        console.log('❌ OpenAI: No base64 image data found');
        const imageStructureForLog = JSON.parse(JSON.stringify(imageData, (key, value) => {
            if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                return `[BASE64_DATA_${value.length}_CHARS]`;
            }
            return value;
        }));
        console.log('🔍 OPENAI IMAGE DATA STRUCTURE (Tasker):', JSON.stringify(imageStructureForLog, null, 2));
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
        
        // Log response structure without base64 data to avoid flooding logs
        const responseForLog = JSON.parse(JSON.stringify(response, (key, value) => {
            if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                return `[BASE64_DATA_${value.length}_CHARS]`;
            }
            return value;
        }));
        console.log('🔍 OPENAI RAW RESPONSE (WhatsApp):', JSON.stringify(responseForLog, null, 2));
        
        if (!response.data || response.data.length === 0) {
            console.log('❌ OpenAI: No image generated');
            const responseDataForLog = JSON.parse(JSON.stringify(response, (key, value) => {
                if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                    return `[BASE64_DATA_${value.length}_CHARS]`;
                }
                return value;
            }));
            console.log('🔍 OPENAI RESPONSE DATA (WhatsApp):', JSON.stringify(responseDataForLog, null, 2));
            return { 
                success: false, 
                error: 'No image generated' 
            };
        }
        
        const imageData = response.data[0];
        // Log image data structure without base64 data
        const imageDataForLog = JSON.parse(JSON.stringify(imageData, (key, value) => {
            if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                return `[BASE64_DATA_${value.length}_CHARS]`;
            }
            return value;
        }));
        console.log('🔍 OPENAI IMAGE DATA (WhatsApp):', JSON.stringify(imageDataForLog, null, 2));
        
        // OpenAI gpt-image-1 returns base64 data directly
        if (!imageData.b64_json) {
            console.log('❌ OpenAI: No base64 data found');
            const imageStructureForLog = JSON.parse(JSON.stringify(imageData, (key, value) => {
                if (key === 'b64_json' && typeof value === 'string' && value.length > 100) {
                    return `[BASE64_DATA_${value.length}_CHARS]`;
                }
                return value;
            }));
            console.log('🔍 OPENAI IMAGE DATA STRUCTURE (WhatsApp):', JSON.stringify(imageStructureForLog, null, 2));
            return { 
                success: false, 
                error: 'No image data found' 
            };
        }
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        console.log('🖼️ OPENAI IMAGE BUFFER CREATED (WhatsApp): Buffer length =', imageBuffer.length);
        
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
            description: "", // No text description - only send the image
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

module.exports = { generateImageWithText, editImageWithText, generateTextResponse, generateImageForWhatsApp };
