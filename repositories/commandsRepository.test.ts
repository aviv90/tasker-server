/**
 * Commands Repository Tests
 * Unit tests for CommandsRepository
 */

import { Pool, PoolClient } from 'pg';
import CommandsRepository, { CommandData } from './commandsRepository';
import { createMockPool, createMockPoolClient } from '../tests/mocks/database.mock';

jest.mock('pg');

describe('CommandsRepository', () => {
  let repository: CommandsRepository;
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    mockClient = createMockPoolClient();
    mockPool = createMockPool();
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
    repository = new CommandsRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('save', () => {
    it('should save a new command', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const commandData: CommandData = {
        chatId: 'chat123',
        messageId: 'msg456',
        tool: 'test_tool',
        toolArgs: { param: 'value' },
        timestamp: Date.now()
      };

      await repository.save(commandData);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle null values', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const commandData: CommandData = {
        chatId: 'chat123',
        messageId: 'msg456',
        tool: null,
        timestamp: Date.now()
      };

      await repository.save(commandData);

      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should update existing command on conflict', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      const commandData: CommandData = {
        chatId: 'chat123',
        messageId: 'msg456',
        tool: 'updated_tool',
        timestamp: Date.now()
      };

      await repository.save(commandData);

      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe('findLastByChatId', () => {
    it('should return last command for chat', async () => {
      const mockRow = {
        message_id: 'msg456',
        tool: 'test_tool',
        tool_args: { param: 'value' },
        args: null,
        plan: null,
        is_multi_step: false,
        prompt: 'test prompt',
        result: null,
        failed: false,
        normalized: null,
        image_url: null,
        video_url: null,
        audio_url: null,
        timestamp: Date.now().toString()
      };

      mockClient.query.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1
      } as never);

      const result = await repository.findLastByChatId('chat123');

      expect(result).not.toBeNull();
      expect(result?.chatId).toBe('chat123');
      expect(result?.messageId).toBe('msg456');
      expect(result?.tool).toBe('test_tool');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return null if no command found', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: 0
      } as never);

      const result = await repository.findLastByChatId('chat123');

      expect(result).toBeNull();
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete commands older than timestamp', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: 5
      } as never);

      const cutoffTime = Date.now() - 1000000;
      const result = await repository.deleteOlderThan(cutoffTime);

      expect(result).toBe(5);
      expect(mockClient.query).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 0 if no commands deleted', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: 0
      } as never);

      const result = await repository.deleteOlderThan(Date.now());

      expect(result).toBe(0);
    });
  });

  describe('deleteAll', () => {
    it('should delete all commands', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: 10
      } as never);

      await repository.deleteAll();

      expect(mockClient.query).toHaveBeenCalledWith('DELETE FROM last_commands');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});

