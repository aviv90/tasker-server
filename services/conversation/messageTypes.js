/**
 * Message Types Manager
 * 
 * Persistent storage for message type identification (bot/user/command).
 * Replaces in-memory messageTypeCache with DB-backed storage.
 */

const logger = require('../../utils/logger');

class MessageTypesManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Mark a message as sent by the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  async markAsBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot mark bot message');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO message_types (chat_id, message_id, message_type, timestamp)
        VALUES ($1, $2, 'bot', $3)
        ON CONFLICT (chat_id, message_id) 
        DO UPDATE SET message_type = 'bot', timestamp = $3
      `, [chatId, messageId, Date.now()]);
      
      logger.debug(`🤖 [MessageTypes] Marked message ${messageId} as bot message in ${chatId}`);
    } catch (error) {
      logger.error('❌ Error marking bot message:', { error: error.message, chatId, messageId });
    } finally {
      client.release();
    }
  }

  /**
   * Mark a message as sent by user (outgoing, not via bot)
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  async markAsUserOutgoing(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot mark user outgoing message');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO message_types (chat_id, message_id, message_type, timestamp)
        VALUES ($1, $2, 'user_outgoing', $3)
        ON CONFLICT (chat_id, message_id) 
        DO UPDATE SET message_type = 'user_outgoing', timestamp = $3
      `, [chatId, messageId, Date.now()]);
      
      logger.debug(`👤 [MessageTypes] Marked message ${messageId} as user outgoing in ${chatId}`);
    } catch (error) {
      logger.error('❌ Error marking user outgoing message:', { error: error.message, chatId, messageId });
    } finally {
      client.release();
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
    
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT message_type FROM message_types
        WHERE chat_id = $1 AND message_id = $2
      `, [chatId, messageId]);
      
      return result.rows.length > 0 && result.rows[0].message_type === 'bot';
    } catch (error) {
      logger.error('❌ Error checking bot message:', { error: error.message, chatId, messageId });
      return false;
    } finally {
      client.release();
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
    
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT message_type FROM message_types
        WHERE chat_id = $1 AND message_id = $2
      `, [chatId, messageId]);
      
      return result.rows.length > 0 && result.rows[0].message_type === 'user_outgoing';
    } catch (error) {
      logger.error('❌ Error checking user outgoing message:', { error: error.message, chatId, messageId });
      return false;
    } finally {
      client.release();
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
    if (!chatId || !messageId) {
      // Check by text if it's a command
      if (text && /^#\s+/.test(text.trim())) {
        return 'command';
      }
      return 'user_incoming';
    }
    
    if (!this.conversationManager.isInitialized) {
      // Fallback to text-based check
      if (text && /^#\s+/.test(text.trim())) {
        return 'command';
      }
      return 'user_incoming';
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT message_type FROM message_types
        WHERE chat_id = $1 AND message_id = $2
      `, [chatId, messageId]);
      
      if (result.rows.length > 0) {
        const type = result.rows[0].message_type;
        // If it's user_outgoing but also a command by text, return 'command'
        if (type === 'user_outgoing' && text && /^#\s+/.test(text.trim())) {
          return 'command';
        }
        return type;
      }
      
      // If not in DB, check by text
      if (text && /^#\s+/.test(text.trim())) {
        return 'command';
      }
      
      return 'user_incoming';
    } catch (error) {
      logger.error('❌ Error getting message type:', { error: error.message, chatId, messageId });
      // Fallback to text-based check
      if (text && /^#\s+/.test(text.trim())) {
        return 'command';
      }
      return 'user_incoming';
    } finally {
      client.release();
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
   * @param {number} ttlMs - TTL in milliseconds (default: 7 days)
   */
  async cleanup(ttlMs = 7 * 24 * 60 * 60 * 1000) {
    if (!this.conversationManager.isInitialized) {
      return;
    }

    const client = await this.conversationManager.pool.connect();
    const cutoffTime = Date.now() - ttlMs;
    
    try {
      const result = await client.query(`
        DELETE FROM message_types
        WHERE timestamp < $1
      `, [cutoffTime]);
      
      if (result.rowCount > 0) {
        logger.info(`🧹 [MessageTypes] Cleaned up ${result.rowCount} old message type entries`);
      }
    } catch (error) {
      logger.error('❌ Error cleaning up message types:', { error: error.message });
    } finally {
      client.release();
    }
  }

  /**
   * Clear all message types (for management command)
   */
  async clearAll() {
    if (!this.conversationManager.isInitialized) {
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query('DELETE FROM message_types');
      logger.info('🗑️ [MessageTypes] All message types cleared');
    } catch (error) {
      logger.error('❌ Error clearing message types:', { error: error.message });
    } finally {
      client.release();
    }
  }
}

module.exports = MessageTypesManager;

