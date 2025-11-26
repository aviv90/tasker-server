/**
 * Async tasks management (for API task tracking)
 */

import { Pool } from 'pg';
import logger from '../../utils/logger';

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  isInitialized?: boolean;
  pool?: Pool;
  [key: string]: unknown;
}

/**
 * Task data structure
 */
interface TaskData {
  result?: unknown;
  error?: string | null;
  [key: string]: unknown;
}

class TasksManager {
  private conversationManager: ConversationManager;

  constructor(conversationManager: ConversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Save task status (for async API task tracking)
   */
  async saveTask(taskId: string, status: string, data: TaskData = {}): Promise<void> {
    if (!this.conversationManager.isInitialized || !this.conversationManager.pool) {
      logger.warn('⚠️ Database not initialized, cannot save task');
      return;
    }

    const client = await (this.conversationManager.pool as Pool).connect();
    
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error saving task:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    } finally {
      client.release();
    }
  }

  /**
   * Get task status (for async API task tracking)
   */
  async getTask(taskId: string): Promise<TaskData | null> {
    if (!this.conversationManager.isInitialized || !this.conversationManager.pool) {
      logger.warn('⚠️ Database not initialized, cannot get task');
      return null;
    }

    const client = await (this.conversationManager.pool as Pool).connect();
    
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting task:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
      return null;
    } finally {
      client.release();
    }
  }
}

export default TasksManager;

