import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as openaiService from '../../openai';
import logger from '../../../utils/logger';
import { TaskStrategy } from './types';

export class OpenAIChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🤖 Generating OpenAI chat response`);
        return await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory);
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
    }
}
