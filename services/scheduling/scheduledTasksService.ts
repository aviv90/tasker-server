/**
 * Scheduled Tasks Service
 * Handles business logic for scheduling and executing messages.
 */

import ScheduledTasksRepository, { ScheduledTask } from '../../repositories/scheduledTasksRepository';
import { GreenApiMessagingService } from '../greenApi/messagingService';
import logger from '../../utils/logger';

class ScheduledTasksService {
    private repository: ScheduledTasksRepository;
    private messagingService: GreenApiMessagingService;

    constructor(repository: ScheduledTasksRepository, messagingService: GreenApiMessagingService) {
        this.repository = repository;
        this.messagingService = messagingService;
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error processing due tasks:', { error: errorMessage });
        }
    }

    /**
     * Execute a single task
     */
    private async executeTask(task: ScheduledTask): Promise<void> {
        try {
            logger.info(`⏰ Executing scheduled task ${task.id}:`, task);

            // Note: Repository only supports 'completed', 'failed', 'cancelled'. 
            // We cannot set to 'processing'.

            // Send message
            await this.messagingService.sendTextMessage(task.chatId, task.content);

            // Mark as completed
            await this.repository.updateStatus(task.id, 'completed');
            logger.info(`✅ Scheduled task ${task.id} completed`);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Error executing scheduled task ${task.id}:`, { error: errorMessage });

            // Mark as failed
            await this.repository.updateStatus(task.id, 'failed', errorMessage);
        }
    }

    /**
     * Schedule a message
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
}

export default ScheduledTasksService;
