/**
 * Scheduled Tasks Service
 * Handles business logic for scheduling and executing messages.
 */

import ScheduledTasksRepository, { ScheduledTask } from '../../repositories/scheduledTasksRepository';
import logger from '../../utils/logger';
import { sendTextMessage } from '../greenApi/messaging';

class ScheduledTasksService {
    private repository: ScheduledTasksRepository;

    constructor(repository: ScheduledTasksRepository) {
        this.repository = repository;
    }

    /**
     * Schedule a new message
     */
    async scheduleMessage(chatId: string, content: string, scheduledAt: Date): Promise<ScheduledTask> {
        logger.info(`📅 Scheduling message for ${chatId} at ${scheduledAt.toISOString()}`);

        // Idempotency: Check if similar task exists
        const existing = await this.repository.findSimilarPending(chatId, content, scheduledAt);
        if (existing) {
            logger.info(`♻️ [Idempotency] Found existing pending task ${existing.id}, returning it.`);
            return existing;
        }

        return this.repository.create(chatId, content, scheduledAt);
    }

    /**
     * Process all due tasks
     */
    async processDueTasks(): Promise<void> {
        try {
            const dueTasks = await this.repository.findDue();

            if (dueTasks.length === 0) return;

            logger.info(`⏰ Found ${dueTasks.length} due scheduled tasks`);

            for (const task of dueTasks) {
                await this.executeTask(task);
            }
        } catch (error: unknown) {
            logger.error('❌ Error processing due tasks:', error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Execute a single task
     */
    private async executeTask(task: ScheduledTask): Promise<void> {
        try {
            logger.info(`🚀 Executing scheduled task ${task.id} for ${task.chatId}`);

            // Send the message
            await sendTextMessage(task.chatId, task.content);

            // Update status to completed
            await this.repository.updateStatus(task.id, 'completed');
            logger.info(`✅ Scheduled task ${task.id} completed successfully`);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Failed to execute task ${task.id}:`, error);

            // Update status to failed
            await this.repository.updateStatus(task.id, 'failed', errorMessage);
        }
    }
}

export default ScheduledTasksService;
