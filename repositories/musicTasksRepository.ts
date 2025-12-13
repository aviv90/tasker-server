import { Pool } from 'pg';
import logger from '../utils/logger';

export interface MusicTaskData {
    taskId: string;
    status: string;
    type: string;
    prompt?: string;
    musicOptions?: Record<string, unknown>;
    whatsappContext?: {
        chatId: string;
        originalMessageId?: string;
        senderName?: string;
    };
    metadata?: {
        wantsVideo?: boolean;
        [key: string]: unknown;
    };
    result?: unknown;
    error?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export class MusicTasksRepository {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Create or update a music task
     */
    async save(task: MusicTaskData): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO music_tasks (
                    task_id, status, type, prompt, options, whatsapp_context, metadata, result, error, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                ON CONFLICT (task_id) 
                DO UPDATE SET 
                  status = EXCLUDED.status,
                  type = EXCLUDED.type,
                  prompt = EXCLUDED.prompt,
                  options = EXCLUDED.options,
                  whatsapp_context = EXCLUDED.whatsapp_context,
                  metadata = EXCLUDED.metadata,
                  result = EXCLUDED.result,
                  error = EXCLUDED.error,
                  updated_at = CURRENT_TIMESTAMP
            `, [
                task.taskId,
                task.status,
                task.type,
                task.prompt || null,
                task.musicOptions ? JSON.stringify(task.musicOptions) : null,
                task.whatsappContext ? JSON.stringify(task.whatsappContext) : null,
                task.metadata ? JSON.stringify(task.metadata) : null,
                task.result ? JSON.stringify(task.result) : null,
                task.error || null
            ]);

            logger.debug(`💾 Music task saved: ${task.taskId} (${task.status})`);
        } catch (error) {
            logger.error(`❌ Failed to save music task ${task.taskId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get task by ID
     */
    async get(taskId: string): Promise<MusicTaskData | null> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    task_id, status, type, prompt, options, whatsapp_context, metadata, result, error, created_at, updated_at
                FROM music_tasks
                WHERE task_id = $1
            `, [taskId]);

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];
            return {
                taskId: row.task_id,
                status: row.status,
                type: row.type,
                prompt: row.prompt,
                musicOptions: row.options || {},
                whatsappContext: row.whatsapp_context || undefined,
                metadata: row.metadata || {},
                result: row.result || undefined,
                error: row.error,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        } finally {
            client.release();
        }
    }

    /**
     * Update task status only
     */
    async updateStatus(taskId: string, status: string, error?: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
                UPDATE music_tasks 
                SET status = $2, error = $3, updated_at = CURRENT_TIMESTAMP
                WHERE task_id = $1
            `, [taskId, status, error || null]);
        } finally {
            client.release();
        }
    }
}

export default MusicTasksRepository;
