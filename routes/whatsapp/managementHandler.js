/**
 * Management Command Handler
 * 
 * Handles management commands (non-AI commands that don't go through router).
 * Extracted from whatsappRoutes.js (Phase 5.3)
 */

// Import services
const { sendTextMessage, getChatHistory } = require('../../services/greenApiService');
const { sendErrorToUser, ERROR_MESSAGES } = require('../../utils/errorSender');
const conversationManager = require('../../services/conversationManager');
const authStore = require('../../store/authStore');
const groupAuthStore = require('../../store/groupAuthStore');
const { findContactByName } = require('../../services/groupService');
const { getContacts } = require('../../services/greenApiService');
// Message types are now managed via conversationManager

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
async function handleManagementCommand(command, chatId, senderId, senderName, senderContactName, chatName, originalMessageId = null) {
  try {
    switch (command.type) {
      case 'clear_all_conversations': {
        // Clear DB conversations (for backward compatibility)
        await conversationManager.clearAllConversations();
        
        // Clear message types and commands from DB
        await conversationManager.clearAllMessageTypes();
        await conversationManager.commandsManager.clearAll();
        
        const logger = require('../../utils/logger');
        await sendTextMessage(chatId, '✅ כל ההיסטוריות נוקו בהצלחה (DB)', originalMessageId, TIME.TYPING_INDICATOR);
        logger.info(`🗑️ All conversation histories cleared by ${senderName} (DB cleared)`);
        break;
      }

      case 'show_history': {
        // Get history from Green API (not DB) - shows all messages
        try {
          const greenApiHistory = await getChatHistory(chatId, 20);
          
          if (greenApiHistory && greenApiHistory.length > 0) {
            let historyText = '📜 **היסטוריית שיחה (20 הודעות אחרונות):**\n\n';
            
            const filteredMessages = greenApiHistory.filter(msg => {
              // Filter out system/notification messages
              const isSystemMessage = 
                msg.typeMessage === 'notificationMessage' ||
                msg.type === 'notification' ||
                (msg.textMessage && msg.textMessage.startsWith('System:'));
              return !isSystemMessage;
            });
            
            // Use for...of loop to support await
            for (const msg of filteredMessages) {
              const textContent = msg.textMessage || 
                                msg.caption || 
                                (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                                (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text) ||
                                '[הודעה ללא טקסט]';
              
              // Determine role using conversationManager (DB-backed)
              const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;
              const role = isFromBot ? '🤖' : '👤';
              
              historyText += `${role} ${textContent}\n\n`;
            }
            
            await sendTextMessage(chatId, historyText, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה', originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error fetching history from Green API:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { context: 'SHOW_HISTORY', quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'media_creation_status': {
        const authorizedUsers = await authStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת מדיה:**\n\n';
          authorizedUsers.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת מדיה', originalMessageId, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'voice_transcription_status': {
        const allowList = await conversationManager.getVoiceAllowList();
        if (allowList && allowList.length > 0) {
          let statusText = '✅ **משתמשים מורשים לתמלול:**\n\n';
          allowList.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים לתמלול', originalMessageId, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'group_creation_status': {
        const authorizedUsers = await groupAuthStore.getAuthorizedUsers();
        if (authorizedUsers && authorizedUsers.length > 0) {
          let statusText = '✅ **משתמשים מורשים ליצירת קבוצות:**\n\n';
          authorizedUsers.forEach(contactName => {
            statusText += `• ${contactName}\n`;
          });
          await sendTextMessage(chatId, statusText, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
          await sendTextMessage(chatId, 'ℹ️ אין משתמשים מורשים ליצירת קבוצות', originalMessageId, TIME.TYPING_INDICATOR);
        }
        break;
      }

      case 'sync_contacts': {
        try {
          await sendTextMessage(chatId, '📇 מעדכן רשימת אנשי קשר...', originalMessageId, TIME.TYPING_INDICATOR);
          
          // Fetch contacts from Green API
          const contacts = await getContacts();
          
          if (!contacts || contacts.length === 0) {
            await sendTextMessage(chatId, '⚠️ לא נמצאו אנשי קשר', originalMessageId, TIME.TYPING_INDICATOR);
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
          
          await sendTextMessage(chatId, resultMessage, originalMessageId, TIME.TYPING_INDICATOR);
          logger.info(`✅ Contacts synced successfully by ${senderName}`);
        } catch (error) {
          logger.error('❌ Error syncing contacts:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בעדכון אנשי קשר: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'add_media_authorization': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת מדיה...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await authStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in add_media_authorization:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'remove_media_authorization': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת מדיה...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await authStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
            console.log(`✅ Removed ${exactName} from media creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת מדיה`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in remove_media_authorization:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאה: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'add_group_authorization': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים ליצירת קבוצות...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in add_group_authorization:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'remove_group_authorization': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים ליצירת קבוצות...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await groupAuthStore.removeAuthorizedUser(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in remove_group_authorization:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאה: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'include_in_transcription': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מוסיף "${exactName}" לרשימת המורשים לתמלול...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasAdded = await conversationManager.addToVoiceAllowList(exactName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${exactName} נוסף לרשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${exactName} to voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} כבר נמצא ברשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in include_in_transcription:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאת תמלול: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      case 'exclude_from_transcription': {
        try {
          let exactName = command.contactName;
          let entityType = '👤 איש קשר';
          
          // If this is the current contact, use it directly (no DB lookup needed)
          if (command.isCurrentContact) {
            console.log(`✅ Using current contact directly: ${exactName}`);
            await sendTextMessage(chatId, `✅ מסיר "${exactName}" מרשימת המורשים לתמלול...`, originalMessageId, TIME.TYPING_INDICATOR);
          } else {
            // Use fuzzy search to find exact contact/group name
            await sendTextMessage(chatId, `🔍 מחפש איש קשר או קבוצה: "${command.contactName}"...`, originalMessageId, TIME.TYPING_INDICATOR);
            const foundContact = await findContactByName(command.contactName);
            
            if (!foundContact) {
              await sendTextMessage(chatId, `❌ לא נמצא איש קשר או קבוצה תואמים ל-"${command.contactName}"\n\n💡 טיפ: הרץ "עדכן אנשי קשר" לסנכרון או וודא שהשם נכון`, originalMessageId, TIME.TYPING_INDICATOR);
              break;
            }
            
            // Use the exact contact name found in DB
            exactName = foundContact.contactName;
            entityType = foundContact.isGroup ? '👥 קבוצה' : '👤 איש קשר';
            await sendTextMessage(chatId, `✅ נמצא ${entityType}: "${command.contactName}" → "${exactName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          }
          
          const wasRemoved = await conversationManager.removeFromVoiceAllowList(exactName);
          if (wasRemoved) {
            await sendTextMessage(chatId, `🚫 ${exactName} הוסר מרשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Removed ${exactName} from voice allow list by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${exactName} לא נמצא ברשימת המורשים לתמלול`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in exclude_from_transcription:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהסרת הרשאת תמלול: ${error.message}`, quotedMessageId: originalMessageId });
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
            await sendTextMessage(chatId, '❌ לא ניתן לזהות את השיחה הנוכחית', originalMessageId, TIME.TYPING_INDICATOR);
            break;
          }
          
          await sendTextMessage(chatId, `📝 מזהה אוטומטית: "${targetName}"`, originalMessageId, TIME.TYPING_INDICATOR);
          
          const wasAdded = await groupAuthStore.addAuthorizedUser(targetName);
          if (wasAdded) {
            await sendTextMessage(chatId, `✅ ${targetName} נוסף לרשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
            logger.info(`✅ Added ${targetName} (auto-detected from current chat) to group creation authorization by ${senderName}`);
          } else {
            await sendTextMessage(chatId, `ℹ️ ${targetName} כבר נמצא ברשימת המורשים ליצירת קבוצות`, originalMessageId, TIME.TYPING_INDICATOR);
          }
        } catch (error) {
          logger.error('❌ Error in add_group_authorization_current:', { error: error.message, stack: error.stack });
          await sendErrorToUser(chatId, error, { customMessage: `❌ שגיאה בהוספת הרשאה: ${error.message}`, quotedMessageId: originalMessageId });
        }
        break;
      }

      default:
        logger.warn(`⚠️ Unknown management command type: ${command.type}`);
        await sendTextMessage(chatId, `⚠️ Unknown management command type: ${command.type}`, originalMessageId, TIME.TYPING_INDICATOR);
    }
  } catch (error) {
    logger.error(`❌ Error handling management command ${command.type}:`, { error: error.message, stack: error.stack });
    await sendErrorToUser(chatId, error, { context: 'PROCESSING', quotedMessageId: originalMessageId });
  }
}

module.exports = {
  handleManagementCommand
};

