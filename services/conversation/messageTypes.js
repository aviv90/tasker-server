/**
 * Message Types Manager
 * 
 * Persistent storage for message type identification (bot/user/command).
 * Replaces in-memory messageTypeCache with DB-backed storage.
 */

const logger = require('../../utils/logger');
const { TIME } = require('../../utils/constants');

class MessageTypesManager {
  constructor(conversationManager, repository) {
    this.conversationManager = conversationManager; // Kept for backward compatibility
    this.repository = repository;
  }

  /**
   * Mark a message as sent by the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  async markAsBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot mark bot message');
      return;
    }

    try {
      await this.repository.upsert(chatId, messageId, 'bot', Date.now());
      logger.debug(`🤖 [MessageTypes] Marked message ${messageId} as bot message in ${chatId}`);
    } catch (error) {
      logger.error('❌ Error marking bot message:', { error: error.message, chatId, messageId });
    }
  }

  /**
   * Mark a message as sent by user (outgoing, not via bot)
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  async markAsUserOutgoing(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot mark user outgoing message');
      return;
    }

    try {
      await this.repository.upsert(chatId, messageId, 'user_outgoing', Date.now());
      logger.debug(`👤 [MessageTypes] Marked message ${messageId} as user outgoing in ${chatId}`);
    } catch (error) {
      logger.error('❌ Error marking user outgoing message:', { error: error.message, chatId, messageId });
    }
  }

  /**
   * Check if a message is from the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID to check
   * @returns {Promise<boolean>} True if message is from bot
   */
  async isBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return false;
    
    if (!this.repository) {
      return false;
    }

    try {
      const type = await this.repository.findType(chatId, messageId);
      return type === 'bot';
    } catch (error) {
      logger.error('❌ Error checking bot message:', { error: error.message, chatId, messageId });
      return false;
    }
  }

  /**
   * Check if a message is user outgoing (not via bot)
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID to check
   * @returns {Promise<boolean>} True if message is user outgoing
   */
  async isUserOutgoing(chatId, messageId) {
    if (!chatId || !messageId) return false;
    
    if (!this.repository) {
      return false;
    }

    try {
      const type = await this.repository.findType(chatId, messageId);
      return type === 'user_outgoing';
    } catch (error) {
      logger.error('❌ Error checking user outgoing message:', { error: error.message, chatId, messageId });
      return false;
    }
  }

  /**
   * Get message type
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID
   * @param {string} text - Message text
   * @returns {Promise<string>} Message type: 'bot' | 'user_outgoing' | 'command' | 'user_incoming'
   */
  async getMessageType(chatId, messageId, text) {
    // Logic reuse
    const isCommand = text && /^#\s+/.test(text.trim());
    const defaultType = isCommand ? 'command' : 'user_incoming';

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
        if (type === 'user_outgoing' && isCommand) {
          return 'command';
        }
        return type;
      }
      
      return defaultType;
    } catch (error) {
      logger.error('❌ Error getting message type:', { error: error.message, chatId, messageId });
      return defaultType;
    }
  }

  /**
   * Check if a message is a command (by text content)
   * @param {string} text - Message text
   * @returns {boolean} True if message is a command
   */
  isCommand(text) {
    if (!text || typeof text !== 'string') return false;
    return /^#\s+/.test(text.trim());
  }

  /**
   * Cleanup old entries (older than TTL)
   * @param {number} ttlMs - TTL in milliseconds (default: 30 days)
   */
  async cleanup(ttlMs = 30 * TIME.DAY) {
    if (!this.repository) {
      return;
    }

    const cutoffTime = Date.now() - ttlMs;
    
    try {
      const count = await this.repository.deleteOlderThan(cutoffTime);
      if (count > 0) {
        logger.info(`🧹 [MessageTypes] Cleaned up ${count} old message type entries`);
      }
    } catch (error) {
      logger.error('❌ Error cleaning up message types:', { error: error.message });
    }
  }

  /**
   * Clear all message types (for management command)
   */
  async clearAll() {
    if (!this.repository) {
      return;
    }

    try {
      await this.repository.deleteAll();
      logger.info('🗑️ [MessageTypes] All message types cleared');
    } catch (error) {
      logger.error('❌ Error clearing message types:', { error: error.message });
    }
  }
}

module.exports = MessageTypesManager;
