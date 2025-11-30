import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import logger from '../../../utils/logger';
import { TaskStrategy } from './types';

export class GeminiChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🔮 Gemini chat processing`);
        return await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory);
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
    }
}
