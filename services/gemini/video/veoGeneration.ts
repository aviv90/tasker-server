// eslint-disable-next-line @typescript-eslint/no-require-imports
const genai = require('@google/genai');
import { sanitizeText } from '../../../utils/textSanitizer';
import { createTempFilePath } from '../../../utils/tempFileUtils';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TIME, FILE_SIZE } from '../../../utils/constants';
import logger from '../../../utils/logger';

const veoClient = new genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Poll result
 */
interface PollResult {
  done?: boolean;
  response?: {
    generatedVideos?: Array<{
      video?: unknown;
    }>;
    raiMediaFilteredReasons?: string[];
  };
  error?: string;
}

/**
 * Validation error
 */
interface ValidationError {
  error: string;
}

/**
 * Download result
 */
interface DownloadResult {
  filePath?: string;
  fileName?: string;
  error?: string;
}

/**
 * File ready result
 */
interface FileReadyResult {
  success?: boolean;
  error?: string;
}

/**
 * Video generation result
 */
interface VideoGenerationResult {
  text?: string;
  videoBuffer?: Buffer;
  result?: string;
  filePath?: string;
  error?: string;
}

/**
 * Veo video generation operations
 */
class VeoGeneration {
  /**
   * Poll operation until completion
   */
  async pollOperation(operation: unknown, operationType = 'video generation'): Promise<PollResult> {
    logger.info('⏳ Polling for video generation completion...');
    const maxWaitTime = TIME.VIDEO_GENERATION_TIMEOUT;
    const startTime = Date.now();
    let pollAttempts = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentOperation = operation as any;
    while (!currentOperation.done) {
      if (Date.now() - startTime > maxWaitTime) {
        logger.error(`❌ Veo 3 ${operationType} timed out`);
        return { error: `Video generation timed out after 10 minutes` };
      }
      await new Promise(resolve => setTimeout(resolve, TIME.POLL_INTERVAL_STANDARD));
      pollAttempts++;
      logger.info(`🔄 Polling attempt ${pollAttempts} for Veo 3 ${operationType}`);
      currentOperation = await veoClient.operations.getVideosOperation({ operation: currentOperation });
    }

    return currentOperation;
  }

  /**
   * Validate operation response
   */
  validateOperationResponse(operation: unknown): ValidationError | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = operation as any;
    if (!op.response || !op.response.generatedVideos ||
      !op.response.generatedVideos.length ||
      !op.response.generatedVideos[0] ||
      !op.response.generatedVideos[0].video) {
      logger.error('❌ Invalid Veo 3 response structure:', operation as Error);

      let errorMessage = 'Invalid response from Veo 3 API';
      if (op.response && op.response.raiMediaFilteredReasons && op.response.raiMediaFilteredReasons.length > 0) {
        errorMessage = op.response.raiMediaFilteredReasons[0];
      }

      return { error: errorMessage };
    }

