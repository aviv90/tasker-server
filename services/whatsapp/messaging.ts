/**
 * WhatsApp Messaging Functions
 * 
 * NOTE: Most ACK messages are now handled by the Agent's centralized ackUtils.
 * This file is kept for backward compatibility with specific flows that are
 * not yet migrated to the Agent system.
 * 
 * For new features, use:
 * - services/agent/utils/ackUtils.ts - for Agent tool ACKs
 * - services/agent/config/constants.ts - for TOOL_ACK_MESSAGES (SSOT)
 */

import { sendTextMessage } from '../greenApiService';
import logger from '../../utils/logger';

/**
 * Command object structure
 */
interface Command {
  type: string;
  originalMessageId?: string;
}

/**
 * Send acknowledgment message for a command
 * 
 * NOTE: This function is deprecated for most use cases.
 * New commands should use the Agent's centralized ACK system instead.
 * 
 * @param chatId - WhatsApp chat ID
 * @param command - Command object with type and optional parameters
 * @deprecated Use Agent's sendToolAckMessage for new features
 */
export async function sendAck(chatId: string, command: Command): Promise<void> {
  let ackMessage = '';
  
  switch (command.type) {
    // ═══════════════════ VOICE (still used for automatic transcription) ═══════════════════
    case 'voice_processing':
      ackMessage = '🎤 מעבד ומכין תשובה...';
      break;
    case 'voice_cloning_response':
      ackMessage = '🎤 קיבלתי! מתחיל שיבוט קול ויצירת תגובה...';
      break;
      
    default:
      return; // No ACK needed - most commands now use Agent's ackUtils
  }
  
  try {
    const quotedMessageId = command.originalMessageId || null;
    await sendTextMessage(chatId, ackMessage, quotedMessageId, 1000);
    logger.info(`✅ ACK sent for ${command.type}`, { chatId, commandType: command.type });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending ACK:', { error: errorMessage, chatId, commandType: command.type });
  }
}

