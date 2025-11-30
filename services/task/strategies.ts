import { StartTaskRequest } from '../../schemas/taskSchemas';
import * as geminiService from '../geminiService';
import * as openaiService from '../openai';
import * as replicateService from '../replicateService';
import * as kieService from '../kieService';
import * as musicService from '../musicService';
import { finalizeVideo } from '../../utils/videoUtils';
import logger from '../../utils/logger';

export interface TaskStrategy {
    execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: any): Promise<any>;
    finalize(taskId: string, result: any, req: any, prompt: string): Promise<void>;
}

export class TextToImageStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const { provider } = request;
        if (provider === 'openai') {
            return await openaiService.generateImageWithText(sanitizedPrompt);
        } else {
            return await geminiService.generateImageWithText(sanitizedPrompt);
        }
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
        // This will be handled by the common finalizeTask method in TaskService for now, 
        // or we can move the specific finalization logic here.
        // For this refactor, I will keep the finalization logic generic in TaskService 
        // but allow strategies to return the result format expected by it.
    }
}

export class TextToVideoStrategy implements TaskStrategy {
    async execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: any): Promise<any> {
        const { provider, model } = request;
        let result;
        if (provider === 'replicate') {
            result = await replicateService.generateVideoWithText(sanitizedPrompt, model);
        } else if (provider === 'gemini') {
            result = await geminiService.generateVideoWithText(sanitizedPrompt);
        } else if (provider === 'kie') {
            result = await kieService.generateVideoWithText(sanitizedPrompt, model);
        } else {
            // Default to replicate for video generation
            result = await replicateService.generateVideoWithText(sanitizedPrompt, model);
        }

        // Finalize video immediately as it has specific logic (finalizeVideo util)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await finalizeVideo(taskId, result as any, sanitizedPrompt, req as any);

        // Return null/undefined to indicate finalization is already done or handled
        return null;
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
        // Video finalization is complex and currently handled within execute via finalizeVideo util
        // In a deeper refactor, finalizeVideo logic should move here.
    }
}

export class TextToMusicStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const options: Record<string, any> = {};

        // Allow model selection and advanced options
        if (request.model) options.model = request.model;
        if (request.style) options.style = request.style;
        if (request.duration) options.duration = request.duration;
        if (request.genre) options.genre = request.genre;
        if (request.mood) options.mood = request.mood;
        if (request.tempo) options.tempo = request.tempo;
        if (request.instruments) options.instruments = request.instruments;
        if (request.vocalStyle) options.vocalStyle = request.vocalStyle;
        if (request.language) options.language = request.language;
        if (request.key) options.key = request.key;
        if (request.timeSignature) options.timeSignature = request.timeSignature;
        if (request.quality) options.quality = request.quality;
        if (request.customMode !== undefined) options.customMode = request.customMode;

        // Check if user specifically wants instrumental (optional)
        const isInstrumental = request.instrumental === true;
        const isAdvanced = request.advanced === true;

        logger.info(`🎵 Generating ${isInstrumental ? 'instrumental' : 'vocal'} music ${isAdvanced ? 'with advanced V5 features' : ''}`);

        if (isAdvanced) {
            return await musicService.generateAdvancedMusic(sanitizedPrompt, options);
        } else if (isInstrumental) {
            return await musicService.generateInstrumentalMusic(sanitizedPrompt, options);
        } else {
            return await musicService.generateMusicWithLyrics(sanitizedPrompt, options);
        }
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
        // Music finalization logic will be called by TaskService using this result
    }
}

export class GeminiChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🔮 Gemini chat processing`);
        return await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory);
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
    }
}

export class OpenAIChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🤖 Generating OpenAI chat response`);
        return await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory);
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
    }
}
