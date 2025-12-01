import { jest } from '@jest/globals';
import ScheduledTasksService from '../../services/scheduling/scheduledTasksService';
import ScheduledTasksRepository from '../../repositories/scheduledTasksRepository';
import { sendTextMessage } from '../../services/greenApi/messaging';

// Mock dependencies
jest.mock('../../repositories/scheduledTasksRepository');
jest.mock('../../services/greenApi/messaging');
jest.mock('../../utils/logger');

describe('ScheduledTasksService', () => {
    let service: ScheduledTasksService;
    let repositoryMock: jest.Mocked<ScheduledTasksRepository>;

    beforeEach(() => {
        repositoryMock = new ScheduledTasksRepository({} as any) as jest.Mocked<ScheduledTasksRepository>;
        service = new ScheduledTasksService(repositoryMock);
        jest.clearAllMocks();
    });

    describe('scheduleMessage', () => {
        it('should schedule a message successfully', async () => {
            const chatId = '123';
            const content = 'Hello';
            const scheduledAt = new Date();
            const expectedTask = {
                id: 'task-1',
                chatId,
                content,
                scheduledAt,
                status: 'pending',
                createdAt: new Date()
            };

            repositoryMock.create.mockResolvedValue(expectedTask as any);

            const result = await service.scheduleMessage(chatId, content, scheduledAt);

            expect(repositoryMock.create).toHaveBeenCalledWith(chatId, content, scheduledAt);
            expect(result).toEqual(expectedTask);
        });
    });

    describe('processDueTasks', () => {
        it('should process due tasks successfully', async () => {
            const dueTasks = [
                { id: '1', chatId: 'chat1', content: 'msg1', scheduledAt: new Date(), status: 'pending' },
                { id: '2', chatId: 'chat2', content: 'msg2', scheduledAt: new Date(), status: 'pending' }
            ];

            repositoryMock.findDue.mockResolvedValue(dueTasks as any);
            (sendTextMessage as jest.Mock).mockResolvedValue({});

            await service.processDueTasks();

            expect(repositoryMock.findDue).toHaveBeenCalled();
            expect(sendTextMessage).toHaveBeenCalledTimes(2);
            expect(sendTextMessage).toHaveBeenCalledWith('chat1', 'msg1');
            expect(sendTextMessage).toHaveBeenCalledWith('chat2', 'msg2');
            expect(repositoryMock.updateStatus).toHaveBeenCalledWith('1', 'completed');
            expect(repositoryMock.updateStatus).toHaveBeenCalledWith('2', 'completed');
        });

        it('should handle errors during task execution', async () => {
            const dueTasks = [
                { id: '1', chatId: 'chat1', content: 'msg1', scheduledAt: new Date(), status: 'pending' }
            ];

            repositoryMock.findDue.mockResolvedValue(dueTasks as any);
            (sendTextMessage as jest.Mock).mockRejectedValue(new Error('Send failed'));

            await service.processDueTasks();

            expect(sendTextMessage).toHaveBeenCalledWith('chat1', 'msg1');
            expect(repositoryMock.updateStatus).toHaveBeenCalledWith('1', 'failed', 'Send failed');
        });

        it('should do nothing if no tasks are due', async () => {
            repositoryMock.findDue.mockResolvedValue([]);

            await service.processDueTasks();

            expect(sendTextMessage).not.toHaveBeenCalled();
        });
    });
});
