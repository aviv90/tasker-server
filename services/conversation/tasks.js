/**
 * Async tasks management (for API task tracking)
 */
class TasksManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Save task status (for async API task tracking)
   */
  async saveTask(taskId, status, data = {}) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save task');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
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
    } catch (error) {
      console.error('❌ Error saving task:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get task status (for async API task tracking)
   */
  async getTask(taskId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get task');
      return null;
    }

    const client = await this.conversationManager.pool.connect();
    
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
      const taskData = {
        status: row.status
      };
      
      if (row.result) {
        Object.assign(taskData, row.result);
      }
      
      if (row.error) {
        taskData.error = row.error;
      }
      
      return taskData;
    } catch (error) {
      console.error('❌ Error getting task:', error.message);
      return null;
    } finally {
      client.release();
    }
  }
}

module.exports = TasksManager;

