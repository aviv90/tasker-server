import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../../store/taskStore';
import * as geminiService from '../../services/geminiService';
import * as openaiService from '../../services/openai';
import { validateAndSanitizePrompt } from '../../utils/textSanitizer';
import { extractErrorMessage } from '../../utils/errorHandler';
import finalizers from './finalizers';
import { Request, Response, Router } from 'express';
import logger from '../../utils/logger';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

interface ImageUploadRequest extends Request {
    file?: Express.Multer.File;
    body: {
        prompt: string;
        provider?: string;
        [key: string]: any;
    };
}

/**
 * Image upload routes
 */
class ImageUploadRoutes {
  /**
   * Setup image upload routes
   */
  setupRoutes(router: Router, rateLimiter: any = null) {
    /**
     * Upload and edit image
     */
    const handlers: any[] = [upload.single('file')];
    if (rateLimiter) handlers.push(rateLimiter);
    
    handlers.push(async (req: ImageUploadRequest, res: Response) => {
      const { prompt, provider } = req.body;

      // Validate required fields
      if (!prompt || !req.file) {
        res.status(400).json({
          status: 'error',
          error: 'Missing prompt or file'
        });
        return;
      }

      // Validate and sanitize prompt
      let sanitizedPrompt;
      try {
        sanitizedPrompt = validateAndSanitizePrompt(prompt);
      } catch (validationError: any) {
        res.status(400).json({
          status: 'error',
          error: validationError.message
        });
        return;
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        let result;
        if (provider === 'openai') {
          result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
        } else if (provider === 'gemini') {
          const base64 = req.file.buffer.toString('base64');
          result = await geminiService.editImageWithText(sanitizedPrompt, base64);
        } else {
          // Default to openai for image editing
          result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
        }

        await finalizers.finalize(taskId, result, req);
      } catch (error: unknown) {
        logger.error(`❌ Image edit error:`, { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
        const errorMessage = extractErrorMessage(error);
        await taskStore.set(taskId, {
          status: 'error',
          error: errorMessage
        });
      }
    });
    
    router.post('/upload-edit', ...handlers);
  }
}

export default new ImageUploadRoutes();
