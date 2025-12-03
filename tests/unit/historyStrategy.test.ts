
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
        expect(result.history).toHaveLength(3); // 5 messages - 2 filtered = 3

        // Check content of filtered history
        const contents = result.history.map(h => h.parts[0].text);
        expect(contents).toContain('שלח לי תמונה של חתול');
        expect(contents).toContain('הנה התמונה שלך');
        expect(contents).toContain('תודה');
        expect(contents).not.toContain('יוצר תמונה עם Gemini... 🎨');
        expect(contents).not.toContain('חושב... 🤖');
    });
});
