/**
 * OpenAI Video Generation Service (Sora 2)
 * 
 * Handles video generation using OpenAI Sora 2 API.
 * Extracted from openaiService.js (Phase 5.3)
 */

import OpenAI from 'openai';
import { sanitizeText } from '../../utils/textSanitizer';
import { getStaticFileUrl } from '../../utils/urlUtils';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { TIME } from '../../utils/constants';
import { Request } from 'express';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Video generation options
 */
interface VideoGenerationOptions {
    model?: 'sora-2' | 'sora-2-pro';
    size?: string;
    seconds?: number;
}

/**
 * Video generation result (buffer)
 */
interface VideoGenerationResult {
    text?: string;
    videoBuffer?: Buffer;
    error?: string;
}

/**
 * WhatsApp video result
 */
interface WhatsAppVideoResult {
    success: boolean;
    videoUrl?: string;
    description?: string;
    fileName?: string;
    error?: string;
}

/**
 * Generate video using Sora 2 from text prompt (returns buffer)
 */
export async function generateVideoWithSora(
    prompt: string,
    options: VideoGenerationOptions = {}
): Promise<VideoGenerationResult> {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: size as any,
            seconds: validSeconds.toString() as any
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
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
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ Sora 2 video generation error:', errorMessage);
        throw err;
    }
}

/**
 * Generate video using Sora 2 for WhatsApp (with URL)
 */
export async function generateVideoWithSoraForWhatsApp(
    prompt: string,
    req: Request | null = null,
    options: VideoGenerationOptions = {}
): Promise<WhatsAppVideoResult> {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: size as any,
            seconds: validSeconds.toString() as any
        });
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
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
        // Use process.cwd() for safe path resolution
        const filePath = path.join(process.cwd(), 'public', 'tmp', fileName);
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
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during video generation';
        console.error('❌ Sora 2 video generation error:', errorMessage);
        return { 
            success: false, 
            error: errorMessage
        };
    }
}

/**
 * Generate video from image using Sora 2 / Sora 2 Pro
 * Uses input_reference parameter to animate a static image
 */
export async function generateVideoWithSoraFromImageForWhatsApp(
    prompt: string,
    imageBuffer: Buffer,
    options: VideoGenerationOptions = {}
): Promise<WhatsAppVideoResult> {
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
        let targetWidth: number;
        let targetHeight: number;
        
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const video = await openai.videos.create({
            model: model,
            prompt: cleanPrompt,
            size: targetSize as any, // MUST match resized image dimensions
            seconds: validSeconds.toString() as any,
            input_reference: imageFile // Pass the File object directly
        } as any);
        
        const jobId = video.id;
        console.log(`📋 Job created: ${jobId}, Status: ${video.status}`);
        
        // Poll for completion
        console.log('⏳ Waiting for video generation to complete...');
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
        // Use process.cwd() for safe path resolution
        const filePath = path.join(process.cwd(), 'public', 'tmp', fileName);
        const tmpDir = path.dirname(filePath);
        
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, videoBuffer);
        
        // Create public URL
        const publicVideoUrl = getStaticFileUrl(fileName, null);
        
        console.log('✅ Sora 2 image-to-video generated successfully');
        console.log(`🎬 Video saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${publicVideoUrl}`);
        
        return { 
            success: true,
            videoUrl: publicVideoUrl,
            description: cleanPrompt,
            fileName: fileName
        };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image-to-video generation';
        console.error('❌ Sora 2 image-to-video error:', errorMessage);
        return { 
            success: false, 
            error: errorMessage
        };
    }
}

