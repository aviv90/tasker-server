/**
 * Task Store Tests
 * Unit tests for TaskStore
 */

import * as taskStore from './taskStore';
import { TaskData } from './taskStore';

// Mock conversationManager
jest.mock('../services/conversationManager', () => {
  const mockSaveTask = jest.fn();
  const mockGetTask = jest.fn();
  return {
    __esModule: true,
    default: {
      saveTask: mockSaveTask,
      getTask: mockGetTask
    }
  };
});

// Import after mock to get the mocked version
import conversationManager from '../services/conversationManager';

const mockSaveTask = (conversationManager as unknown as { saveTask: jest.Mock }).saveTask;
const mockGetTask = (conversationManager as unknown as { getTask: jest.Mock }).getTask;

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

