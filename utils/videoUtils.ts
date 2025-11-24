/**
 * Video Utilities
 * Helper functions for video processing and finalization
 */

import { Request } from 'express';
import { isErrorResult, getTaskError, extractErrorMessage } from './errorHandler';
import * as taskStore from '../store/taskStore';
import fs from 'fs';
import path from 'path';

/**
 * Video result structure from providers
 */
interface VideoResult {
  result?: string;
  videoBuffer?: Buffer;
  text?: string;
  cost?: number;
  error?: unknown;
}

/**
 * Finalize video task - save video buffer to file and update task store
 * @param taskId - Task ID
 * @param result - Video result from provider
 * @param prompt - Original prompt
 * @param req - Express request object (optional, for host URL)
 */
export async function finalizeVideo(
  taskId: string,
  result: VideoResult,
  prompt: string | null | undefined,
  req: Request | null = null
): Promise<void> {
  try {
    if (isErrorResult(result)) {
      const taskError = getTaskError(result);
      await taskStore.set(taskId, {
        status: 'error',
        error: typeof taskError.error === 'string' ? taskError.error : extractErrorMessage(taskError.error)
      });
      return;
    }
    
    let videoURL: string | undefined = result.result; // expected URL from providers like replicate/gemini

    // Handle Gemini path: returns videoBuffer (no result URL yet)
    if (!videoURL && result.videoBuffer) {
      const filename = `${taskId}.mp4`;
      const outputDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, result.videoBuffer);
      videoURL = `/static/${filename}`;
    }
    
    // If videoBuffer exists but result also exists (Gemini case), save the buffer to the correct file
    if (result.videoBuffer && videoURL && videoURL.startsWith('/static/')) {
      const filename = path.basename(videoURL);
      const outputDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, result.videoBuffer);
    }
    
    // Handle cases where videoURL starts with /static/ and needs host prefix
    if (req && videoURL && videoURL.startsWith('/static/')) {
      const host = `${req.protocol}://${req.get('host')}`;
      videoURL = `${host}${videoURL}`;
    }
    
    await taskStore.set(taskId, {
      status: 'done',
      result: videoURL || undefined,
      text: result.text || prompt || undefined,
      cost: result.cost || undefined
    });
  } catch (error) {
    console.error('❌ Error in finalizeVideo:', error);
    const taskError = getTaskError(error, 'Failed to finalize video');
    await taskStore.set(taskId, {
      status: 'error',
      error: typeof taskError.error === 'string' ? taskError.error : extractErrorMessage(taskError.error),
      result: null
    });
  }
}

