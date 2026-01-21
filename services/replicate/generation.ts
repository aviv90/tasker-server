import Replicate from 'replicate';
import fs from 'fs';
import path from 'path';
import { MODELS } from './models';
import helpers from './helpers';
import { getTempDir } from '../../utils/tempFileUtils';
import logger from '../../utils/logger';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY,
});

/**
 * Input parameters for video generation
 */
interface InputParams {
  prompt?: string;
  image?: string;
  start_image?: string;
  duration?: number;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  negative_prompt?: string;
  video?: string;
  [key: string]: unknown;
}

/**
 * Video generation result
 */
interface VideoGenerationResult {
  text?: string;
  result?: string;
  cost?: string;
  error?: string;
}

/**
 * Replicate video generation operations
 * NOTE: Veo 3 is handled by GeminiService, NOT by Replicate.
 * This service handles: Kling (text/image to video), RunwayML (video to video)
 */
class ReplicateGeneration {
  /**
   * Build input parameters for Kling model
   */
  buildInputParams(prompt: string, base64Image: string | null = null): InputParams {
    if (base64Image) {
      // Image-to-video (Kling)
      return {
        start_image: base64Image,
        prompt: prompt || "animate this image with smooth motion",
        duration: 5,
        aspect_ratio: "9:16"
      };
    } else {
      // Text-to-video (Kling)
      return {
        prompt: prompt,
        aspect_ratio: "9:16",
        duration: 5,
        negative_prompt: ""
      };
    }
  }

  /**
   * Generate video from text prompt (Kling only)
   */
  async generateVideoWithText(prompt: string, model = 'kling'): Promise<VideoGenerationResult> {
    try {
      // ENFORCE: Only Kling is supported via Replicate. Veo3 must use GeminiService.
      if (model === 'veo3') {
        logger.error('❌ Veo3 requested via Replicate - this is incorrect! Veo3 must use GeminiService.');
        return { error: 'Veo3 must use Google Gemini API, not Replicate. Use geminiService.generateVideoForWhatsApp() instead.' };
      }

      logger.info('🎬 Starting Kling v2.1 Master text-to-video generation');

      const inputParams = this.buildInputParams(prompt);

      const prediction = await replicate.predictions.create({
        version: MODELS.TEXT_TO_VIDEO,
        input: inputParams
      });

      if (!prediction?.id) {
        return { error: 'No prediction ID received from Replicate' };
      }

      logger.debug('🔄 Polling for completion');

      const maxAttempts = 80;
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'text-to-video generation');

      if (!pollResult.success) {
        return { error: pollResult.error };
      }

      logger.info('✅ Text-to-video completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result?.output);

      return {
        text: prompt,
        result: videoURL,
        cost: helpers.calculateCost(pollResult.result)
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Text-to-video generation error:', errorMessage);
      return { error: helpers.extractErrorDetails(err) };
    }
  }

  /**
   * Generate video from image and text prompt (Kling only)
   */
  async generateVideoFromImage(imageBuffer: Buffer, prompt: string | null = null, model = 'kling'): Promise<VideoGenerationResult> {
    try {
      // ENFORCE: Only Kling is supported via Replicate. Veo3 must use GeminiService.
      if (model === 'veo3') {
        logger.error('❌ Veo3 requested via Replicate - this is incorrect! Veo3 must use GeminiService.');
        return { error: 'Veo3 must use Google Gemini API, not Replicate. Use geminiService.generateVideoFromImageForWhatsApp() instead.' };
      }

      logger.info('🎬 Starting Kling v2.1 Master image-to-video generation');

      const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      const input = this.buildInputParams(prompt || '', base64Image);

      const prediction = await replicate.predictions.create({
        version: MODELS.IMAGE_TO_VIDEO,
        input: input
      });

      if (!prediction?.id) {
        return { error: 'No prediction ID received from Replicate' };
      }

      logger.debug('🔄 Polling for completion');

      const maxAttempts = 80;
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'image-to-video generation');

      if (!pollResult.success) {
        return { error: pollResult.error };
      }

      logger.info('✅ Image-to-video completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result?.output);

      return {
        text: prompt || 'Image to video conversion',
        result: videoURL,
        cost: helpers.calculateCost(pollResult.result)
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Image-to-video generation error:', errorMessage);
      return { error: helpers.extractErrorDetails(err) };
    }
  }

  /**
   * Generate video from video and text prompt (RunwayML)
   */
  async generateVideoFromVideo(inputVideoBuffer: Buffer, prompt: string): Promise<{ result?: string; error?: string }> {
    try {
      logger.info('🎬 Starting video-to-video generation');

      // Use centralized temp directory (SSOT with static route)
      const tempDir = getTempDir();
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
      fs.writeFileSync(tempVideoPath, inputVideoBuffer);

      const videoBase64 = fs.readFileSync(tempVideoPath).toString('base64');
      const videoDataUrl = `data:video/mp4;base64,${videoBase64}`;

      const input = {
        prompt: prompt,
        video: videoDataUrl,
        aspect_ratio: "16:9"
      };

      logger.debug('🔄 Calling Replicate API');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await replicate.run(MODELS.VIDEO_TO_VIDEO, { input }) as any;

      // Clean up temp file
      try {
        fs.unlinkSync(tempVideoPath);
      } catch (cleanupError: unknown) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        logger.warn('Could not clean up temp file:', errorMessage);
      }

      if (!output) {
        throw new Error('No output received from Replicate');
      }

      // Handle ReadableStream response
      if (output && typeof output.getReader === 'function') {
        logger.debug('🔄 Converting ReadableStream to file');

        const reader = output.getReader();
        const chunks: Uint8Array[] = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
            }
          }

          const videoBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
          const outputFilename = `video_${Date.now()}.mp4`;
          // Use centralized temp directory (SSOT with static route)
          const outputDir = getTempDir();
          const outputPath = path.join(outputDir, outputFilename);

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(outputPath, videoBuffer);
          logger.info('✅ Video-to-video completed');

          return { result: `/static/${outputFilename}` };

        } catch (streamError: unknown) {
          const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
          throw new Error(`Failed to read video stream: ${errorMessage}`);
        }
      } else {
        // Handle direct URL response
        const videoURL = helpers.extractVideoUrl(output);
        return { result: videoURL };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Video-to-video generation error:', errorMessage);
      throw error;
    }
  }
}

export default new ReplicateGeneration();
