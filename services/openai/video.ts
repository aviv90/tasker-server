/**
 * OpenAI Video Generation Service (Sora 2)
 * 
 * Handles video generation using OpenAI Sora 2 API.
 * Extracted from openaiService.js (Phase 5.3)
 */

import OpenAI from 'openai';
import { sanitizeText } from '../../utils/textSanitizer';
import { getStaticFileUrl } from '../../utils/urlUtils';
import { createTempFilePath } from '../../utils/tempFileUtils';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { TIME } from '../../utils/constants';
import { Request } from 'express';
import logger from '../../utils/logger';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Video generation options */
interface VideoGenerationOptions {
    model?: 'sora-2' | 'sora-2-pro';
    size?: '1280x720' | '720x1280' | '1920x1080' | '1080x1920' | '1792x1024' | '1024x1792';
    seconds?: number;
}

/** Video generation result (buffer) */
interface VideoGenerationResult {
    text?: string;
    videoBuffer?: Buffer;
    error?: string;
}

/** WhatsApp video result */
interface WhatsAppVideoResult {
    success: boolean;
    videoUrl?: string;
    description?: string;
    fileName?: string;
    error?: string;
}

// ============================================================================
// Shared Helper Functions (DRY)
// ============================================================================

const SUPPORTED_DURATIONS = [4, 8, 12];
const DEFAULT_DURATION = 8;

/** Validate and normalize video duration */
function validateDuration(seconds?: number): number {
    if (seconds && SUPPORTED_DURATIONS.includes(Number(seconds))) {
        return seconds;
    }
    if (seconds) {
        logger.warn(`⚠️ Invalid duration ${seconds}s. Using ${DEFAULT_DURATION}s (supported: ${SUPPORTED_DURATIONS.join(', ')})`);
    }
    return DEFAULT_DURATION;
}

/** Poll for video completion */
async function pollForCompletion(jobId: string): Promise<{ success: boolean; error?: string }> {
    const maxWaitTime = TIME.VIDEO_GENERATION_TIMEOUT;
    const startTime = Date.now();
    let pollAttempts = 0;

    let currentVideo = await openai.videos.retrieve(jobId);

    while (currentVideo.status === 'in_progress' || currentVideo.status === 'queued') {
        if (Date.now() - startTime > maxWaitTime) {
            logger.error('❌ Sora 2 video generation timed out');
            return { success: false, error: 'Video generation timed out after 10 minutes' };
        }

        await new Promise(resolve => setTimeout(resolve, TIME.POLL_INTERVAL_FAST));
        pollAttempts++;

        currentVideo = await openai.videos.retrieve(jobId);
        const progress = currentVideo.progress || 0;
        logger.info(`🔄 Polling attempt ${pollAttempts}: Status=${currentVideo.status}, Progress=${progress}%`);

        if (currentVideo.status === 'failed') {
            const errorMsg = currentVideo.error?.message || 'Video generation failed';
            logger.error('❌ Sora 2 video generation failed:', errorMsg);
            return { success: false, error: errorMsg };
        }
    }

    if (currentVideo.status !== 'completed') {
        logger.error('❌ Unexpected status:', currentVideo.status);
        return { success: false, error: `Unexpected status: ${currentVideo.status}` };
    }

    logger.info('✅ Video generation completed');
    return { success: true };
}

