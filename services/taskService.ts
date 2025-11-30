import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../store/taskStore';
import { validateAndSanitizePrompt } from '../utils/textSanitizer';
import { isErrorResult } from '../utils/errorHandler';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../utils/tempFileUtils';
import logger from '../utils/logger';
import { StartTaskRequest } from '../schemas/taskSchemas';
import {
    TaskStrategy,
    TextToImageStrategy,
    TextToVideoStrategy,
    TextToMusicStrategy,
    GeminiChatStrategy,
    OpenAIChatStrategy
} from './task/strategies';

export class TaskService {
    private strategies: Map<string, TaskStrategy>;

    constructor() {
        this.strategies = new Map();
        this.strategies.set('text-to-image', new TextToImageStrategy());
        this.strategies.set('text-to-video', new TextToVideoStrategy());
        this.strategies.set('text-to-music', new TextToMusicStrategy());
        this.strategies.set('gemini-chat', new GeminiChatStrategy());
        this.strategies.set('openai-chat', new OpenAIChatStrategy());
    }

    async startTask(request: StartTaskRequest, req: any): Promise<string> {
        const { type, prompt } = request;

        // Validate and sanitize prompt
        const sanitizedPrompt = validateAndSanitizePrompt(prompt);

        const taskId = uuidv4();
        await taskStore.set(taskId, { status: 'pending' });

        // Start async processing
        this.processTask(taskId, request, sanitizedPrompt, req).catch(err => {
            logger.error('❌ Unhandled error in processTask:', { taskId, error: err.message || err.toString() });
            taskStore.set(taskId, { status: 'error', error: err.message || err.toString() });
        });

        return taskId;
    }

    private async processTask(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: any) {
        const { type } = request;
        const strategy = this.strategies.get(type);

        if (!strategy) {
            await taskStore.set(taskId, {
                status: 'error',
                error: `Unsupported task type: ${type}.`
            });
            return;
        }

        try {
            const result = await strategy.execute(taskId, request, sanitizedPrompt, req);

            // If result is null, it means the strategy handled finalization itself (e.g. video)
            if (result === null) return;

            // Handle common finalization based on type
            if (type === 'text-to-image') {
                await this.finalizeTask(taskId, result, req, 'png');
            } else if (type === 'text-to-music') {
                await this.finalizeMusic(taskId, result, sanitizedPrompt, req);
            } else if (type === 'gemini-chat' || type === 'openai-chat') {
                await this.finalizeTextResponse(taskId, result, sanitizedPrompt, req);
            }
        } catch (error: any) {
            logger.error('❌ Error processing task:', { taskId, error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }

    private async finalizeTask(taskId: string, result: any, req: any, fileExtension = 'png') {
        try {
            if (isErrorResult(result)) {
                await taskStore.set(taskId, { status: 'error', ...result });
                return;
            }

            const filename = `${taskId}.${fileExtension}`;
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
            logger.error(`❌ Error in finalizeTask: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }

    private async finalizeMusic(taskId: string, result: any, prompt: string, req: any) {
        try {
            if (isErrorResult(result)) {
                logger.error(`❌ Music generation failed for task ${taskId}: ${result.error}`);
                await taskStore.set(taskId, { status: 'error', error: result.error });
                return;
            }

            const filename = `${taskId}.mp3`;
            // Use centralized temp directory (SSOT with static route)
            const outputDir = getTempDir();
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, filename);

            if (result.audioBuffer) {
                fs.writeFileSync(outputPath, result.audioBuffer);
                logger.info(`✅ Music file saved: ${filename}`);
            } else {
                logger.error(`❌ No audio buffer in result for task ${taskId}`);
                await taskStore.set(taskId, { status: 'error', error: 'No audio buffer data' });
                return;
            }

            const host = `${req.protocol}://${req.get('host')}`;
            const taskResult: any = {
                status: 'done',
                result: `${host}/static/${filename}`,
                text: result.text || prompt,
                type: 'music'
            };

            // Add metadata if available
            if (result.metadata) {
                taskResult.metadata = {
                    title: result.metadata.title,
                    duration: result.metadata.duration,
                    tags: result.metadata.tags,
                    model: result.metadata.model,
                    type: result.metadata.type
                };
            }

            await taskStore.set(taskId, taskResult);
            logger.info(`✅ Music generation completed for task ${taskId}`);

        } catch (error: any) {
            logger.error(`❌ Error in finalizeMusic: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }

    private async finalizeTextResponse(taskId: string, result: any, prompt: string, _req: any) {
        try {
            if (isErrorResult(result)) {
                logger.error(`❌ Text generation failed for task ${taskId}: ${result.error}`);
                await taskStore.set(taskId, { status: 'error', error: result.error });
                return;
            }

            const taskResult: any = {
                status: 'done',
                result: result.text || prompt,
                text: result.text || prompt,
                type: 'text'
            };

            // Add metadata if available
            if (result.metadata) {
                taskResult.metadata = {
                    service: result.metadata.service,
                    model: result.metadata.model,
                    characterCount: result.metadata.characterCount,
                    created_at: result.metadata.created_at
                };
            }

            // Add original prompt for reference
            if (result.originalPrompt) {
                taskResult.originalPrompt = result.originalPrompt;
            }

            await taskStore.set(taskId, taskResult);
            logger.info(`📋 Task ${taskId} completed successfully`);
        } catch (error: any) {
            logger.error(`❌ Error in finalizeTextResponse: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}

export const taskService = new TaskService();
