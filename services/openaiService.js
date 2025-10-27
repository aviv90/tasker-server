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
 * @param {Object} options - Video generation options:
 *   - model: 'sora-2' (default) or 'sora-2-pro'
 *   - size: '1280x720' (landscape, default), '720x1280' (portrait), '1920x1080', '1080x1920', etc.
 *   - seconds: 4, 8 (default), or 12
 * @returns {Promise<Object>} - Video generation result
 */
async function generateVideoWithSora(prompt, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 video generation');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const size = options.size || '1280x720'; // Landscape by default (smaller file size, better WhatsApp compatibility)
        // Supported: sora-2: 1280x720 (landscape), 720x1280 (portrait)
        //            sora-2-pro: 1920x1080, 1080x1920, 1792x1024, 1024x1792
        const seconds = options.seconds || 8; // Supported values: 4, 8, or 12
        
        console.log(`   Model: ${model}, Size: ${size}, Seconds: ${seconds}s`);
        
        // Validate parameters - only 4, 8, or 12 seconds are supported
        let validSeconds = seconds;
        const supportedDurations = [4, 8, 12];
        if (!supportedDurations.includes(Number(seconds))) {
            console.log(`⚠️ Invalid duration ${seconds}s. Using 8 seconds (supported: 4, 8, 12)`);
            validSeconds = 8;
        }
        
        // Create video generation job using SDK
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: size,
            seconds: validSeconds.toString()
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        let currentVideo = video;
        while (currentVideo.status === 'in_progress' || currentVideo.status === 'queued') {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Sora 2 video generation timed out');
                return { error: 'Video generation timed out after 10 minutes' };
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            pollAttempts++;
            
            currentVideo = await openai.videos.retrieve(jobId);
            const progress = currentVideo.progress || 0;
            console.log(`🔄 Polling attempt ${pollAttempts}: Status=${currentVideo.status}, Progress=${progress}%`);
            
            if (currentVideo.status === 'failed') {
                const errorMsg = currentVideo.error?.message || 'Video generation failed';
                console.error('❌ Sora 2 video generation failed:', errorMsg);
                return { error: errorMsg };
            }
        }
        
        if (currentVideo.status !== 'completed') {
            console.error('❌ Unexpected status:', currentVideo.status);
            return { error: `Unexpected status: ${currentVideo.status}` };
        }
        
        console.log('✅ Video generation completed');
        
        // Download video content using SDK
        console.log('📥 Downloading video content...');
        const content = await openai.videos.downloadContent(jobId);
        const arrayBuffer = await content.arrayBuffer();
        const videoBuffer = Buffer.from(arrayBuffer);
        
        console.log('✅ Sora 2 video downloaded successfully');
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
 * @param {Object} options - Video generation options:
 *   - model: 'sora-2' (default) or 'sora-2-pro'
 *   - size: '1280x720' (landscape, default), '720x1280' (portrait), '1920x1080', '1080x1920', etc.
 *   - seconds: 4, 8 (default), or 12
 * @returns {Promise<Object>} - Video generation result with URL
 */
async function generateVideoWithSoraForWhatsApp(prompt, req = null, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 video generation for WhatsApp');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const size = options.size || '1280x720'; // Landscape by default (smaller file size, better WhatsApp compatibility)
        // Supported: sora-2: 1280x720 (landscape), 720x1280 (portrait)
        //            sora-2-pro: 1920x1080, 1080x1920, 1792x1024, 1024x1792
        const seconds = options.seconds || 8; // Supported values: 4, 8, or 12
        
        console.log(`   Model: ${model}, Size: ${size}, Seconds: ${seconds}s`);
        
        // Validate parameters - only 4, 8, or 12 seconds are supported
        let validSeconds = seconds;
        const supportedDurations = [4, 8, 12];
        if (!supportedDurations.includes(Number(seconds))) {
            console.log(`⚠️ Invalid duration ${seconds}s. Using 8 seconds (supported: 4, 8, 12)`);
            validSeconds = 8;
        }
        
        // Create video generation job using SDK
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: size,
            seconds: validSeconds.toString()
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        let currentVideo = video;
        while (currentVideo.status === 'in_progress' || currentVideo.status === 'queued') {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Sora 2 video generation timed out');
                return { 
                    success: false, 
                    error: 'Video generation timed out after 10 minutes' 
                };
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            pollAttempts++;
            
            currentVideo = await openai.videos.retrieve(jobId);
            const progress = currentVideo.progress || 0;
            console.log(`🔄 Polling attempt ${pollAttempts}: Status=${currentVideo.status}, Progress=${progress}%`);
            
            if (currentVideo.status === 'failed') {
                const errorMsg = currentVideo.error?.message || 'Video generation failed';
                console.error('❌ Sora 2 video generation failed:', errorMsg);
                return { 
                    success: false, 
                    error: errorMsg
                };
            }
        }
        
        if (currentVideo.status !== 'completed') {
            console.error('❌ Unexpected status:', currentVideo.status);
            return { 
                success: false, 
                error: `Unexpected status: ${currentVideo.status}` 
            };
        }
        
        console.log('✅ Video generation completed');
        
        // Download video content using SDK
        console.log('📥 Downloading video content...');
        const content = await openai.videos.downloadContent(jobId);
        const arrayBuffer = await content.arrayBuffer();
        const videoBuffer = Buffer.from(arrayBuffer);
        
        // Save video to tmp folder
        const fileName = `sora2_video_${uuidv4()}.mp4`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, videoBuffer);
        
        // Create public URL
        const publicVideoUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Sora 2 video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${publicVideoUrl}`);
        
        return { 
            success: true,
            videoUrl: publicVideoUrl,
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

/**
 * Generate video from image using Sora 2 / Sora 2 Pro
 * Uses image_reference parameter to animate a static image
 */
async function generateVideoWithSoraFromImageForWhatsApp(prompt, imageBuffer, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 image-to-video generation for WhatsApp');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const size = options.size || '1280x720'; // Landscape by default
        const seconds = options.seconds || 8; // Supported values: 4, 8, or 12
        
        console.log(`   Model: ${model}, Size: ${size}, Seconds: ${seconds}s`);
        
        // Validate parameters
        let validSeconds = seconds;
        const supportedDurations = [4, 8, 12];
        if (!supportedDurations.includes(Number(seconds))) {
            console.log(`⚠️ Invalid duration ${seconds}s. Using 8 seconds (supported: 4, 8, 12)`);
            validSeconds = 8;
        }
        
        // Step 1: Upload the image to OpenAI
        console.log('📤 Uploading image to OpenAI...');
        const imageFile = new File([imageBuffer], 'image.jpg', { type: 'image/jpeg' });
        const uploadedFile = await openai.files.create({
            file: imageFile,
            purpose: 'assistants' // or 'vision' if supported
        });
        
        console.log(`✅ Image uploaded: ${uploadedFile.id}`);
        
        // Step 2: Create video generation job with image_reference
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: size,
            seconds: validSeconds.toString(),
            image_reference: uploadedFile.id // Reference the uploaded image
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const startTime = Date.now();
        let pollAttempts = 0;
        
        let currentVideo = video;
        while (currentVideo.status === 'in_progress' || currentVideo.status === 'queued') {
            if (Date.now() - startTime > maxWaitTime) {
                console.error('❌ Sora 2 image-to-video timed out');
                return { 
                    success: false, 
                    error: 'Video generation timed out after 10 minutes' 
                };
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            pollAttempts++;
            
            currentVideo = await openai.videos.retrieve(jobId);
            const progress = currentVideo.progress || 0;
            console.log(`🔄 Polling attempt ${pollAttempts}: Status=${currentVideo.status}, Progress=${progress}%`);
            
            if (currentVideo.status === 'failed') {
                const errorMsg = currentVideo.error?.message || 'Video generation failed';
                console.error('❌ Sora 2 image-to-video failed:', errorMsg);
                return { 
                    success: false, 
                    error: errorMsg
                };
            }
        }
        
        if (currentVideo.status !== 'completed') {
            console.error('❌ Unexpected status:', currentVideo.status);
            return { 
                success: false, 
                error: `Unexpected status: ${currentVideo.status}` 
            };
        }
        
        console.log('✅ Video generation completed');
        
        // Download video content
        console.log('📥 Downloading video content...');
        const content = await openai.videos.downloadContent(jobId);
        const arrayBuffer = await content.arrayBuffer();
        const videoBuffer = Buffer.from(arrayBuffer);
        
        // Save video to tmp folder
        const fileName = `sora2_image_video_${uuidv4()}.mp4`;
        const filePath = path.join(__dirname, '..', 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, videoBuffer);
        
        // Create public URL
        const publicVideoUrl = getStaticFileUrl(fileName);
        
        console.log('✅ Sora 2 image-to-video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${publicVideoUrl}`);
        
        // Clean up uploaded file (optional)
        try {
            await openai.files.del(uploadedFile.id);
            console.log(`🗑️ Cleaned up uploaded file: ${uploadedFile.id}`);
        } catch (delError) {
            console.warn('⚠️ Could not delete uploaded file:', delError.message);
        }
        
        return { 
            success: true,
            videoUrl: publicVideoUrl,
            description: cleanPrompt,
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Sora 2 image-to-video error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image-to-video generation' 
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
    generateVideoWithSoraForWhatsApp,
    generateVideoWithSoraFromImageForWhatsApp
};
