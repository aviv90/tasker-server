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
        } catch (error: any) {
            logger.error('❌ Error processing due tasks:', error);
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

        } catch (error: any) {
            logger.error(`❌ Failed to execute task ${task.id}:`, error);

            // Update status to failed
            await this.repository.updateStatus(task.id, 'failed', error.message || String(error));
        }
    }
}

export default ScheduledTasksService;
