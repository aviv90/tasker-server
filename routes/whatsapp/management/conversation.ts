/**
 * Management Commands - Conversation Management
 * Handles conversation-related management commands
 */

import * as greenApiService from '../../../services/greenApiService';
import { sendErrorToUser } from '../../../utils/errorSender';
import conversationManager from '../../../services/conversationManager';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';

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
 * Handle clear all conversations command
 */
export async function handleClearAllConversations(
  chatId: string,
  senderName: string,
  originalMessageId: string | null | undefined
): Promise<void> {
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
    originalMessageId || undefined, 
    TIME.TYPING_INDICATOR
  );
  logger.info(`🗑️ All conversation histories cleared by ${senderName} (${deletedCount} messages deleted, cache invalidated)`);
}

/**
 * Handle show history command
 */
export async function handleShowHistory(
  chatId: string,
  originalMessageId: string | null | undefined
): Promise<void> {
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
}

