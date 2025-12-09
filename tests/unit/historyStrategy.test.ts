
import { HistoryStrategy } from '../../services/agent/historyStrategy';
import { getChatHistory } from '../../utils/chatHistoryService';

// Mock chatHistoryService
jest.mock('../../utils/chatHistoryService');

describe('HistoryStrategy', () => {
    let strategy: HistoryStrategy;

    beforeEach(() => {
        strategy = new HistoryStrategy();
        jest.clearAllMocks();
    });

    it('should filter out system Ack messages from history', async () => {
        const mockMessages = [
            { role: 'user', content: 'שלח לי תמונה של חתול' },
            { role: 'assistant', content: 'יוצר תמונה עם Gemini... 🎨' }, // Should be filtered
            { role: 'assistant', content: 'הנה התמונה שלך' }, // Should be kept
            { role: 'user', content: 'תודה' },
            { role: 'assistant', content: 'חושב... 🤖' } // Should be filtered
        ];

        (getChatHistory as jest.Mock).mockResolvedValue({
            success: true,
            messages: mockMessages
        });

        const result = await strategy.processHistory('test-chat', 'test prompt', true);

        expect(result.shouldLoadHistory).toBe(true);
        expect(result.history).toHaveLength(5); // No filtering anymore

        // Check content - all messages should be present
        const contents = result.history.map(h => h.parts[0].text);
        expect(contents).toContain('שלח לי תמונה של חתול');
        expect(contents).toContain('הנה התמונה שלך');
        expect(contents).toContain('תודה');
        expect(contents).toContain('יוצר תמונה עם Gemini... 🎨'); // Should now be present
        expect(contents).toContain('חושב... 🤖'); // Should now be present
    });
});
