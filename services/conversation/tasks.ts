/**
 * Async tasks management (for API task tracking)
 */

import logger from '../../utils/logger';
import TasksRepository, { TaskData } from '../../repositories/tasksRepository';

class TasksManager {
  private repository: TasksRepository;

  constructor(repository: TasksRepository) {
    this.repository = repository;
  }

  /**
   * Save task status (for async API task tracking)
   */
  async saveTask(taskId: string, status: string, data: TaskData = {}): Promise<void> {
    try {
      await this.repository.save(taskId, status, data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error saving task via repository:', { error: errorMessage });
    }
  }

  /**
   * Get task status (for async API task tracking)
   */
  async getTask(taskId: string): Promise<TaskData | null> {
    try {
      return await this.repository.get(taskId);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting task via repository:', { error: errorMessage });
      return null;
    }
  }
}

export default TasksManager;

