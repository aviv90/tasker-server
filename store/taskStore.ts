/**
 * Task Store - Manages async task tracking for API routes
 * 
 * Uses PostgreSQL database through conversationManager for persistent storage
 * Allows tasks to survive server restarts and work across multiple instances
 */

import conversationManager from '../services/conversationManager';
import logger from '../utils/logger';

export interface TaskData {
    status?: 'pending' | 'done' | 'failed' | 'error';
    result?: unknown;
    error?: string | null;
    text?: string;
    cost?: number;
    type?: string;
    timestamp?: string;
    [key: string]: unknown;
}

export async function set(taskId: string, data: TaskData): Promise<void> {
    try {
        const status = data.status || 'pending';
        await conversationManager.saveTask(taskId, status, {
            result: data.status === 'done' ? data : null,
            error: data.error
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Error setting task in taskStore:', { error: errorMessage, taskId });
    }
}

export async function get(taskId: string): Promise<TaskData | null> {
    try {
        const result = await conversationManager.getTask(taskId);
        // Ensure result matches TaskData interface
        if (result === null || result === undefined) {
            return null;
        }
        return result as TaskData;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('❌ Error getting task from taskStore:', { error: errorMessage, taskId });
        return null;
    }
}
