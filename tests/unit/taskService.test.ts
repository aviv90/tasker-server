
import { TaskService } from '../../services/taskService';
import * as taskStore from '../../store/taskStore';
import { StartTaskRequest } from '../../schemas/taskSchemas';

// Mock dependencies with factory functions
jest.mock('../../store/taskStore');
jest.mock('../../utils/logger');
jest.mock('../../utils/textSanitizer', () => ({
    validateAndSanitizePrompt: (prompt: string) => prompt
}));

// Mock services with mock implementations
jest.mock('../../services/agent/utils/serviceLoader', () => ({
    getServices: jest.fn()
}));

jest.mock('../../services/replicate/whatsapp', () => ({
    generateVideoWithTextForWhatsApp: jest.fn()
}));

jest.mock('../../services/musicService', () => ({
    generateMusicWithLyrics: jest.fn()
}));

// Import mocked modules to configure them
import { getServices } from '../../services/agent/utils/serviceLoader';
import replicateService from '../../services/replicate/whatsapp';
import musicService from '../../services/musicService';

// We need a way to mock gemini/openai returned by getServices
const mockGeminiService = {
    generateImageForWhatsApp: jest.fn(),
    generateTextResponse: jest.fn()
};
const mockOpenAIService = {
    generateTextResponse: jest.fn()
};


describe('TaskService', () => {
    let taskService: TaskService;
    const mockReq = {
        protocol: 'http',
        get: jest.fn().mockReturnValue('localhost:3000')
    };

    beforeEach(() => {
        (getServices as jest.Mock).mockReturnValue({
            geminiService: mockGeminiService,
            openaiService: mockOpenAIService,
            // replicate and music are imported directly in TaskService, so they come from the module mock
        });
        taskService = new TaskService();
        jest.clearAllMocks();
    });

    describe('startTask', () => {
        it('should start a text-to-image task (defaults to Gemini)', async () => {
            const request: StartTaskRequest = {
                type: 'text-to-image',
                prompt: 'test prompt'
            };

            const mockResult = { url: 'http://image.url', success: true };
            mockGeminiService.generateImageForWhatsApp.mockResolvedValue(mockResult);

            const taskId = await taskService.startTask(request, mockReq);

            expect(taskId).toBeDefined();
            expect(taskStore.set).toHaveBeenCalledWith(taskId, { status: 'pending' });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockGeminiService.generateImageForWhatsApp).toHaveBeenCalledWith('test prompt');
            expect(taskStore.set).toHaveBeenCalledWith(taskId, expect.objectContaining({
                status: 'done',
                result: mockResult
            }));
        });

        it('should handle errors gracefully', async () => {
            const request: StartTaskRequest = {
                type: 'text-to-image',
                prompt: 'test prompt'
            };

            mockGeminiService.generateImageForWhatsApp.mockRejectedValue(new Error('API Error'));

            const taskId = await taskService.startTask(request, mockReq);

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(taskStore.set).toHaveBeenCalledWith(taskId, expect.objectContaining({
                status: 'error',
                error: 'API Error'
            }));
        });

        it('should start a text-to-video task (Replicate)', async () => {
            const request: StartTaskRequest = {
                type: 'text-to-video',
                prompt: 'test video'
            };

            (replicateService.generateVideoWithTextForWhatsApp as jest.Mock).mockResolvedValue({ videoUrl: 'http://video.url', success: true });

            const taskId = await taskService.startTask(request, mockReq);
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(replicateService.generateVideoWithTextForWhatsApp).toHaveBeenCalledWith('test video', mockReq);
            expect(taskStore.set).toHaveBeenCalledWith(taskId, expect.objectContaining({
                status: 'done',
                result: { url: 'http://video.url', success: true }
            }));
        });
    });
});