/** Download video content from job */
async function downloadVideoContent(jobId: string): Promise<Buffer> {
    logger.info('📥 Downloading video content...');
    const content = await openai.videos.downloadContent(jobId);
    const arrayBuffer = await content.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/** Save video buffer to file and return URL */
function saveVideoToFile(videoBuffer: Buffer, prefix: string, req: Request | null = null): { videoUrl: string; fileName: string } {
    const fileName = `${prefix}_${uuidv4()}.mp4`;
    const filePath = createTempFilePath(fileName);
    const tmpDir = path.dirname(filePath);

    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    fs.writeFileSync(filePath, videoBuffer);
    const videoUrl = getStaticFileUrl(fileName, req);

    logger.info(`🎬 Video saved to: ${filePath}`);
    logger.info(`🔗 Public URL: ${videoUrl}`);

    return { videoUrl, fileName };
}

// ============================================================================
// Public API
// ============================================================================

/** Generate video using Sora 2 from text prompt (returns buffer) */
export async function generateVideoWithSora(
    prompt: string,
    options: VideoGenerationOptions = {}
): Promise<VideoGenerationResult> {
    try {
        logger.info('🎬 Starting Sora 2 video generation');

        const cleanPrompt = sanitizeText(prompt);
        const model = options.model || 'sora-2';
        const size = options.size || '1280x720';
        const seconds = validateDuration(options.seconds);

        logger.info(`   Model: ${model}, Size: ${size}, Seconds: ${seconds}s`);

        const video = await openai.videos.create({
            model,
            prompt: cleanPrompt,
            size: size as any,
            seconds: seconds.toString() as any
        });

        logger.info(`📋 Job created: ${video.id}, Status: ${video.status}`);

        const pollResult = await pollForCompletion(video.id);
        if (!pollResult.success) {
            return { error: pollResult.error };
        }

        const videoBuffer = await downloadVideoContent(video.id);

        logger.info('✅ Sora 2 video downloaded successfully');
        return { text: cleanPrompt, videoBuffer };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('❌ Sora 2 video generation error:', errorMessage);
        throw err;
    }
}

/** Generate video using Sora 2 for WhatsApp (with URL) */
export async function generateVideoWithSoraForWhatsApp(
    prompt: string,
    req: Request | null = null,
    options: VideoGenerationOptions = {}
): Promise<WhatsAppVideoResult> {
    try {
        logger.info('🎬 Starting Sora 2 video generation for WhatsApp');

        const cleanPrompt = sanitizeText(prompt);
        const model = options.model || 'sora-2';
        const size = options.size || '1280x720';
        const seconds = validateDuration(options.seconds);

        logger.info(`   Model: ${model}, Size: ${size}, Seconds: ${seconds}s`);

        const video = await openai.videos.create({
            model,
            prompt: cleanPrompt,
            size: size as any,
            seconds: seconds.toString() as any
        });

        logger.info(`📋 Job created: ${video.id}, Status: ${video.status}`);

        const pollResult = await pollForCompletion(video.id);
        if (!pollResult.success) {
            return { success: false, error: pollResult.error };
        }

        const videoBuffer = await downloadVideoContent(video.id);
        const { videoUrl, fileName } = saveVideoToFile(videoBuffer, 'sora2_video', req);

        logger.info('✅ Sora 2 video generated successfully');
        return { success: true, videoUrl, description: cleanPrompt, fileName };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during video generation';
        logger.error('❌ Sora 2 video generation error:', errorMessage);
        return { success: false, error: errorMessage };
    }
}

/** Generate video from image using Sora 2 / Sora 2 Pro */
export async function generateVideoWithSoraFromImageForWhatsApp(
    prompt: string,
    imageBuffer: Buffer,
    options: VideoGenerationOptions = {}
): Promise<WhatsAppVideoResult> {
    try {
        logger.info('🎬 Starting Sora 2 image-to-video generation for WhatsApp');

        const cleanPrompt = sanitizeText(prompt);
        const model = options.model || 'sora-2';
        const seconds = validateDuration(options.seconds);

        logger.info(`   Model: ${model}, Seconds: ${seconds}s`);

        // Resize image to portrait format for best results
        const targetWidth = 720;
        const targetHeight = 1280;
        const targetSize = `${targetWidth}x${targetHeight}`;

        const metadata = await sharp(imageBuffer).metadata();
        logger.info(`   Original: ${metadata.width}x${metadata.height}, Resizing to: ${targetSize}`);

        const resizedImageBuffer = await sharp(imageBuffer)
            .resize(targetWidth, targetHeight, {
                fit: 'inside',
                withoutEnlargement: false,
                background: { r: 0, g: 0, b: 0 }
            })
            .jpeg({ quality: 95 })
            .toBuffer();

        logger.info(`✅ Image resized to ${targetSize}`);

        const imageFile = new File([resizedImageBuffer], 'image.jpg', { type: 'image/jpeg' });

        const video = await openai.videos.create({
            model,
            prompt: cleanPrompt,
            size: targetSize as any,
            seconds: seconds.toString() as any,
            input_reference: imageFile as any
        });

        logger.info(`📋 Job created: ${video.id}, Status: ${video.status}`);

        const pollResult = await pollForCompletion(video.id);
        if (!pollResult.success) {
            return { success: false, error: pollResult.error };
        }

        const videoBuffer = await downloadVideoContent(video.id);
        const { videoUrl, fileName } = saveVideoToFile(videoBuffer, 'sora2_image_video', null);

        logger.info('✅ Sora 2 image-to-video generated successfully');
        return { success: true, videoUrl, description: cleanPrompt, fileName };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image-to-video generation';
        logger.error('❌ Sora 2 image-to-video error:', errorMessage);
        return { success: false, error: errorMessage };
    }
}
