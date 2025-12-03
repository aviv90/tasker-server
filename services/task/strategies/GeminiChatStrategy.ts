import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as geminiService from '../../geminiService';
import logger from '../../../utils/logger';
import { TaskStrategy, TextTaskResult } from './types';
import * as taskStore from '../../../store/taskStore';
import { isErrorResult } from '../../../utils/errorHandler';

export class GeminiChatStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: Request): Promise<TextTaskResult> {
        const conversationHistory = request.conversationHistory || [];
        logger.info(`🔮 Gemini chat processing`);
        return await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory) as unknown as TextTaskResult;
    }

    async finalize(taskId: string, result: TextTaskResult, _req: Request, prompt: string): Promise<void> {
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
            // Assuming result can have metadata property even if not in TextTaskResult interface explicitly
            // or I should add it to TextTaskResult
            if ((result as any).metadata) {
                taskResult.metadata = {
                    service: (result as any).metadata.service,
                    model: (result as any).metadata.model,
                    characterCount: (result as any).metadata.characterCount,
                    created_at: (result as any).metadata.created_at
                };
            }

            // Add original prompt for reference
            if ((result as any).originalPrompt) {
                taskResult.originalPrompt = (result as any).originalPrompt;
            }

            await taskStore.set(taskId, taskResult);
            logger.info(`📋 Task ${taskId} completed successfully`);
        } catch (error: any) {
            logger.error(`❌ Error in GeminiChatStrategy.finalize: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}
