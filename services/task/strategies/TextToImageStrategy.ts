import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import * as openaiService from '../../openai';
import { TaskStrategy, ImageTaskResult } from './types';
import * as taskStore from '../../../store/taskStore';
import { isErrorResult } from '../../../utils/errorHandler';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../../../utils/tempFileUtils';
import logger from '../../../utils/logger';

export class TextToImageStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: Request): Promise<ImageTaskResult> {
        const { provider } = request;
        if (provider === 'openai') {
            return await openaiService.generateImageWithText(sanitizedPrompt) as ImageTaskResult;
        } else {
            return await geminiService.generateImageWithText(sanitizedPrompt) as ImageTaskResult;
        }
    }

    async finalize(taskId: string, result: ImageTaskResult, req: Request, _prompt: string): Promise<void> {
        try {
            if (isErrorResult(result)) {
                await taskStore.set(taskId, { status: 'error', ...result });
                return;
            }

            const filename = `${taskId}.png`;
            // Use centralized temp directory (SSOT with static route)
            const outputDir = getTempDir();
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, filename);

            if (result.textOnly) {
                logger.info(`📝 TextToImageStrategy: Received text-only response for task ${taskId}`);
                await taskStore.set(taskId, {
                    status: 'done',
                    result: null, // No image URL
                    text: result.text,
                    cost: result.cost
                });
                return;
            }

            const buffer = result.imageBuffer || result.videoBuffer;

            if (buffer) {
                fs.writeFileSync(outputPath, buffer);
            } else {
                await taskStore.set(taskId, { status: 'error', error: 'No buffer data (NO_BUFFER)' });
                return;
            }

            const host = `${req.protocol}://${req.get('host')}`;
            const taskResult: Record<string, unknown> = {
                status: 'done',
                result: `${host}/static/${filename}`,
                text: result.text,
                cost: result.cost
            };

            await taskStore.set(taskId, taskResult);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Error in TextToImageStrategy.finalize: ${taskId}`, { error: errorMessage });
            await taskStore.set(taskId, { status: 'error', error: errorMessage });
        }
    }
}
