/**
 * Management Commands - Conversation Management
 * Handles conversation-related management commands
 */

import * as greenApiService from '../../../services/greenApiService';
import { sendErrorToUser } from '../../../utils/errorSender';
import conversationManager from '../../../services/conversationManager';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';

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
  
  // Clear message types, commands, and agent context in parallel (independent operations)
  await Promise.all([
    conversationManager.clearAllMessageTypes(),
    conversationManager.commandsManager.clearAll(),
    conversationManager.clearAgentContext(chatId)
  ]);
  
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
  // Use chatHistoryService (SSOT) for proper chronological ordering
  try {
    const { getChatHistory } = await import('../../../utils/chatHistoryService');
    const historyResult = await getChatHistory(chatId, 20, { format: 'display' });
    
    if (historyResult.success && historyResult.messages.length > 0) {
      let historyText = '📜 **היסטוריית שיחה (20 הודעות אחרונות):**\n\n';
      
      // Process messages in parallel for better performance
      const messageLines = historyResult.messages.map((msg) => {
        const textContent = msg.content || '[הודעה ללא טקסט]';
        const role = msg.role === 'assistant' ? '🤖' : '👤';
        return `${role} ${textContent}`;
      });
      
      historyText += messageLines.join('\n\n') + '\n\n';
      
      await greenApiService.sendTextMessage(chatId, historyText, originalMessageId || undefined, TIME.TYPING_INDICATOR);
    } else {
      await greenApiService.sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה', originalMessageId || undefined, TIME.TYPING_INDICATOR);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('❌ Error fetching history:', { error: errorMessage, stack: errorStack });
    await sendErrorToUser(chatId, error, { context: 'SHOW_HISTORY', quotedMessageId: originalMessageId || undefined });
  }
}

