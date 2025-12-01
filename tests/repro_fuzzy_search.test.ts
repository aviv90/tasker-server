
import { findContactByName } from '../services/groupService';
import conversationManager from '../services/conversationManager';

// Mock conversationManager
jest.mock('../services/conversationManager', () => ({
    getAllContacts: jest.fn()
}));

// Mock logger to avoid clutter
jest.mock('../utils/logger', () => ({
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error
}));

// Mock cache to avoid interference
jest.mock('../utils/cache', () => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    CacheKeys: {
        contact: (key: string) => `contact:${key}`
    },
    CacheTTL: {
        MEDIUM: 300,
        SHORT: 60
    }
}));

// Mock config/messages
jest.mock('../config/messages', () => ({
    getEntityType: () => 'contact'
}));

describe('Fuzzy Search Debugging', () => {
    const mockContacts = [
        { contact_id: '972501234567@c.us', contactName: 'קוקו הלוי', name: 'Coco Halevi' },
        { contact_id: '972509876543@c.us', contactName: 'ישראל ישראלי', name: 'Israel Israeli' },
        { contact_id: '123456789@g.us', contactName: 'קבוצת כדורגל', name: 'Soccer Group' }
    ];

    beforeEach(() => {
        (conversationManager.getAllContacts as jest.Mock).mockResolvedValue(mockContacts);
    });

    it('should find exact match in Hebrew', async () => {
        const result = await findContactByName('קוקו הלוי');
        console.log('Exact match result:', result);
        expect(result).not.toBeNull();
        expect(result?.contactName).toBe('קוקו הלוי');
    });

    it('should find partial match in Hebrew', async () => {
        const result = await findContactByName('קוקו');
        console.log('Partial match "קוקו" result:', result);
        expect(result).not.toBeNull();
        expect(result?.contactName).toBe('קוקו הלוי');
    });

    it('should find partial match with typo', async () => {
        const result = await findContactByName('קוקו הלו');
        console.log('Typo match "קוקו הלו" result:', result);
        expect(result).not.toBeNull();
    });

    it('should find group by partial name', async () => {
        const result = await findContactByName('כדורגל');
        console.log('Group match "כדורגל" result:', result);
        expect(result).not.toBeNull();
        expect(result?.contactName).toBe('קבוצת כדורגל');
    });
});
