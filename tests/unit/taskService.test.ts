import { TaskService } from '../../services/taskService';
import * as taskStore from '../../store/taskStore';
import * as openaiService from '../../services/openai';
import * as geminiService from '../../services/geminiService';
import { StartTaskRequest } from '../../schemas/taskSchemas';

// Set dummy API key for testing
process.env.OPENAI_API_KEY = 'dummy';

// Mock dependencies
jest.mock('../../store/taskStore');
jest.mock('../../services/openai', () => ({
    generateImageWithText: jest.fn(),
    generateTextResponse: jest.fn()
}));
jest.mock('../../services/geminiService');
jest.mock('../../utils/logger');
jest.mock('../../utils/textSanitizer', () => ({
    validateAndSanitizePrompt: (prompt: string) => prompt
}));

describe('TaskService', () => {
    let taskService: TaskService;
    const mockReq = {
        protocol: 'http',
        get: jest.fn().mockReturnValue('localhost:3000')
    };

    beforeEach(() => {
        taskService = new TaskService();
        jest.clearAllMocks();
    });

    describe('startTask', () => {
        it('should start a text-to-image task with openai', async () => {
            const request: StartTaskRequest = {
                type: 'text-to-image',
                prompt: 'test prompt',
                provider: 'openai'
            };

            (openaiService.generateImageWithText as jest.Mock).mockResolvedValue({
                imageBuffer: Buffer.from('fake-image'),
                text: 'generated image',
                cost: 0.1
            });

            const taskId = await taskService.startTask(request, mockReq);

            expect(taskId).toBeDefined();
            expect(taskStore.set).toHaveBeenCalledWith(taskId, { status: 'pending' });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(openaiService.generateImageWithText).toHaveBeenCalledWith('test prompt');
            expect(taskStore.set).toHaveBeenCalledWith(taskId, expect.objectContaining({
                status: 'done',
                result: expect.stringContaining(`${taskId}.png`)
            }));
        });

        it('should handle errors gracefully', async () => {
            const request: StartTaskRequest = {
                type: 'text-to-image',
                prompt: 'test prompt',
                provider: 'openai'
            };

            (openaiService.generateImageWithText as jest.Mock).mockRejectedValue(new Error('API Error'));

            const taskId = await taskService.startTask(request, mockReq);

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(taskStore.set).toHaveBeenCalledWith(taskId, expect.objectContaining({
                status: 'error',
                error: 'API Error'
            }));
        });
    });
});
