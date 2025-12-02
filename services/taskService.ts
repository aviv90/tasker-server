import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../store/taskStore';
import { validateAndSanitizePrompt } from '../utils/textSanitizer';
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

            // Delegate finalization to the strategy
            await strategy.finalize(taskId, result, req, sanitizedPrompt);

        } catch (error: any) {
            logger.error('❌ Error processing task:', { taskId, error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}

export const taskService = new TaskService();
