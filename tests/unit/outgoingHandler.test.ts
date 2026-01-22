
import { handleOutgoingMessage } from '../../routes/whatsapp/outgoingHandler';
import conversationManager from '../../services/conversationManager';
import { routeToAgent } from '../../services/agentRouter';
import { MessageProcessor } from '../../services/whatsapp/messageProcessor';
import logger from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/conversationManager', () => ({
    markAsUserOutgoing: jest.fn(),
    isBotMessage: jest.fn(),
    markAsBotMessage: jest.fn(),
    hasBotOperationActive: jest.fn().mockReturnValue(false), // New: chat-level lock check
}));

jest.mock('../../services/agentRouter', () => ({
    routeToAgent: jest.fn(),
}));

jest.mock('../../services/whatsapp/messageProcessor', () => ({
    MessageProcessor: {
        getUniqueMessageId: jest.fn().mockReturnValue('unique-id'),
        isDuplicate: jest.fn().mockReturnValue(false),
        processMessage: jest.fn().mockResolvedValue({ shouldProcess: true, normalizedInput: { userText: 'test' } }),
    }
}));

jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

// Mock other imports if necessary
jest.mock('../../routes/whatsapp/incoming/messageStorage', () => ({
    saveIncomingUserMessage: jest.fn().mockResolvedValue(true),
    extractMediaMetadata: jest.fn(),
}));
jest.mock('../../routes/whatsapp/incoming/resultHandling', () => ({
    sendAgentResults: jest.fn(),
}));


describe('Outgoing Handler', () => {
    const mockWebhookData = {
        idMessage: 'msg123',
        timestamp: 123456789,
        senderData: {
            chatId: '12345@c.us',
            sender: '12345@c.us',
            senderName: 'TestUser'
        },
        messageData: {
            typeMessage: 'textMessage',
            textMessageData: {
                textMessage: 'test message'
            }
        }
    };

    const processedMessages = new Set<string>();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should ignore bot-generated messages (Ghost Session Prevention)', async () => {
        // Setup: message IS a bot message
        (conversationManager.isBotMessage as jest.Mock).mockResolvedValue(true);

        await handleOutgoingMessage(mockWebhookData as any, processedMessages);

        // Verify:
        // 1. isBotMessage was checked
        expect(conversationManager.isBotMessage).toHaveBeenCalledWith('12345@c.us', 'msg123');

        // 2. markAsUserOutgoing was NOT called
        expect(conversationManager.markAsUserOutgoing).not.toHaveBeenCalled();

        // 3. routeToAgent was NOT called
        expect(routeToAgent).not.toHaveBeenCalled();

        // 4. Logged info
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Ignoring bot-generated message'));
    });

    it('should process normal user outgoing messages', async () => {
        // Setup: message is NOT a bot message
        (conversationManager.isBotMessage as jest.Mock).mockResolvedValue(false);

        await handleOutgoingMessage(mockWebhookData as any, processedMessages);

        // Verify:
        // 1. markAsUserOutgoing WAS called
        expect(conversationManager.markAsUserOutgoing).toHaveBeenCalledWith('12345@c.us', 'msg123');

        // 2. routeToAgent WAS called (since MessageProcessor mocked to return true)
        expect(routeToAgent).toHaveBeenCalled();
    });
});
