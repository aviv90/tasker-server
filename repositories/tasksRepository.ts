import { Pool } from 'pg';

export interface TaskData {
    status?: string;
    result?: unknown;
    error?: string | null;
    [key: string]: unknown;
}

export class TasksRepository {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Save task status (upsert)
     */
    async save(taskId: string, status: string, data: TaskData = {}): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO tasks (task_id, status, result, error, updated_at)
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                ON CONFLICT (task_id) 
                DO UPDATE SET 
                  status = EXCLUDED.status,
                  result = EXCLUDED.result,
                  error = EXCLUDED.error,
                  updated_at = CURRENT_TIMESTAMP
            `, [
                taskId,
                status,
                data.result ? JSON.stringify(data.result) : null,
                data.error || null
            ]);
        } finally {
            client.release();
        }
    }

    /**
     * Get task by ID
     */
    async get(taskId: string): Promise<TaskData | null> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT status, result, error
                FROM tasks
                WHERE task_id = $1
            `, [taskId]);

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];
            const taskData: TaskData = {
                status: row.status
            };

            if (row.result) {
                try {
                    const parsedResult = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
                    Object.assign(taskData, parsedResult);
                } catch (parseError) {
                    // If parsing fails, just use the raw result
                    Object.assign(taskData, { result: row.result });
                }
            }

            if (row.error) {
                taskData.error = row.error;
            }

            return taskData;
        } finally {
            client.release();
        }
    }
}

export default TasksRepository;
