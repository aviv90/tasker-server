/**
 * Grok Image Service
 * Handles image generation via x.ai Grok API
 */

import { sanitizeText, cleanMarkdown } from '../../utils/textSanitizer';
import logger from '../../utils/logger';
import { API_URLS, TIME } from '../../utils/constants';

/**
 * Image generation result
 */
export interface ImageGenerationResult {
    success: boolean;
    imageUrl?: string;
    description?: string;
    textOnly?: boolean;
    error?: string;
    originalPrompt?: string;
    metadata?: {
        service: string;
        model: string;
        type: string;
        created_at: string;
    };
}

/**
 * Generate image using Grok with prompt
 * @param prompt - User's image generation prompt
 * @returns Image generation result
 */
export async function generateImageForWhatsApp(prompt: string): Promise<ImageGenerationResult> {
    try {
        const apiKey = process.env.GROK_API_KEY;
        if (!apiKey) {
            throw new Error('Grok API key not configured');
        }

        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);

        logger.debug(`🎨 Generating image with Grok: "${cleanPrompt}"`);

        // Call xAI image generation API
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIME.CIRCUIT_BREAKER_TIMEOUT);
        let response: Response;
        try {
            response = await fetch(`${API_URLS.GROK}/images/generations`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    model: 'grok-imagine-image',
                    response_format: 'url',
                    n: 1
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const errorData = await response.text();
            logger.error('❌ Grok image generation error:', { status: response.status, error: errorData });
            return {
                success: false,
                error: `Grok image generation failed: ${response.status} - ${errorData}`,
                originalPrompt: cleanPrompt
            };
        }

        const data = await response.json() as {
            data?: Array<{ url?: string; revised_prompt?: string }>;
            choices?: Array<{ message?: { content?: string } }>;
            text?: string;
        };

        // Handle successful response - return whatever Grok provides
        if (data.data && data.data.length > 0) {
            const imageData = data.data[0];
            if (!imageData) {
                return {
                    success: false,
                    error: 'No image data received from Grok API',
                    originalPrompt: cleanPrompt
                };
            }
            const imageUrl = imageData.url;
            let description = imageData.revised_prompt || '';

            // Clean markdown code blocks from description (Grok sometimes returns markdown)
            if (description) {
                description = cleanMarkdown(description);
            }

            logger.info('✅ Grok image generated successfully');

            return {
                success: true,
                imageUrl: imageUrl,
                description: description,
                originalPrompt: cleanPrompt,
                metadata: {
                    service: 'Grok',
                    model: 'grok-imagine-image',
                    type: 'image_generation',
                    created_at: new Date().toISOString()
                }
            };
        } else {
            // If no image but response is successful, maybe it returned text only
            const textContent = data.choices?.[0]?.message?.content || data.text || '';

            if (textContent) {
                logger.info('📝 Grok returned text response instead of image - Treating as FAILURE');
                return {
                    success: false,
                    error: textContent, // Return the refusal/ASCII art as the error message
                    originalPrompt: cleanPrompt
                };
            } else {
                return {
                    success: false,
                    error: 'No image or text data received from Grok API',
                    originalPrompt: cleanPrompt
                };
            }
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Error generating Grok image:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
        return {
            success: false,
            error: errorMessage || 'Unknown error occurred during image generation',
            originalPrompt: prompt
        };
    }
}
