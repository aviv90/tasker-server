import * as greenApiService from '../../greenApiService';
import groupAuthStore from '../../../store/groupAuthStore';
import { findContactByName } from '../../groupService';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';

export class GroupManagementService {
    async handleGroupAuthorization(
        chatId: string,
        contactName: string,
        isCurrentContact: boolean,
        senderName: string,
        originalMessageId?: string
    ) {
        let exactName = contactName || '';
        let entityType = '👤 איש קשר';

        if (isCurrentContact) {
            logger.info(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת קבוצות...`, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(contactName || '') as { contactName: string; isGroup?: boolean };

            if (!foundContact) {
                await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
                return;
            }

            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
        }

        const wasAdded = await groupAuthStore.addAuthorizedUser(exactName);
        if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to group creation authorization by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async handleGroupAuthorizationCurrent(
        chatId: string,
        chatName: string,
        senderName: string,
        senderContactName: string,
        originalMessageId?: string
    ) {
        // Auto-detect contact/group name from current chat
        const isGroupChat = chatId && chatId.endsWith('@g.us');
        const isPrivateChat = chatId && chatId.endsWith('@c.us');

        let targetName = '';
        if (isGroupChat) {
            targetName = chatName || senderName;
        } else if (isPrivateChat) {
            targetName = senderContactName || chatName || senderName;
        } else {
            await greenApiService.sendTextMessage(chatId, '❌ לא ניתן לזהות את השיחה הנוכחית', originalMessageId, TIME.TYPING_INDICATOR);
            return;
        }

        await greenApiService.sendTextMessage(chatId, `📝 מזהה אוטומטית: "${targetName}"`, originalMessageId, TIME.TYPING_INDICATOR);

        const wasAdded = await groupAuthStore.addAuthorizedUser(targetName);
        if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${targetName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${targetName} (auto-detected from current chat) to group creation authorization by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${targetName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async removeGroupAuthorization(
        chatId: string,
        contactName: string,
        isCurrentContact: boolean,
        senderName: string,
        originalMessageId?: string
    ) {
        let exactName = contactName || '';
        let entityType = '👤 איש קשר';

        if (isCurrentContact) {
            logger.info(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת קבוצות...`, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(contactName || '') as { contactName: string; isGroup?: boolean };

            if (!foundContact) {
                await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
                return;
            }

            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
        }

        const wasRemoved = await groupAuthStore.removeAuthorizedUser(exactName);
        if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from group creation authorization by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async getGroupAuthorizationStatus(chatId: string, originalMessageId?: string) {
        const authorizedUsers = await groupAuthStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
            let statusText = '✅ **משתמשים מורשים ליצירת קבוצות:**\n\n';
            authorizedUsers.forEach((contactName: string) => {
                statusText += `• ${contactName}\n`;
            });
            await greenApiService.sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת קבוצות', originalMessageId, TIME.TYPING_INDICATOR);
        }
    }
}
