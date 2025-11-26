/**
 * Kie Service Download Logic
 */

import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createTempFilePath, verifyFileWritten } from '../../utils/tempFileUtils';
import { TIME } from '../../utils/constants';
import path from 'path';
import logger from '../../utils/logger';

/**
 * Download result
 */
interface DownloadResult {
  videoBuffer?: Buffer;
  result?: string;
  error?: string;
}

/**
 * Download video from URL and save to temp file
 */
export async function downloadVideoFile(videoUrl: string, model: string): Promise<DownloadResult> {
  logger.info(`✅ Kie.ai ${model} video generation completed! Downloading...`);

  const tempFileName = `temp_video_${uuidv4()}.mp4`;
  const tempFilePath = createTempFilePath(tempFileName);

  try {
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    fs.writeFileSync(tempFilePath, videoBuffer);

    // Verify file was written correctly
    const verifyResult = await verifyFileWritten(tempFilePath, TIME.FILE_VERIFY_TIMEOUT, TIME.FILE_VERIFY_RETRIES);

    if (!verifyResult.success) {
      logger.error('❌ Video file was not properly downloaded', { error: verifyResult.error });
      return { error: verifyResult.error || 'Video file was not downloaded successfully' };
    }

    const finalVideoBuffer = fs.readFileSync(tempFilePath);
    const filename = path.basename(tempFilePath);
    const publicPath = `/static/${filename}`;

    return {
      videoBuffer: finalVideoBuffer,
      result: publicPath
    };

  } catch (downloadError: unknown) {
    const errorMessage = downloadError instanceof Error ? downloadError.message : String(downloadError);
    logger.error(`❌ Kie.ai ${model} video download failed:`, { error: errorMessage, stack: downloadError instanceof Error ? downloadError.stack : undefined });
    return { error: `Video download failed: ${errorMessage}` };
  }
}

