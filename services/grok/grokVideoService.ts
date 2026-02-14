/**
 * Grok Video Service
 * Handles video generation (text-to-video and image-to-video) via x.ai Grok API
 */

import { sanitizeText } from '../../utils/textSanitizer';
import logger from '../../utils/logger';
import { API_URLS, TIME } from '../../utils/constants';
import sharp from 'sharp';

/**
 * Video generation result
 */
export interface VideoGenerationResult {
    success: boolean;
    videoUrl?: string;
    description?: string;
    error?: string;
    originalPrompt?: string;
    metadata?: {
        service: string;
        model: string;
        type: string;
        duration?: number;
        created_at: string;
    };
}

/**
 * Poll for video generation result
 * @param requestId - The request ID from initial video generation request
 * @param maxAttempts - Maximum number of polling attempts
 * @param intervalMs - Interval between polling attempts in milliseconds
 * @returns Video URL or null if failed
 */
async function pollForVideoResult(requestId: string, maxAttempts = 60, intervalMs = TIME.POLL_INTERVAL_FAST): Promise<{ url?: string; error?: string }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            // Correct endpoint: /v1/videos/{request_id}
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), TIME.CIRCUIT_BREAKER_TIMEOUT);
            let response: Response;
            try {
                response = await fetch(`${API_URLS.GROK}/videos/${requestId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!response.ok) {
                const errorData = await response.text();
                logger.warn(`Grok video poll attempt ${attempt + 1} failed:`, { status: response.status, error: errorData });
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                continue;
            }

            const data = await response.json() as Record<string, unknown>;

            // Log response keys for debugging at debug level
            logger.debug(`🔍 Grok video poll response (attempt ${attempt + 1}/${maxAttempts}) keys:`, {
                keys: Object.keys(data)
            });

            // Check for completion states (various possible field names)
            const state = (data.state || data.status || '') as string;

            // Check for video URL in multiple possible locations
            const videoObj = data.video as Record<string, unknown> | undefined;
            const outputObj = data.output as Record<string, unknown> | undefined;
            const resultObj = data.result as Record<string, unknown> | undefined;

            const videoUrl = (
                data.url ||
                data.video_url ||
                videoObj?.url ||
                outputObj?.url ||
                resultObj?.url ||
                resultObj?.video_url ||
                (resultObj?.video as Record<string, unknown>)?.url
            ) as string | undefined;

            // Success states
            if (state.toLowerCase() === 'completed' || state.toLowerCase() === 'succeeded' || state.toLowerCase() === 'success' || (videoUrl && !state)) {
                if (videoUrl) {
                    logger.info(`✅ Grok video generation completed!`);
                    return { url: videoUrl };
                }
                // URL might be in data directly without state
                logger.warn('Grok returned success state but no URL found in response', { keys: Object.keys(data) });
            }

            // Failure states
            if (state.toLowerCase() === 'failed' || state.toLowerCase() === 'error' || data.error) {
                const errorMsg = (data.error || data.message || 'Video generation failed') as string;
                logger.error('❌ Grok video generation failed:', { state, error: errorMsg });
                return { error: errorMsg };
            }

            // In-progress states - continue polling
            if (state.toLowerCase() === 'pending' || state.toLowerCase() === 'in_progress' || state.toLowerCase() === 'processing' || state.toLowerCase() === 'queued' || !state) {
                logger.debug(`⏳ Grok video generation in progress (attempt ${attempt + 1}/${maxAttempts}, state: ${state || 'unknown'})`);
            } else if (state) {
                logger.warn(`⚠️ Unknown Grok video state: "${state}" (attempt ${attempt + 1})`);
            }

            await new Promise(resolve => setTimeout(resolve, intervalMs));

        } catch (error) {
            logger.warn(`Polling error on attempt ${attempt + 1}:`, { error });
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }

    return { error: 'Video generation timed out after maximum polling attempts' };
}

/**
 * Generate video from text prompt using Grok
 * Uses async polling mechanism as per xAI API specification
 * @param prompt - Video description
 * @param options - Generation options (duration, model, etc.)
 * @returns Video generation result with URL
 */
export async function generateVideoForWhatsApp(prompt: string, options: { duration?: number } = {}): Promise<VideoGenerationResult> {
    try {
        if (!process.env.GROK_API_KEY) {
            throw new Error('Grok API key not configured');
        }

        const cleanPrompt = sanitizeText(prompt);
        // Default to 15 seconds as requested by user
        const duration = options.duration ? Math.min(Math.max(options.duration, 1), 15) : 15;

        logger.info(`🎬 Generating video with Grok: "${cleanPrompt.substring(0, 100)}..." (Duration: ${duration}s)`);

        // Step 1: Start video generation request
        // Correct endpoint: /v1/videos/generations
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIME.CIRCUIT_BREAKER_TIMEOUT);
        let response: Response;
        try {
            response = await fetch(`${API_URLS.GROK}/videos/generations`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    model: 'grok-imagine-video',
                    duration: duration,
                    aspect_ratio: '9:16'
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const errorData = await response.text();
            logger.error('❌ Grok video generation start error:', { status: response.status, error: errorData });
            return {
                success: false,
                error: `Grok video generation failed: ${response.status} - ${errorData}`,
                originalPrompt: cleanPrompt
            };
        }

        const data = await response.json() as { request_id?: string };

        if (!data.request_id) {
            return {
                success: false,
                error: 'No request_id received from Grok API',
                originalPrompt: cleanPrompt
            };
        }

        logger.info(`📦 Grok video request started, polling for result... (ID: ${data.request_id})`);

        // Step 2: Poll for result
        const result = await pollForVideoResult(data.request_id);

        if (result.error) {
            return {
                success: false,
                error: result.error,
                originalPrompt: cleanPrompt
            };
        }

        if (result.url) {
            logger.info('✅ Grok video generated successfully');
            return {
                success: true,
                videoUrl: result.url,
                originalPrompt: cleanPrompt,
                metadata: {
                    service: 'Grok',
                    model: 'grok-imagine-video',
                    type: 'text_to_video',
                    created_at: new Date().toISOString()
                }
            };
        }

        return {
            success: false,
            error: 'No video URL received from Grok API',
            originalPrompt: cleanPrompt
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Error generating Grok video:', { error: errorMessage });
        return {
            success: false,
            error: errorMessage || 'Unknown error occurred during video generation',
            originalPrompt: prompt
        };
    }
}

/**
 * Generate video from image using Grok
 * Uses async polling mechanism as per xAI API specification
 * @param prompt - Animation instructions
 * @param imageBuffer - Image buffer to animate
 * @param options - Generation options (duration, model, etc.)
 * @returns Video generation result with URL
 */
export async function generateVideoFromImageForWhatsApp(prompt: string, imageBuffer: Buffer, options: { duration?: number } = {}): Promise<VideoGenerationResult> {
    try {
        if (!process.env.GROK_API_KEY) {
            throw new Error('Grok API key not configured');
        }

        const cleanPrompt = sanitizeText(prompt);
        // Default to 15 seconds as requested by user
        const duration = options.duration ? Math.min(Math.max(options.duration, 1), 15) : 15;

        logger.info(`🎬 Generating video from image with Grok: "${cleanPrompt.substring(0, 100)}..." (Duration: ${duration}s)`);

        // Detect mime type using sharp
        let mimeType = 'image/jpeg'; // Default
        try {
            const metadata = await sharp(imageBuffer).metadata();
            if (metadata.format) {
                // Normalize format (e.g. 'jpeg' -> 'image/jpeg')
                mimeType = `image/${metadata.format}`;
            }
        } catch (err) {
            logger.warn('⚠️ Failed to detect image mime type, defaulting to jpeg:', { error: err });
        }

        // Convert buffer to base64 data URL with detected mime type
        const base64Image = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

        // Log start of request with safe data truncation
        logger.info(`📦 Grok image-to-video request payload:`, {
            model: 'grok-imagine-video',
            hasImage: !!base64Image,
            imageLength: base64Image.length,
            imageStart: base64Image.substring(0, 50) + '...',
            prompt: cleanPrompt
        });

        // Step 1: Start video generation request with image (same generations endpoint)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIME.CIRCUIT_BREAKER_TIMEOUT);
        let response: Response;
        try {
            response = await fetch(`${API_URLS.GROK}/videos/generations`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    model: 'grok-imagine-video',
                    image_url: base64Image,
                    duration: duration,
                    aspect_ratio: '9:16'
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const errorData = await response.text();
            logger.error('❌ Grok image-to-video start error:', { status: response.status, error: errorData });
            return {
                success: false,
                error: `Grok image-to-video failed: ${response.status} - ${errorData}`,
                originalPrompt: cleanPrompt
            };
        }

        const data = await response.json() as { request_id?: string };

        if (!data.request_id) {
            return {
                success: false,
                error: 'No request_id received from Grok API',
                originalPrompt: cleanPrompt
            };
        }

        logger.info(`📦 Grok image-to-video request started, polling for result... (ID: ${data.request_id})`);

        // Step 2: Poll for result
        const result = await pollForVideoResult(data.request_id);

        if (result.error) {
            return {
                success: false,
                error: result.error,
                originalPrompt: cleanPrompt
            };
        }

        if (result.url) {
            logger.info('✅ Grok image-to-video generated successfully');
            return {
                success: true,
                videoUrl: result.url,
                originalPrompt: cleanPrompt,
                metadata: {
                    service: 'Grok',
                    model: 'grok-imagine-video',
                    type: 'image_to_video',
                    created_at: new Date().toISOString()
                }
            };
        }

        return {
            success: false,
            error: 'No video URL received from Grok API',
            originalPrompt: cleanPrompt
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Error generating Grok image-to-video:', { error: errorMessage });
        return {
            success: false,
            error: errorMessage || 'Unknown error occurred during video generation',
            originalPrompt: prompt
        };
    }
}