    return null;
  }

  /**
   * Download video file from Veo
   */
  async downloadVideoFile(videoFile: unknown, fileNamePrefix = 'temp'): Promise<DownloadResult> {
    const tempFileName = `${fileNamePrefix}_video_${uuidv4()}.mp4`;
    // Use createTempFilePath for consistent path resolution (uses config.paths.tmp)
    const tempFilePath = createTempFilePath(tempFileName);
    const tmpDir = path.dirname(tempFilePath);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    try {
      await veoClient.files.download({ file: videoFile, downloadPath: tempFilePath });
      logger.info('📥 SDK download completed');
    } catch (downloadError: unknown) {
      const errorMessage = downloadError instanceof Error ? downloadError.message : String(downloadError);
      logger.error('❌ SDK download failed:', downloadError as Error);
      return { error: `Failed to download video file: ${errorMessage}` };
    }

    return { filePath: tempFilePath, fileName: tempFileName };
  }

  /**
   * Wait for file to be ready
   */
  async waitForFileReady(filePath: string, minSize: number | null = null): Promise<FileReadyResult> {
    if (minSize === null) {
      minSize = FILE_SIZE.MIN_FILE_SIZE * 10; // Default to 10KB
    }
    let retries = 0;
    let fileReady = false;
    const maxRetries = TIME.FILE_VERIFY_RETRIES;

    while (!fileReady && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);

          if (stats.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const newStats = fs.statSync(filePath);

            if (newStats.size === stats.size && stats.size > minSize) {
              fileReady = true;
              break;
            }
          }
        } catch (_statError) {
          // Continue retrying
        }
      }
      retries++;
    }

    if (!fileReady) {
      logger.error('❌ Video file was not properly downloaded');
      return { error: 'Video file was not downloaded successfully' };
    }

    return { success: true };
  }

  /**
   * Generate video from text prompt
   */
  async generateVideoWithText(prompt: string): Promise<VideoGenerationResult> {
    try {
      logger.info('🎬 Starting Veo 3 text-to-video generation - Stable version');
      const cleanPrompt = sanitizeText(prompt);


      let operation = await veoClient.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt: cleanPrompt,
        config: {
          aspectRatio: "9:16"
        }
      } as any);

      const pollResult = await this.pollOperation(operation, 'text-to-video generation');
      if (pollResult.error) {
        return { error: pollResult.error };
      }
      operation = pollResult;

      const validationError = this.validateOperationResponse(operation);
      if (validationError) {
        return validationError;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op = operation as any;
      const videoFile = op.response.generatedVideos[0].video;
      const downloadResult = await this.downloadVideoFile(videoFile, 'temp');
      if (downloadResult.error || !downloadResult.filePath || !downloadResult.fileName) {
        return { error: downloadResult.error || 'Download failed' };
      }

      const { filePath } = downloadResult;
      const fileReadyResult = await this.waitForFileReady(filePath, TIME.FILE_VERIFY_TIMEOUT);
      if (fileReadyResult.error) {
        return { error: fileReadyResult.error };
      }

      logger.info('✅ Veo 3 text-to-video generated successfully.');

      const videoBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const publicPath = `/static/${filename}`;

      return {
        text: cleanPrompt,
        videoBuffer: videoBuffer,
        result: publicPath,
        filePath: filePath
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('❌ Veo 3 text-to-video generation error:', err as Error);
      return { error: errorMessage };
    }
  }

  /**
   * Generate video from image and text prompt
   */
  async generateVideoWithImage(prompt: string, imageBuffer: Buffer): Promise<VideoGenerationResult> {
    try {
      logger.info('🎬 Starting Veo 3 image-to-video generation');

      const cleanPrompt = sanitizeText(prompt);
      const imageBase64 = imageBuffer.toString('base64');

      let operation = await veoClient.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt: cleanPrompt,
        image: {
          imageBytes: imageBase64,
          mimeType: "image/jpeg",
        },
        config: {
          aspectRatio: "9:16"
        }
      } as any);

      const pollResult = await this.pollOperation(operation, 'image-to-video generation');
      if (pollResult.error) {
        return { error: pollResult.error };
      }
      operation = pollResult;

      const validationError = this.validateOperationResponse(operation);
      if (validationError) {
        return validationError;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op = operation as any;
      const videoFile = op.response.generatedVideos[0].video;
      const downloadResult = await this.downloadVideoFile(videoFile, 'temp');
      if (downloadResult.error || !downloadResult.filePath || !downloadResult.fileName) {
        return { error: downloadResult.error || 'Download failed' };
      }

      const { filePath } = downloadResult;
      const fileReadyResult = await this.waitForFileReady(filePath, TIME.FILE_VERIFY_TIMEOUT);
      if (fileReadyResult.error) {
        return { error: fileReadyResult.error };
      }

      logger.info('✅ Veo 3 image-to-video generated successfully.');

      const videoBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const publicPath = `/static/${filename}`;

      return {
        text: cleanPrompt,
        videoBuffer: videoBuffer,
        result: publicPath,
        filePath: filePath
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('❌ Veo 3 image-to-video generation error:', err as Error);
      return { error: errorMessage };
    }
  }
}

export default new VeoGeneration();
