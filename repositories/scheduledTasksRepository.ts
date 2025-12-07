/**
 * Scheduled Tasks Repository
 * Handles direct database interactions for scheduled messages.
 */

import { Pool } from 'pg';

export interface ScheduledTask {
    id: string;
    chatId: string;
    content: string;
    scheduledAt: Date;
    status: 'pending' | 'completed' | 'failed' | 'cancelled';
    createdAt: Date;
    executedAt?: Date;
    error?: string;
}

class ScheduledTasksRepository {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Check for similar pending task (Idempotency)
     */
    async findSimilarPending(chatId: string, content: string, scheduledAt: Date, toleranceMs: number = 2000): Promise<ScheduledTask | null> {
        const client = await this.pool.connect();
        try {
            // Check for tasks with same chatId, same content, and similar time (+/- tolerance)
            // AND are 'pending'
            const result = await client.query(`
                SELECT id, chat_id, content, scheduled_at, status, created_at
                FROM scheduled_tasks
                WHERE chat_id = $1 
                AND content = $2 
                AND status = 'pending'
                AND scheduled_at >= $3 
                AND scheduled_at <= $4
                LIMIT 1
            `, [
                chatId,
                content,
                new Date(scheduledAt.getTime() - toleranceMs),
                new Date(scheduledAt.getTime() + toleranceMs)
            ]);

            if (result.rows.length === 0) return null;

            const row = result.rows[0];
            return {
                id: row.id,
                chatId: row.chat_id,
                content: row.content,
                scheduledAt: row.scheduled_at,
                status: row.status,
                createdAt: row.created_at
            };
        } finally {
            client.release();
        }
    }

    /**
     * Create a new scheduled task
     */
    async create(chatId: string, content: string, scheduledAt: Date): Promise<ScheduledTask> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
        INSERT INTO scheduled_tasks (chat_id, content, scheduled_at, status)
        VALUES ($1, $2, $3, 'pending')
        RETURNING id, chat_id, content, scheduled_at, status, created_at
      `, [chatId, content, scheduledAt]);

            const row = result.rows[0];
            return {
                id: row.id,
                chatId: row.chat_id,
                content: row.content,
                scheduledAt: row.scheduled_at,
                status: row.status,
                createdAt: row.created_at
            };
        } finally {
            client.release();
        }
    }

    /**
     * Find tasks due for execution
     */
    async findDue(now: Date = new Date()): Promise<ScheduledTask[]> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
        SELECT id, chat_id, content, scheduled_at, status, created_at
        FROM scheduled_tasks
        WHERE status = 'pending' AND scheduled_at <= $1
        ORDER BY scheduled_at ASC
      `, [now]);

            return result.rows.map(row => ({
                id: row.id,
                chatId: row.chat_id,
                content: row.content,
                scheduledAt: row.scheduled_at,
                status: row.status,
                createdAt: row.created_at
            }));
        } finally {
            client.release();
        }
    }

    /**
     * Update task status
     */
    async updateStatus(id: string, status: 'completed' | 'failed' | 'cancelled', error?: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
        UPDATE scheduled_tasks
        SET status = $1, executed_at = CURRENT_TIMESTAMP, error = $2
        WHERE id = $3
      `, [status, error || null, id]);
        } finally {
            client.release();
        }
    }
}

export default ScheduledTasksRepository;
