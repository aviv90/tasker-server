import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import * as openaiService from '../../openai';
import { TaskStrategy } from './types';

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
