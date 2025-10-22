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
        content: 'אתה עוזר AI ידידותי, אדיב ונעים. תן תשובות טבעיות ונעימות באופן שיחתי. היה חם ומקשיב.'
      },
      {
        role: 'user',
        content: 'היי, איך אתה?'
      },
      {
        role: 'assistant',
        content: 'שלום! אני כאן ושמח לעזור לך. מה מעניין אותך היום?'
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

    console.log(`🤖 OpenAI processing (${conversationHistory.length} context messages)`);

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
        
        console.log('✅ OpenAI image generated successfully');
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
        console.log('🖼️ Starting OpenAI image editing');
        
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
            
            // OpenAI doesn't typically return text-only for image edits,
            // but handle gracefully if it happens
            const revisedText = imageData.revised_prompt || cleanPrompt;
            if (revisedText && revisedText.trim().length > 0) {
                console.log('📝 OpenAI edit returned text instead of image, sending text response');
                return { 
                    success: true,  // Changed to true since we have content
                    textOnly: true, // Flag to indicate this is text-only response
                    description: revisedText.trim() // Send the revised prompt or original prompt
                };
            }
            
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
        
        console.log('✅ OpenAI image edited successfully');
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

/**
 * Generate video using Sora 2 from text prompt
 * @param {string} prompt - Video description
 * @param {Object} options - Video generation options (model, resolution, duration)
 * @returns {Promise<Object>} - Video generation result
 */
async function generateVideoWithSora(prompt, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 video generation');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const resolution = options.resolution || '720p'; // 720p or 1024p (1024p only for sora-2-pro)
        const duration = options.duration || 10; // Up to 12 seconds
        
        console.log(`   Model: ${model}, Resolution: ${resolution}, Duration: ${duration}s`);
        
        // Validate parameters
        if (model === 'sora-2' && resolution === '1024p') {
            console.log('⚠️ 1024p only available for sora-2-pro, falling back to 720p');
            resolution = '720p';
        }
        
        if (duration > 12) {
            console.log('⚠️ Duration capped at 12 seconds');
            duration = 12;
        }
        
        // Create video generation job
        const response = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            resolution: resolution,
            duration: duration
        });
        
        const jobId = response.id;
        console.log(`📋 Job created: ${jobId}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        let status;
        while (true) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Sora 2 video generation timed out');
                return { error: 'Video generation timed out after 10 minutes' };
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Sora 2 video generation`);
            
            status = await openai.videos.retrieve(jobId);
            
            if (status.status === 'completed') {
                break;
            } else if (status.status === 'failed') {
                console.error('❌ Sora 2 video generation failed');
                return { error: status.error || 'Video generation failed' };
            }
        }
        
        console.log('✅ Video generation completed');
        
        // Download video
        const videoData = await openai.videos.download(jobId);
        const videoBuffer = Buffer.from(videoData);
        
        console.log('✅ Sora 2 video generated successfully');
        return { 
            text: cleanPrompt, 
            videoBuffer: videoBuffer 
        };
    } catch (err) {
        console.error('❌ Sora 2 video generation error:', err);
        throw err;
    }
}

/**
 * Generate video using Sora 2 for WhatsApp (with URL)
 * @param {string} prompt - Video description
 * @param {Object} req - Express request object (for URL generation)
 * @param {Object} options - Video generation options (model, resolution, duration)
 * @returns {Promise<Object>} - Video generation result with URL
 */
async function generateVideoWithSoraForWhatsApp(prompt, req = null, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 video generation for WhatsApp');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const resolution = options.resolution || '720p'; // 720p or 1024p (1024p only for sora-2-pro)
        const duration = options.duration || 10; // Up to 12 seconds
        
        console.log(`   Model: ${model}, Resolution: ${resolution}, Duration: ${duration}s`);
        
        // Validate parameters
        let validResolution = resolution;
        if (model === 'sora-2' && resolution === '1024p') {
            console.log('⚠️ 1024p only available for sora-2-pro, falling back to 720p');
            validResolution = '720p';
        }
        
        let validDuration = duration;
        if (duration > 12) {
            console.log('⚠️ Duration capped at 12 seconds');
            validDuration = 12;
        }
        
        // Create video generation job
        const response = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            resolution: validResolution,
            duration: validDuration
        });
        
        const jobId = response.id;
        console.log(`📋 Job created: ${jobId}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        let status;
        while (true) {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Sora 2 video generation timed out');
                return { 
                    success: false, 
                    error: 'Video generation timed out after 10 minutes' 
                };
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            pollAttempts++;
            console.log(`🔄 Polling attempt ${pollAttempts} for Sora 2 video generation`);
            
            status = await openai.videos.retrieve(jobId);
            
            if (status.status === 'completed') {
                break;
            } else if (status.status === 'failed') {
                console.error('❌ Sora 2 video generation failed');
                return { 
                    success: false, 
                    error: status.error || 'Video generation failed' 
                };
            }
        }
        
        console.log('✅ Video generation completed');
        
        // Download video
        const videoData = await openai.videos.download(jobId);
        const videoBuffer = Buffer.from(videoData);
        
        // Save video to tmp folder
        const fileName = `sora2_video_${uuidv4()}.mp4`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, videoBuffer);
        
        // Create public URL
        const videoUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Sora 2 video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${videoUrl}`);
        
        return { 
            success: true,
            videoUrl: videoUrl,
            description: cleanPrompt,
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Sora 2 video generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during video generation' 
        };
    }
}

module.exports = { 
    generateImageWithText, 
    editImageWithText, 
    generateTextResponse, 
    generateImageForWhatsApp, 
    editImageForWhatsApp,
    generateVideoWithSora,
    generateVideoWithSoraForWhatsApp
};
