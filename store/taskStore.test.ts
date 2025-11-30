/**
 * Task Store Tests
 * Unit tests for TaskStore
 * 
 * Tests the task storage functionality used for async operations.
 */

import * as taskStore from './taskStore';
import type { TaskData } from './taskStore';

// Mock conversationManager before importing the module under test
jest.mock('../services/conversationManager', () => ({
  __esModule: true,
  default: {
    saveTask: jest.fn(),
    getTask: jest.fn()
  }
}));

// Import the mocked module
import conversationManager from '../services/conversationManager';

// Type-safe mock references
const mockSaveTask = conversationManager.saveTask as jest.Mock;
const mockGetTask = conversationManager.getTask as jest.Mock;

describe('taskStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('set', () => {
    it('should save task with pending status', async () => {
      const taskId = 'task123';
      const data: TaskData = {
        status: 'pending'
      };

      await taskStore.set(taskId, data);

      expect(mockSaveTask).toHaveBeenCalledWith(
        taskId,
        'pending',
        expect.objectContaining({
          result: null,
          error: undefined
        })
      );
    });

    it('should save task with done status', async () => {
      const taskId = 'task123';
      const data: TaskData = {
        status: 'done',
        result: { url: 'https://example.com/file.png' }
      };

      await taskStore.set(taskId, data);

      expect(mockSaveTask).toHaveBeenCalledWith(
        taskId,
        'done',
        expect.objectContaining({
          result: data
        })
      );
    });

    it('should save task with error status', async () => {
      const taskId = 'task123';
      const data: TaskData = {
        status: 'error',
        error: 'Test error'
      };

      await taskStore.set(taskId, data);

      expect(mockSaveTask).toHaveBeenCalledWith(
        taskId,
        'error',
        expect.objectContaining({
          error: 'Test error'
        })
      );
    });
  });

  describe('get', () => {
    it('should return task data', async () => {
      const taskId = 'task123';
      const mockTask: TaskData = {
        status: 'done',
        result: { url: 'https://example.com/file.png' }
      };

      mockGetTask.mockResolvedValue(mockTask);

      const result = await taskStore.get(taskId);

      expect(result).toEqual(mockTask);
      expect(mockGetTask).toHaveBeenCalledWith(taskId);
    });

    it('should return null if task not found', async () => {
      const taskId = 'task123';

      mockGetTask.mockResolvedValue(null);

      const result = await taskStore.get(taskId);

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      const taskId = 'task123';

      mockGetTask.mockRejectedValue(new Error('Database error'));

      const result = await taskStore.get(taskId);

      expect(result).toBeNull();
    });
  });
});

