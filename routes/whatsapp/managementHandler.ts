/**
 * Management Command Handler
 * 
 * Handles management commands (non-AI commands that don't go through router).
 * Extracted from whatsappRoutes.js (Phase 5.3)
 */

// Import services
import * as greenApiService from '../../services/greenApiService';
import { sendErrorToUser } from '../../utils/errorSender';
import conversationManager from '../../services/conversationManager';
import authStore from '../../store/authStore';
import groupAuthStore from '../../store/groupAuthStore';
import { findContactByName } from '../../services/groupService';
import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';

interface GreenApiMessage {
  typeMessage?: string;
  type?: string;
  textMessage?: string;
  caption?: string;
  extendedTextMessage?: { text?: string };
  idMessage?: string;
  [key: string]: unknown;
}

interface ChatMessage {
  textMessage?: string;
  caption?: string;
  extendedTextMessage?: { text?: string };
  typeMessage?: string;
  idMessage?: string;
  [key: string]: unknown;
}

/**
 * Handle management commands
 * @param {Object} command - Command object with type and optional contactName
 * @param {string} chatId - Chat ID
 * @param {string} senderId - Sender ID
 * @param {string} senderName - Sender name
 * @param {string} senderContactName - Sender contact name
 * @param {string} chatName - Chat name
 * @param {string} [originalMessageId] - Optional: ID of original message for quoting
 */
