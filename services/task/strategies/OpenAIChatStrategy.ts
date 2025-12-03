import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as openaiService from '../../openai';
import logger from '../../../utils/logger';
import { TaskStrategy, TextTaskResult } from './types';
import * as taskStore from '../../../store/taskStore';
import { isErrorResult } from '../../../utils/errorHandler';

export class OpenAIChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: Request): Promise<TextTaskResult> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🤖 Generating OpenAI chat response`);
        return await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory) as unknown as TextTaskResult;
    }

    async finalize(taskId: string, result: TextTaskResult, _req: Request, prompt: string): Promise<void> {
        try {
            if (isErrorResult(result)) {
                logger.error(`❌ Text generation failed for task ${taskId}: ${result.error}`);
                await taskStore.set(taskId, { status: 'error', error: result.error });
                return;
            }

            const taskResult: Record<string, unknown> = {
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
            logger.error(`❌ Error in OpenAIChatStrategy.finalize: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}
