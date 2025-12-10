import * as greenApiService from '../../greenApiService';
import conversationManager from '../../conversationManager';
import { GreenApiContact } from '../../conversation/contacts';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';

export class SystemManagementService {
    async clearAllConversations(chatId: string, senderName: string, originalMessageId?: string) {
        // Clear DB conversations (includes cache invalidation)
        const deletedCount = await conversationManager.clearAllConversations();

        // Clear message types and commands from DB
        await conversationManager.clearAllMessageTypes();
        await conversationManager.commandsManager.clearAll();

        // Clear agent context as well
        await conversationManager.clearAgentContext(chatId);

        await greenApiService.sendTextMessage(
            chatId,
            `✅ כל ההיסטוריות נוקו בהצלחה (DB + Cache)\n🗑️ ${deletedCount} הודעות נמחקו`,
            originalMessageId,
            TIME.TYPING_INDICATOR
        );
        logger.info(`🗑️ All conversation histories cleared by ${senderName} (${deletedCount} messages deleted, cache invalidated)`);
    }

    async syncContacts(chatId: string, senderName: string, originalMessageId?: string) {
        await greenApiService.sendTextMessage(chatId, '📇 מעדכן רשימת אנשי קשר...', originalMessageId, TIME.TYPING_INDICATOR);

        // Fetch contacts from Green API
        const contacts = await greenApiService.getContacts();

        if (!contacts || contacts.length === 0) {
            await greenApiService.sendTextMessage(chatId, '⚠️ לא נמצאו אנשי קשר', originalMessageId, TIME.TYPING_INDICATOR);
            return;
        }

        // Sync to database
        const syncResult = await conversationManager.syncContacts(contacts as unknown as GreenApiContact[]);

        const resultMessage = `✅ עדכון אנשי קשר הושלם!
📊 סטטיסטיקה:
• חדשים: ${syncResult.inserted}
• עודכנו: ${syncResult.updated}  
• סה"כ: ${syncResult.total}
💾 כל אנשי הקשר נשמרו במסד הנתונים`;

        await greenApiService.sendTextMessage(chatId, resultMessage, originalMessageId, TIME.TYPING_INDICATOR);
        logger.info(`✅ Contacts synced successfully by ${senderName}`);
    }

    async showHistory(chatId: string, originalMessageId?: string) {
        // Use chatHistoryService (SSOT) for proper chronological ordering
        const { getChatHistory } = await import('../../../utils/chatHistoryService');
        const historyResult = await getChatHistory(chatId, 20, { format: 'display' });

        if (historyResult.success && historyResult.messages.length > 0) {
            let historyText = '📜 **היסטוריית שיחה (20 הודעות אחרונות):**\n\n';

            // Process messages
            for (const msg of historyResult.messages) {
                const textContent = msg.content || '[הודעה ללא טקסט]';
                const role = msg.role === 'assistant' ? '🤖' : '👤';
                historyText += `${role} ${textContent}\n\n`;
            }

            await greenApiService.sendTextMessage(chatId, historyText, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה', originalMessageId, TIME.TYPING_INDICATOR);
        }
    }
}
