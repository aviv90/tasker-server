/**
 * OpenAI Video Generation Service (Sora 2)
 * 
 * Handles video generation using OpenAI Sora 2 API.
 * Extracted from openaiService.js (Phase 5.3)
 */

const OpenAI = require('openai');
const { sanitizeText } = require('../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate video using Sora 2 from text prompt (returns buffer)
 * @param {string} prompt - Video description
 * @param {Object} options - Video generation options:
 *   - model: 'sora-2' (default) or 'sora-2-pro'
 *   - size: '1280x720' (landscape, default), '720x1280' (portrait), '1920x1080', '1080x1920', etc.
 *   - seconds: 4, 8 (default), or 12
 * @returns {Promise<{text: string, videoBuffer: Buffer}|{error: string}>}
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
        const { TIME } = require('../../utils/constants');
        const maxWaitTime = TIME.VIDEO_GENERATION_TIMEOUT;
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
 * @returns {Promise<{success: boolean, videoUrl?: string, description?: string, fileName?: string, error?: string}>}
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
        const { TIME } = require('../../utils/constants');
        const maxWaitTime = TIME.VIDEO_GENERATION_TIMEOUT;
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
        const filePath = path.join(__dirname, '..', '..', 'public', 'tmp', fileName);
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
 * Uses input_reference parameter to animate a static image
 * @param {string} prompt - Video description
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} options - Video generation options:
 *   - model: 'sora-2' (default) or 'sora-2-pro'
 *   - seconds: 4, 8 (default), or 12
 * @returns {Promise<{success: boolean, videoUrl?: string, description?: string, fileName?: string, error?: string}>}
 */
async function generateVideoWithSoraFromImageForWhatsApp(prompt, imageBuffer, options = {}) {
    try {
        console.log('🎬 Starting Sora 2 image-to-video generation for WhatsApp');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Default options
        const model = options.model || 'sora-2'; // sora-2 or sora-2-pro
        const seconds = options.seconds || 8; // Supported values: 4, 8, or 12
        
        console.log(`   Model: ${model}, Seconds: ${seconds}s`);
        
        // Validate parameters
        let validSeconds = seconds;
        const supportedDurations = [4, 8, 12];
        if (!supportedDurations.includes(Number(seconds))) {
            console.log(`⚠️ Invalid duration ${seconds}s. Using 8 seconds (supported: 4, 8, 12)`);
            validSeconds = 8;
        }
        
        // Get image dimensions and resize to supported Sora 2 format
        console.log('📏 Reading image dimensions...');
        const metadata = await sharp(imageBuffer).metadata();
        const imageWidth = metadata.width;
        const imageHeight = metadata.height;
        
        // Sora 2 supported sizes: 720x1280 (portrait), 1280x720 (landscape), 1024x1792 (portrait), 1792x1024 (landscape)
        // ALWAYS prefer portrait format to avoid cropping important elements
        // If original is landscape, we'll resize to 720x1280 (portrait) to avoid cropping
        let targetWidth, targetHeight;
        
        // Use portrait format (720x1280) for all images to maximize detail preservation
        // This is safer than landscape because:
        // 1. Portrait captures more vertical detail (faces, bodies, objects)
        // 2. Landscape would crop too much vertical content
        // 3. Portrait is more suitable for social media and mobile viewing
        targetWidth = 720;
        targetHeight = 1280;
        
        const targetSize = `${targetWidth}x${targetHeight}`;
        console.log(`   Original: ${imageWidth}x${imageHeight}, Resizing to: ${targetSize}`);
        
        // Resize image to supported format using 'inside' to preserve all content
        // 'inside' ensures the entire image fits within the bounds without cropping
        // Any letterboxing will be added naturally (black/white bars if needed)
        const resizedImageBuffer = await sharp(imageBuffer)
            .resize(targetWidth, targetHeight, {
                fit: 'inside', // Preserve entire image, no cropping
                withoutEnlargement: false, // Allow upscaling if needed
                background: { r: 0, g: 0, b: 0 } // Black background for letterboxing if needed
            })
            .jpeg({ quality: 95 })
            .toBuffer();
        
        console.log(`✅ Image resized to ${targetSize}`);
        
        // Create File object from resized buffer
        console.log('📤 Preparing image file...');
        const imageFile = new File([resizedImageBuffer], 'image.jpg', { type: 'image/jpeg' });
        
        // Create video generation job with input_reference
        console.log('🎬 Creating Sora video with input_reference...');
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: targetSize, // MUST match resized image dimensions
            seconds: validSeconds.toString(),
            input_reference: imageFile // Pass the File object directly
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
        const { TIME } = require('../../utils/constants');
        const maxWaitTime = TIME.VIDEO_GENERATION_TIMEOUT;
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
        const filePath = path.join(__dirname, '..', '..', 'public', 'tmp', fileName);
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
    generateVideoWithSora,
    generateVideoWithSoraForWhatsApp,
    generateVideoWithSoraFromImageForWhatsApp
};

