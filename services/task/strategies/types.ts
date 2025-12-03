import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';

export interface BaseTaskResult {
    success: boolean;
    error?: string;
    cost?: number;
}

export interface ImageTaskResult extends BaseTaskResult {
    result?: string; // URL of the generated image
    imageBuffer?: Buffer;
    videoBuffer?: Buffer;
    text?: string; // Description or text response
    textOnly?: boolean; // Flag indicating if only text was returned (no image)
    cost?: number;
}

export interface MusicTaskResult extends BaseTaskResult {
    audioBuffer?: Buffer;
    metadata?: Record<string, unknown>;
    text?: string; // Lyrics or description
    textOnly?: boolean;
}

export interface TextTaskResult extends BaseTaskResult {
    text?: string;
    response?: string;
    metadata?: {
        service?: string;
        model?: string;
        characterCount?: number;
        created_at?: string;
        [key: string]: unknown;
    };
    originalPrompt?: string;
}

export interface VideoTaskResult extends BaseTaskResult {
    videoUrl?: string;
    videoBuffer?: Buffer;
    text?: string;
    metadata?: Record<string, unknown>;
}

export type TaskResult = ImageTaskResult | MusicTaskResult | TextTaskResult | VideoTaskResult | null;

export interface TaskStrategy {
    execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: Request): Promise<TaskResult>;
    finalize(taskId: string, result: TaskResult, req: Request, prompt: string): Promise<void>;
}
