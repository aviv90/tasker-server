import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import * as openaiService from '../../openai';
import { TaskStrategy } from './types';
import * as taskStore from '../../../store/taskStore';
import { isErrorResult } from '../../../utils/errorHandler';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../../../utils/tempFileUtils';
import logger from '../../../utils/logger';

export class TextToImageStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const { provider } = request;
        if (provider === 'openai') {
            return await openaiService.generateImageWithText(sanitizedPrompt);
        } else {
            return await geminiService.generateImageWithText(sanitizedPrompt);
        }
    }

    async finalize(taskId: string, result: any, req: any, _prompt: string): Promise<void> {
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

            const buffer = result.imageBuffer || result.videoBuffer;

            if (buffer) {
                fs.writeFileSync(outputPath, buffer);
            } else {
                await taskStore.set(taskId, { status: 'error', error: 'No buffer data (NO_BUFFER)' });
                return;
            }

            const host = `${req.protocol}://${req.get('host')}`;
            await taskStore.set(taskId, {
                status: 'done',
                result: `${host}/static/${filename}`,
                text: result.text,
                cost: result.cost
            });
        } catch (error: any) {
            logger.error(`❌ Error in TextToImageStrategy.finalize: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}
