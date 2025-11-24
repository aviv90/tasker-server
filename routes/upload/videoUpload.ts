import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../../store/taskStore';
import * as geminiService from '../../services/geminiService';
import * as replicateService from '../../services/replicateService';
import * as kieService from '../../services/kieService';
import { finalizeVideo } from '../../utils/videoUtils';
import { extractErrorMessage } from '../../utils/errorHandler';
import { Request, Response, Router } from 'express';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

interface VideoUploadRequest extends Request {
    file?: Express.Multer.File;
    body: {
        prompt: string;
        provider?: string;
        model?: string;
        [key: string]: any;
    };
}

/**
 * Video upload routes
 */
class VideoUploadRoutes {
  /**
   * Setup video upload routes
   */
  setupRoutes(router: Router, rateLimiter: any = null) {
    const handlers: any[] = [upload.single('file')];
    if (rateLimiter) handlers.push(rateLimiter);

    /**
     * Upload image and convert to video
     */
    router.post('/upload-video', ...handlers, async (req: VideoUploadRequest, res: Response) => {
      const { prompt, provider, model } = req.body;
      if (!prompt || !req.file) {
        res.status(400).json({ status: 'error', error: 'Missing prompt or file' });
        return;
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        let result;
        if (provider === 'replicate') {
          result = await (replicateService as any).generateVideoFromImage(req.file.buffer, prompt ? prompt : null, model);
        } else if (provider === 'gemini') {
          result = await geminiService.generateVideoWithImage(prompt, req.file.buffer);
        } else if (provider === 'kie') {
          result = await kieService.generateVideoWithImage(prompt, req.file.buffer, model);
        } else {
          // Default to replicate for image-to-video generation
          result = await (replicateService as any).generateVideoFromImage(req.file.buffer, prompt ? prompt : null, model);
        }

        await finalizeVideo(taskId, result, prompt, req as any);
      } catch (error) {
        console.error(`❌ Image-to-video error:`, error);
        const errorMessage = extractErrorMessage(error);
        await taskStore.set(taskId, {
          status: 'error',
          error: errorMessage
        });
      }
    });

    /**
     * Upload video and edit it
     */
    router.post('/upload-video-edit', ...handlers, async (req: VideoUploadRequest, res: Response) => {
      const { prompt } = req.body;
      if (!prompt || !req.file) {
        res.status(400).json({ status: 'error', error: 'Missing prompt or file' });
        return;
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        const result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
        await finalizeVideo(taskId, result as { videoUrl?: string; error?: string; cost?: number }, prompt, req as any);
      } catch (error) {
        console.error(`❌ Video-to-video error:`, error);
        const errorMessage = extractErrorMessage(error);
        await taskStore.set(taskId, {
          status: 'error',
          error: errorMessage
        });
      }
    });
  }
}

export default new VideoUploadRoutes();
