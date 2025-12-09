// eslint-disable-next-line @typescript-eslint/no-require-imports
import { getStaticFileUrl } from '../../../utils/urlUtils';
import { Request } from 'express';
import logger from '../../../utils/logger';
import path from 'path';

// Import services
import veoGeneration from './veoGeneration';
import videoConverter from '../../video/VideoConverter';

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
 * WhatsApp-specific video generation operations
 * Refactored to coordinate VeoGeneration and VideoConverter (v1398)
 */
class WhatsAppVideoGeneration {

  /**
   * Generate video for WhatsApp from text prompt
   */
  async generateVideoForWhatsApp(prompt: string, req: Request | null = null): Promise<WhatsAppVideoResult> {
    try {
      logger.info('🎬 Starting Veo 3 text-to-video generation for WhatsApp');

      // 1. Generate Video
      const genResult = await veoGeneration.generateVideoWithText(prompt);

      if (genResult.error || !genResult.filePath || !genResult.result) {
        return {
          success: false,
          error: genResult.error || 'Video generation failed'
        };
      }

      // 2. Return result (Veo videos are usually MP4 allowing for direct sending, but let's check)
      // Actually Veo outputs MP4, compatible with WhatsApp usually.
      // If we need strict compatibility, we can run conversion. 
      // Current implementation in VeoGeneration returns a file path to an MP4.

      // Let's deduce public URL for the original file first
      const originalFileName = path.basename(genResult.filePath);
      const videoUrl = getStaticFileUrl(originalFileName, req);

      logger.info('✅ Veo 3 text-to-video generated successfully');
      logger.info(`🔗 Public URL: ${videoUrl}`);

      return {
        success: true,
        videoUrl: videoUrl,
        description: genResult.text,
        fileName: originalFileName
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      logger.error('❌ Veo 3 text-to-video error:', err as Error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Generate video for WhatsApp from image and text prompt
   */
  async generateVideoFromImageForWhatsApp(prompt: string, imageBuffer: Buffer, req: Request | null = null): Promise<WhatsAppVideoResult> {
    try {
      logger.info('🎬 Starting Veo 3 image-to-video generation for WhatsApp');

      // 1. Generate Video
      const genResult = await veoGeneration.generateVideoWithImage(prompt, imageBuffer);

      if (genResult.error || !genResult.filePath || !genResult.result) {
        return {
          success: false,
          error: genResult.error || 'Video generation failed'
        };
      }

      // 2. Convert for WhatsApp
      // Image-to-video might need strictly compatible format
      const fileName = path.basename(genResult.filePath);
      const convertResult = await videoConverter.convertVideoForWhatsApp(genResult.filePath, fileName);

      const finalFileName = convertResult.fileName; // Using converted or original (fallback)
      // Note: VideoConverter deletes original if conversion success, so genResult.filePath might be invalid now if not fallback

      // 3. Get Public URL
      const videoUrl = getStaticFileUrl(finalFileName, req);

      logger.info('✅ Veo 3 image-to-video generated and prepared successfully');
      logger.info(`🔗 Public URL: ${videoUrl}`);

      return {
        success: true,
        videoUrl: videoUrl,
        description: genResult.text,
        fileName: finalFileName
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      logger.error('❌ Veo 3 image-to-video error:', err as Error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new WhatsAppVideoGeneration();
