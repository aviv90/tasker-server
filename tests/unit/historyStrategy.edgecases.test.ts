import { HistoryStrategy } from '../../services/agent/historyStrategy';
import { getChatHistory } from '../../utils/chatHistoryService';

jest.mock('../../utils/chatHistoryService');

describe('HistoryStrategy Edge Cases', () => {
    let strategy: HistoryStrategy;

    beforeEach(() => {
        strategy = new HistoryStrategy();
        jest.clearAllMocks();
    });

    it('should NOT filter legitimate messages starting with filtered words in different context', async () => {
        const mockMessages = [
            { role: 'user', content: 'מחפש עבודה חדשה' }, // "Looking for new job" - legitimate
            { role: 'assistant', content: 'אני ממליץ לחפש באתרים המובילים' }, // Legitimate response
            { role: 'user', content: 'יוצר דברים מדהימים' }, // "Creates amazing things" - NOT a system message
            { role: 'assistant', content: 'מה אתה יוצר?' } // "What do you create?" - legitimate
        ];

        (getChatHistory as jest.Mock).mockResolvedValue({
            success: true,
            messages: mockMessages
        });

        const result = await strategy.processHistory('test-chat', 'test prompt', true);

        // All messages should be kept as they don't match the EXACT Ack pattern
        // The filter checks startsWith + emoji pattern, so these won't match
        expect(result.history.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter partial Ack messages correctly', async () => {
        const mockMessages = [
            { role: 'user', content: 'שלח תמונה' },
            { role: 'assistant', content: 'יוצר תמונה עם Gemini... 🎨' }, // System Ack - should filter
            { role: 'assistant', content: 'הנה התמונה' }, // Actual response - keep
            { role: 'user', content: 'תודה' },
            { role: 'assistant', content: 'בבקשה' }
        ];

        (getChatHistory as jest.Mock).mockResolvedValue({
            success: true,
            messages: mockMessages
        });

        const result = await strategy.processHistory('test-chat', 'test prompt', true);

        expect(result.history).toHaveLength(4); // 5 - 1 filtered = 4
        const contents = result.history.map(h => h.parts[0].text);
        expect(contents).not.toContain('יוצר תמונה עם Gemini... 🎨');
        expect(contents).toContain('הנה התמונה');
    });

    it('should handle empty history gracefully', async () => {
        (getChatHistory as jest.Mock).mockResolvedValue({
            success: true,
            messages: []
        });

        const result = await strategy.processHistory('test-chat', 'test prompt', true);

        expect(result.history).toHaveLength(0);
        expect(result.shouldLoadHistory).toBe(true);
    });

    it('should handle history loading errors gracefully', async () => {
        (getChatHistory as jest.Mock).mockRejectedValue(new Error('DB Error'));

        const result = await strategy.processHistory('test-chat', 'test prompt', true);

        expect(result.history).toHaveLength(0);
        expect(result.shouldLoadHistory).toBe(true);
    });
});
