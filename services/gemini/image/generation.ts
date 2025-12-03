import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeText, cleanMarkdown, cleanMediaDescription } from '../../../utils/textSanitizer';
import { getStaticFileUrl } from '../../../utils/urlUtils';
import { getGeminiErrorMessage } from '../utils';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createTempFilePath } from '../../../utils/tempFileUtils';
import { Request } from 'express';
import logger from '../../../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Image generation result
 */
interface ImageGenerationResult {
  text?: string;
  imageBuffer?: Buffer;
  textOnly?: boolean;
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
 * Image generation operations
 */
class ImageGeneration {
  /**
   * Process prompt for Gemini Image generation
   * IMPORTANT: Gemini Image model supports both IMAGE and TEXT modalities.
   * We don't clean or modify the prompt - Gemini Image can handle instructions like "צייר עוף" directly.
   * The model is smart enough to understand the intent and generate accordingly.
   * 
   * If user explicitly requested image, the prompt is already clear and will generate an image.
   * If user didn't explicitly request image, Gemini will return text response (default behavior).
   */
  cleanPrompt(prompt: string): string {
    // Just sanitize the prompt - no need to clean instructions
    // Gemini Image model can handle "צייר עוף" directly and will generate an image
    return sanitizeText(prompt);
  }

  /**
   * Process Gemini image response
   */
  processImageResponse(response: unknown, prompt: string): ImageGenerationResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseAny = response as any;
    if (!responseAny.candidates || responseAny.candidates.length === 0) {
      logger.warn('❌ Gemini: No candidates returned');
      const errorMsg = getGeminiErrorMessage(null, responseAny.promptFeedback);
      return { error: errorMsg };
    }

    const cand = responseAny.candidates[0];
    let text = '';
    let imageBuffer: Buffer | null = null;

    if (!cand.content || !cand.content.parts) {
      logger.warn('❌ Gemini: No content or parts found in candidate');
      logger.debug('   Full candidate:', JSON.stringify(cand));
      const errorMsg = getGeminiErrorMessage(cand);
      return { error: errorMsg };
    }

    // Process all parts in the response
    for (const part of cand.content.parts) {
      if (part.text) {
        text += part.text;
      } else if (part.inlineData?.data) {
        imageBuffer = Buffer.from(part.inlineData.data, 'base64');
      }
    }

    if (!imageBuffer) {
      if (text && text.trim().length > 0) {
        const cleanText = text.trim();
        logger.info('📝 Gemini returned text instead of image');
        logger.debug(`   Gemini response: ${cleanText.substring(0, 200)}...`);
        return {
          textOnly: true,
          text: cleanText
        };
      }

      // No image and no text - this is a real error
      logger.warn('❌ Gemini: No image data found in response and no text returned');
      return { error: 'לא חזרה תמונה ולא חזר טקסט' };
    }

    return { text: text || prompt, imageBuffer };
  }

  /**
   * Save image to file and return URL
   */
  saveImageForWhatsApp(imageBuffer: Buffer, req: Request | null, prefix = 'gemini'): { imageUrl: string; fileName: string; description: string } {
    const imageId = uuidv4();
    const fileName = `${prefix}_${imageId}.png`;
    const filePath = createTempFilePath(fileName);

    fs.writeFileSync(filePath, imageBuffer);
    const imageUrl = getStaticFileUrl(fileName, req);

    logger.info(`🖼️ Image saved to: ${filePath}`);
    logger.debug(`🔗 Public URL: ${imageUrl}`);

    return { imageUrl, fileName, description: '' };
  }

  /**
   * Generate image from text prompt
   */
  async generateImageWithText(prompt: string): Promise<ImageGenerationResult> {
    try {
      logger.info('🎨 Starting Gemini image generation');

      const cleanPrompt = this.cleanPrompt(prompt);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-image-preview"
      });

       
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"]
        } as any
      });

      const response = result.response;
      const processResult = this.processImageResponse(response, prompt);

      // Handle text-only response (no image but text returned)
      if (processResult.textOnly) {
        return {
          textOnly: true,
          text: processResult.text
        };
      }

      if (processResult.error) {
        return processResult;
      }

      logger.info('✅ Gemini image generated successfully');
      return processResult;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Gemini image generation error:', errorMessage);
      throw err;
    }
  }

  /**
   * Generate image for WhatsApp from text prompt
   */
  async generateImageForWhatsApp(prompt: string, req: Request | null = null): Promise<WhatsAppImageResult> {
    try {
      logger.info('🎨 Starting Gemini image generation');

      const cleanPrompt = this.cleanPrompt(prompt);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-image-preview"
      });

       
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"]
        } as any
      });

      const response = result.response;
      const processResult = this.processImageResponse(response, prompt);

      // Handle text-only response (no image but text returned)
      if (processResult.textOnly) {
        return {
          success: true,
          textOnly: true,
          description: processResult.text
        };
      }

      if (processResult.error) {
        return {
          success: false,
          error: processResult.error
        };
      }

      const { imageBuffer, text } = processResult;
      if (!imageBuffer) {
        return {
          success: false,
          error: 'No image buffer in result'
        };
      }

      const saveResult = this.saveImageForWhatsApp(imageBuffer, req, 'gemini');

      // Clean markdown, image markers, and media descriptions from text
      let cleanDescription = text?.trim() || "";
      if (cleanDescription) {
        // First clean markdown
        cleanDescription = cleanMarkdown(cleanDescription);
        // Then clean image-specific markers and patterns (only formatting, not text phrases)
        cleanDescription = cleanDescription
          .replace(/\[image[:\]]/gi, '') // Remove [image: or [image]
          .replace(/image[:\]]/gi, '') // Remove image: or image]
          .replace(/\[תמונה[^\]]*/gi, '') // Remove [תמונה: or [תמונה] with any text after (including incomplete brackets)
          .replace(/תמונה:\s*$/gi, '') // Remove תמונה: at the end of text
          .replace(/^[^.!?]*\[image[:\]][^.!?]*/gi, '') // Remove entire lines with [image: or [image]
          .trim();
        // Finally use cleanMediaDescription for additional cleanup
        cleanDescription = cleanMediaDescription(cleanDescription);
      }

      logger.info('✅ Gemini image generated successfully');

      return {
        success: true,
        imageUrl: saveResult.imageUrl,
        description: cleanDescription,
        fileName: saveResult.fileName
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image generation';
      logger.error('❌ Gemini image generation error:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new ImageGeneration();

