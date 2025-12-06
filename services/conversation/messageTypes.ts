/**
 * Message Types Manager
 * 
 * Persistent storage for message type identification (bot/user/command).
 * Replaces in-memory messageTypeCache with DB-backed storage.
 */

import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';
import MessageTypesRepository from '../../repositories/messageTypesRepository';
import { isCommand } from '../../utils/commandUtils';

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  [key: string]: unknown;
}

/**
 * Message type values
 */
type MessageType = 'bot' | 'user_outgoing' | 'command' | 'user_incoming';

class MessageTypesManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;
  private repository: MessageTypesRepository | null;

  constructor(conversationManager: ConversationManager, repository: MessageTypesRepository | null) {
    this._conversationManager = conversationManager;
    this.repository = repository;
  }

  /**
   * Mark a message as sent by the bot
   * @param chatId - Chat ID
   * @param messageId - Message ID from Green API
   */
  async markAsBotMessage(chatId: string, messageId: string): Promise<void> {
    if (!chatId || !messageId) return;

    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot mark bot message');
      return;
    }

    try {
      await this.repository.upsert(chatId, messageId, 'bot', Date.now());
      logger.debug(`🤖 [MessageTypes] Marked message ${messageId} as bot message in ${chatId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error marking bot message:', { error: errorMessage, chatId, messageId });
    }
  }

  /**
   * Mark a message as sent by user (outgoing, not via bot)
   * @param chatId - Chat ID
   * @param messageId - Message ID from Green API
   */
  async markAsUserOutgoing(chatId: string, messageId: string): Promise<void> {
    if (!chatId || !messageId) return;

    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot mark user outgoing message');
      return;
    }

    try {
      await this.repository.upsert(chatId, messageId, 'user_outgoing', Date.now());
      logger.debug(`👤 [MessageTypes] Marked message ${messageId} as user outgoing in ${chatId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error marking user outgoing message:', { error: errorMessage, chatId, messageId });
    }
  }

  /**
   * Check if a message is from the bot
   * @param chatId - Chat ID
   * @param messageId - Message ID to check
   * @returns True if message is from bot
   */
  async isBotMessage(chatId: string, messageId: string): Promise<boolean> {
    if (!chatId || !messageId) return false;

    if (!this.repository) {
      return false;
    }

    try {
      const type = await this.repository.findType(chatId, messageId);
      return type === 'bot';
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error checking bot message:', { error: errorMessage, chatId, messageId });
      return false;
    }
  }

  /**
   * Check if a message is user outgoing (not via bot)
   * @param chatId - Chat ID
   * @param messageId - Message ID to check
   * @returns True if message is user outgoing
   */
  async isUserOutgoing(chatId: string, messageId: string): Promise<boolean> {
    if (!chatId || !messageId) return false;

    if (!this.repository) {
      return false;
    }

    try {
      const type = await this.repository.findType(chatId, messageId);
      return type === 'user_outgoing';
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error checking user outgoing message:', { error: errorMessage, chatId, messageId });
      return false;
    }
  }

  /**
   * Get message type
   * @param chatId - Chat ID
   * @param messageId - Message ID
   * @param text - Message text
   * @returns Message type: 'bot' | 'user_outgoing' | 'command' | 'user_incoming'
   */
  async getMessageType(chatId: string, messageId: string, text: string | null | undefined): Promise<MessageType> {
    // Logic reuse
    const isCommandMsg = isCommand(text);
    const defaultType: MessageType = isCommandMsg ? 'command' : 'user_incoming';

    if (!chatId || !messageId) {
      return defaultType;
    }

    if (!this.repository) {
      return defaultType;
    }

    try {
      const type = await this.repository.findType(chatId, messageId);

      if (type) {
        // If it's user_outgoing but also a command by text, return 'command'
        if (type === 'user_outgoing' && isCommandMsg) {
          return 'command';
        }
        return type as MessageType;
      }

      return defaultType;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting message type:', { error: errorMessage, chatId, messageId });
      return defaultType;
    }
  }

  /**
   * Check if a message is a command (by text content)
   * @param text - Message text
   * @returns True if message is a command
   */
  isCommand(text: string | null | undefined): boolean {
    return isCommand(text);
  }

  /**
   * Cleanup old entries (older than TTL)
   * @param ttlMs - TTL in milliseconds (default: 30 days)
   */
  async cleanup(ttlMs: number = 30 * TIME.DAY): Promise<void> {
    if (!this.repository) {
      return;
    }

    const cutoffTime = Date.now() - ttlMs;

    try {
      const count = await this.repository.deleteOlderThan(cutoffTime);
      if (count > 0) {
        logger.info(`🧹 [MessageTypes] Cleaned up ${count} old message type entries`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error cleaning up message types:', { error: errorMessage });
    }
  }

  /**
   * Clear all message types (for management command)
   */
  async clearAll(): Promise<void> {
    if (!this.repository) {
      return;
    }

    try {
      await this.repository.deleteAll();
      logger.info('🗑️ [MessageTypes] All message types cleared');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error clearing message types:', { error: errorMessage });
    }
  }
}

export default MessageTypesManager;

