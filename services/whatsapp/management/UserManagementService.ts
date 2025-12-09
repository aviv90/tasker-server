import * as greenApiService from '../../greenApiService';
import authStore from '../../../store/authStore';
import conversationManager from '../../conversationManager';
import { findContactByName } from '../../groupService';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';

export class UserManagementService {
    async handleMediaAuthorization(
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
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת מדיה...`, originalMessageId, TIME.TYPING_INDICATOR);
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

        const wasAdded = await authStore.addAuthorizedUser(exactName);
        if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to media creation authorization by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async removeMediaAuthorization(
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
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת מדיה...`, originalMessageId, TIME.TYPING_INDICATOR);
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

        const wasRemoved = await authStore.removeAuthorizedUser(exactName);
        if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from media creation authorization by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async getMediaAuthorizationStatus(chatId: string, originalMessageId?: string) {
        const authorizedUsers = await authStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
            let statusText = '✅ **משתמשים מורשים ליצירת מדיה:**\n\n';
            authorizedUsers.forEach((contactName: string) => {
                statusText += `• ${contactName}\n`;
            });
            await greenApiService.sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת מדיה', originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async handleTranscriptionInclusion(
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
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים לתמלול...`, originalMessageId, TIME.TYPING_INDICATOR);
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

        const wasAdded = await conversationManager.addToVoiceAllowList(exactName);
        if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to voice allow list by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async handleTranscriptionExclusion(
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
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים לתמלול...`, originalMessageId, TIME.TYPING_INDICATOR);
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

        const wasRemoved = await conversationManager.removeFromVoiceAllowList(exactName);
        if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from voice allow list by ${senderName}`);
        } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
        }
    }

    async getTranscriptionAuthorizationStatus(chatId: string, originalMessageId?: string) {
        const allowList = await conversationManager.getVoiceAllowList();
        if (allowList && allowList.length > 0) {
            let statusText = '✅ **משתמשים מורשים לתמלול:**\n\n';
            allowList.forEach((contactName: string) => {
                statusText += `• ${contactName}\n`;
            });
            await greenApiService.sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
        } else {
            await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים לתמלול', originalMessageId, TIME.TYPING_INDICATOR);
        }
    }
}
