import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';

export interface BaseTaskResult {
    success: boolean;
    error?: string;
    cost?: number;
}

export interface ImageTaskResult extends BaseTaskResult {
    imageBuffer?: Buffer;
    videoBuffer?: Buffer;
    text?: string;
}

export interface MusicTaskResult extends BaseTaskResult {
    audioBuffer?: Buffer;
    metadata?: Record<string, unknown>;
    text?: string; // Lyrics or description
}

export interface TextTaskResult extends BaseTaskResult {
    text?: string;
    response?: string;
}

export type TaskResult = ImageTaskResult | MusicTaskResult | TextTaskResult;

export interface TaskStrategy {
    execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: Request): Promise<TaskResult>;
    finalize(taskId: string, result: TaskResult, req: Request, prompt: string): Promise<void>;
}
