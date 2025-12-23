import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../store/taskStore';
import { validateAndSanitizePrompt } from '../utils/textSanitizer';
import logger from '../utils/logger';
import { StartTaskRequest } from '../schemas/taskSchemas';

import { getServices } from './agent/utils/serviceLoader';
import replicateService from './replicate/whatsapp';
import musicService from './musicService';

export class TaskService {

    constructor() { }

    async startTask(request: StartTaskRequest, req: any): Promise<string> {
        const { prompt } = request;

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
        const { geminiService, openaiService } = getServices();

        try {
            logger.info(`🚀 Processing task ${taskId} of type ${type}`);
            let result: any = null;

            switch (type) {
                case 'text-to-image':
                    // Defaulting to Gemini for API tasks for now
                    // Note: generateImage in facade handles args
                    result = await geminiService.generateImageForWhatsApp(sanitizedPrompt);
                    break;

                case 'text-to-video':
                    // Using Replicate (Kling)
                    const videoRes = await replicateService.generateVideoWithTextForWhatsApp(sanitizedPrompt, req);
                    if (videoRes.success) {
                        result = { url: videoRes.videoUrl, success: true };
                    } else {
                        throw new Error(videoRes.error || 'Video generation failed');
                    }
                    break;

                case 'text-to-music':
                    // Using generateMusicWithLyrics as default
                    if (musicService && musicService.generateMusicWithLyrics) {
                        const musicRes = await musicService.generateMusicWithLyrics(sanitizedPrompt);
                        result = musicRes;
                    } else {
                        throw new Error('Music service not available');
                    }
                    break;

                case 'gemini-chat':
                    const chatRes = await geminiService.generateTextResponse(sanitizedPrompt);
                    result = { text: chatRes };
                    break;

                case 'openai-chat':
                    const gptRes = await openaiService.generateTextResponse(sanitizedPrompt);
                    result = { text: gptRes };
                    break;

                default:
                    throw new Error(`Unsupported task type: ${type}`);
            }

            // Finalize / Save result
            if (result) {
                await taskStore.set(taskId, {
                    status: 'done',
                    result: result,
                    timestamp: new Date().toISOString()
                });
                logger.info(`✅ Task ${taskId} completed`);
            } else {
                throw new Error('Task produced no result');
            }

        } catch (error: any) {
            logger.error('❌ Error processing task:', { taskId, error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}

export const taskService = new TaskService();