export async function handleManagementCommand(
  command: { type: string; contactName?: string; isCurrentContact?: boolean },
  chatId: string,
  _senderId: string, // Unused
  senderName: string,
  senderContactName: string,
  chatName: string,
  originalMessageId: string | null | undefined = null
) {
  try {
    switch (command.type) {
      case 'clear_all_conversations': {
        // Clear DB conversations (for backward compatibility)
        await conversationManager.clearAllConversations();
        
        // Clear message types and commands from DB
        await conversationManager.clearAllMessageTypes();
        await conversationManager.commandsManager.clearAll();
        
        await greenApiService.sendTextMessage(chatId, '✅ כל ההיסטוריות נוקו בהצלחה (DB)', originalMessageId || undefined, TIME.TYPING_INDICATOR);
        logger.info(`🗑️ All conversation histories cleared by ${senderName} (DB cleared)`);
        break;
      }

      case 'show_history': {
        // Get history from Green API (not DB) - shows all messages
        try {
          const greenApiHistory = await greenApiService.getChatHistory(chatId, 20) as GreenApiMessage[];
          
          if (greenApiHistory && greenApiHistory.length > 0) {
            let historyText = '📜 **היסטוריית שיחה (20 הודעות אחרונות):**\n\n';
            
            const filteredMessages = greenApiHistory.filter((msg: GreenApiMessage) => {
              // Filter out system/notification messages
              const isSystemMessage = 
                msg.typeMessage === 'notificationMessage' ||
                msg.type === 'notification' ||
                (msg.textMessage && msg.textMessage.startsWith('System:'));
              return !isSystemMessage;
            });
            
            // Use for...of loop to support await
            for (const msg of filteredMessages) {
              const message = msg as ChatMessage;
              const textContent = message.textMessage || 
                                message.caption || 
                                (message.extendedTextMessage && message.extendedTextMessage.text) ||
                                (message.typeMessage === 'extendedTextMessage' && message.extendedTextMessage?.text) ||
                                '[הודעה ללא טקסט]';
              
              // Determine role using conversationManager (DB-backed)
              const isFromBot = message.idMessage ? await conversationManager.isBotMessage(chatId, message.idMessage) : false;
              const role = isFromBot ? '🤖' : '👤';
              
              historyText += `${role} ${textContent}\n\n`;
            }
            
            await greenApiService.sendTextMessage(chatId, historyText, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            await greenApiService.sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה', originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error fetching history from Green API:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { context: 'SHOW_HISTORY', quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'media_creation_status': {
        const authorizedUsers = await authStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת מדיה:**\n\n';
          authorizedUsers.forEach((contactName: string) => {
            statusText += `• ${contactName}\n`;
          });
          await greenApiService.sendTextMessage(chatId, statusText, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
          await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת מדיה', originalMessageId || undefined, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'voice_transcription_status': {
        const allowList = await conversationManager.getVoiceAllowList();
        if (allowList && allowList.length > 0) {
          let statusText = '✅ **משתמשים מורשים לתמלול:**\n\n';
          allowList.forEach((contactName: string) => {
            statusText += `• ${contactName}\n`;
          });
          await greenApiService.sendTextMessage(chatId, statusText, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
          await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים לתמלול', originalMessageId || undefined, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'group_creation_status': {
        const authorizedUsers = await groupAuthStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת קבוצות:**\n\n';
          authorizedUsers.forEach((contactName: string) => {
            statusText += `• ${contactName}\n`;
          });
          await greenApiService.sendTextMessage(chatId, statusText, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
          await greenApiService.sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת קבוצות', originalMessageId || undefined, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'sync_contacts': {
        try {
          await greenApiService.sendTextMessage(chatId, '📇 מעדכן רשימת אנשי קשר...', originalMessageId || undefined, TIME.TYPING_INDICATOR);
          
          // Fetch contacts from Green API
          const contacts = await greenApiService.getContacts();
          
          if (!contacts || contacts.length === 0) {
            await greenApiService.sendTextMessage(chatId, '⚠️ לא נמצאו אנשי קשר', originalMessageId || undefined, TIME.TYPING_INDICATOR);
            return;
          }
          
          // Sync to database
          const syncResult = await conversationManager.syncContacts(contacts);
          
          const resultMessage = `✅ עדכון אנשי קשר הושלם!
📊 סטטיסטיקה:
• חדשים: ${syncResult.inserted}
• עודכנו: ${syncResult.updated}  
• סה"כ: ${syncResult.total}
💾 כל אנשי הקשר נשמרו במסד הנתונים`;
          
          await greenApiService.sendTextMessage(chatId, resultMessage, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          logger.info(`✅ Contacts synced successfully by ${senderName}`);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error syncing contacts:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בעדכון אנשי קשר: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'add_media_authorization': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת מדיה...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await authStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת מדיה`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to media creation authorization by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in add_media_authorization:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'remove_media_authorization': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת מדיה...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await authStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת מדיה`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            console.log(`✅ Removed ${exactName} from media creation authorization by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in remove_media_authorization:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאה: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'add_group_authorization': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת קבוצות...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to group creation authorization by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in add_group_authorization:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'remove_group_authorization': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת קבוצות...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await groupAuthStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from group creation authorization by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in remove_group_authorization:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאה: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'include_in_transcription': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים לתמלול...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await conversationManager.addToVoiceAllowList(exactName);
          if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים לתמלול`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to voice allow list by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים לתמלול`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in include_in_transcription:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאת תמלול: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'exclude_from_transcription': {
        try {
          let exactName = command.contactName || '';
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await greenApiService.sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים לתמלול...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await greenApiService.sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName || '') as { contactName: string; isGroup?: boolean };
            
            if (!foundContact) {
              await greenApiService.sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await greenApiService.sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await conversationManager.removeFromVoiceAllowList(exactName);
          if (wasRemoved) {
            await greenApiService.sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים לתמלול`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from voice allow list by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים לתמלול`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in exclude_from_transcription:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאת תמלול: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      case 'add_group_authorization_current': {
        try {
          // Auto-detect contact/group name from current chat
          const isGroupChat = chatId && chatId.endsWith('@g.us');
          const isPrivateChat = chatId && chatId.endsWith('@c.us');
          
          let targetName = '';
          if (isGroupChat) {
            targetName = chatName || senderName;
          } else if (isPrivateChat) {
            targetName = senderContactName || chatName || senderName;
          } else {
            await greenApiService.sendTextMessage(chatId, '❌ לא ניתן לזהות את השיחה הנוכחית', originalMessageId || undefined, TIME.TYPING_INDICATOR);
            break;
          }
          
          await greenApiService.sendTextMessage(chatId, `📝 מזהה אוטומטית: "${targetName}"`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(targetName);
          if (wasAdded) {
            await greenApiService.sendTextMessage(chatId, `✅ ${targetName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${targetName} (auto-detected from current chat) to group creation authorization by ${senderName}`);
          } else {
            await greenApiService.sendTextMessage(chatId, `ℹ️ ${targetName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('❌ Error in add_group_authorization_current:', { error: errorMessage, stack: errorStack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${errorMessage}`, quotedMessageId: originalMessageId || undefined });
        }
        break;
      }

      default:
        logger.warn(`⚠️ Unknown management command type: ${command.type}`);
        await greenApiService.sendTextMessage(chatId, `⚠️ Unknown management command type: ${command.type}`, originalMessageId || undefined, TIME.TYPING_INDICATOR);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`❌ Error handling management command ${command.type}:`, { error: errorMessage, stack: errorStack });
    await sendErrorToUser(chatId, error, { context: 'PROCESSING', quotedMessageId: originalMessageId || undefined });
  }
}
