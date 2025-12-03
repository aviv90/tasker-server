import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import * as replicateService from '../../replicateService';
import * as kieService from '../../kieService';
import { finalizeVideo } from '../../../utils/videoUtils';
import { TaskStrategy, TaskResult } from './types';

export class TextToVideoStrategy implements TaskStrategy {
    async execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: Request): Promise<TaskResult> {
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

    async finalize(_taskId: string, _result: TaskResult, _req: Request, _prompt: string): Promise<void> {
        // Video finalization is complex and currently handled within execute via finalizeVideo util
        // In a deeper refactor, finalizeVideo logic should move here.
    }
}
