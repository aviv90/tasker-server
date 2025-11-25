/**
 * OpenAI Image Generation Service
 * 
 * Handles image generation and editing using OpenAI API.
 * Extracted from openaiService.js (Phase 5.3)
 */

import OpenAI from 'openai';
import { sanitizeText, cleanMarkdown } from '../../utils/textSanitizer';
import { getStaticFileUrl } from '../../utils/urlUtils';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createTempFilePath } from '../../utils/tempFileUtils';
import { Request } from 'express';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Image generation result (buffer)
 */
interface ImageGenerationResult {
    text?: string;
    imageBuffer?: Buffer;
    error?: string;
}

/**
 * WhatsApp image result
 */
interface WhatsAppImageResult {
    success: boolean;
    imageUrl?: string;
    description?: string;
    fileName?: string;
    textOnly?: boolean;
    error?: string;
}

/**
 * Generate image with text (returns buffer)
 */
export async function generateImageWithText(prompt: string): Promise<ImageGenerationResult> {
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
        if (!imageData) {
            return { error: 'No image data in response' };
        }
        
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
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ OpenAI image generation error:', errorMessage);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

/**
 * Edit image with text (returns buffer)
 */
export async function editImageWithText(prompt: string, imageBuffer: Buffer): Promise<ImageGenerationResult> {
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
        if (!imageData) {
            return { error: 'No image data in response' };
        }
        
        const revisedPrompt = imageData.revised_prompt || prompt;
        
        // gpt-image-1 always returns b64_json (base64 data)
        if (imageData.b64_json) {
            const editedImageBuffer = Buffer.from(imageData.b64_json, 'base64');
            console.log('✅ OpenAI image edited successfully');
            return { 
                text: revisedPrompt, 
                imageBuffer: editedImageBuffer
            };
        }
        
        console.log('❌ OpenAI edit: No base64 image data found');
        return { error: 'No base64 image data found in response' };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ OpenAI image edit error:', errorMessage);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

/**
 * Generate image for WhatsApp (returns URL)
 */
export async function generateImageForWhatsApp(prompt: string, req: Request | null): Promise<WhatsAppImageResult> {
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
        if (!imageData) {
            return {
                success: false,
                error: 'No image data in response'
            };
        }
        
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
        const filePath = createTempFilePath(fileName);
        
        // Write image file
        fs.writeFileSync(filePath, imageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ OpenAI image generated successfully');
        console.log(`🖼️ Image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        // Clean markdown code blocks from description (OpenAI sometimes returns markdown)
        let cleanDescription = revisedPrompt || "";
        if (cleanDescription) {
            cleanDescription = cleanMarkdown(cleanDescription);
        }
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: cleanDescription,
            fileName: fileName
        };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image generation';
        console.error('❌ OpenAI image generation error:', errorMessage);
        return { 
            success: false, 
            error: errorMessage
        };
    }
}

/**
 * Edit image for WhatsApp (returns URL)
 */
export async function editImageForWhatsApp(prompt: string, base64Image: string, req: Request | null): Promise<WhatsAppImageResult> {
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
        if (!imageData) {
            return {
                success: false,
                error: 'No image data in response'
            };
        }
        
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
        const filePath = createTempFilePath(fileName);
        
        // Write image file
        fs.writeFileSync(filePath, editedImageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ OpenAI image edited successfully');
        console.log(`🖼️ Edited image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        // Clean markdown code blocks from description (OpenAI sometimes returns markdown)
        let cleanDescription = revisedPrompt || "";
        if (cleanDescription) {
            cleanDescription = cleanMarkdown(cleanDescription);
        }
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: cleanDescription,
            fileName: fileName
        };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image editing';
        console.error('❌ OpenAI image edit error:', errorMessage);
        return { 
            success: false, 
            error: errorMessage
        };
    }
}

