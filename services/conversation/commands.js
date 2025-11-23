/**
 * Last commands management (for retry functionality)
 * 
 * Persistent storage for commands in DB (replaces in-memory messageTypeCache).
 * Supports both single-step and multi-step commands.
 */

const logger = require('../../utils/logger');
const { TIME } = require('../../utils/constants');
const { commandSchema } = require('../../schemas/command.schema');

class CommandsManager {
  constructor(conversationManager, repository) {
    this.conversationManager = conversationManager; // Kept for backward compatibility
    this.repository = repository;
  }

  /**
   * Save command for retry functionality
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   * @param {Object} metadata - Command metadata (tool, toolArgs, plan, prompt, etc.)
   */
  async saveCommand(chatId, messageId, metadata) {
    if (!chatId || !messageId) return;
    
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save command');
      return;
    }

    try {
      const timestamp = Date.now();
      const commandData = {
        chatId,
        messageId,
        timestamp,
        ...metadata
      };
      
      // Validate data
      const validatedData = commandSchema.parse(commandData);

      await this.repository.save(validatedData);
      logger.debug(`💾 [Commands] Saved command ${messageId} for retry in ${chatId}: ${metadata.tool}`);
    } catch (error) {
      logger.error('❌ Error saving command:', { error: error.message, chatId, messageId });
    }
  }

  /**
   * Save last command for retry functionality (backward compatibility)
   * @deprecated Use saveCommand() instead
   */
  async saveLastCommand(chatId, tool, args, options = {}) {
    logger.warn('⚠️ [DEPRECATED] saveLastCommand() is deprecated. Use saveCommand() instead.');
    
    // For backward compatibility, create a messageId from timestamp
    const messageId = `legacy_${Date.now()}`;
    await this.saveCommand(chatId, messageId, {
      tool,
      toolArgs: args,
      args: args,
      prompt: options.prompt || '',
      normalized: options.normalized,
      imageUrl: options.imageUrl,
      videoUrl: options.videoUrl,
      audioUrl: options.audioUrl
    });
  }

  /**
   * Get last command for retry functionality
   * @param {string} chatId - Chat ID
   * @returns {Promise<Object|null>} Last command metadata or null
   */
  async getLastCommand(chatId) {
    if (!chatId) return null;
    
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get last command');
      return null;
    }

    try {
      const row = await this.repository.findLastByChatId(chatId);
      
      if (!row) return null;
      
      return {
        messageId: row.message_id,
        tool: row.tool,
        toolArgs: this.parseJSON(row.tool_args) || this.parseJSON(row.args),
        args: this.parseJSON(row.args),
        plan: this.parseJSON(row.plan),
        isMultiStep: row.is_multi_step || false,
        prompt: row.prompt,
        result: this.parseJSON(row.result),
        failed: row.failed || false,
        normalized: this.parseJSON(row.normalized),
        imageUrl: row.image_url,
        videoUrl: row.video_url,
        audioUrl: row.audio_url,
        timestamp: parseInt(row.timestamp)
      };
    } catch (error) {
      logger.error('❌ Error getting last command:', { error: error.message, chatId });
      return null;
    }
  }

  /**
   * Cleanup old commands (older than TTL)
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
        logger.info(`🧹 [Commands] Cleaned up ${count} old commands`);
      }
    } catch (error) {
      logger.error('❌ Error cleaning up commands:', { error: error.message });
    }
  }

  /**
   * Clear all commands (for management command)
   */
  async clearAll() {
    if (!this.repository) {
      return;
    }

    try {
      await this.repository.deleteAll();
      logger.info('🗑️ [Commands] All commands cleared');
    } catch (error) {
      logger.error('❌ Error clearing commands:', { error: error.message });
    }
  }

  parseJSON(value) {
    if (!value) {
      return null;
    }
    
    if (typeof value === 'object') {
      return value;
    }
    
    try {
      return JSON.parse(value);
    } catch (err) {
      logger.warn(`⚠️ Failed to parse JSON value: ${err.message}`);
      return null;
    }
  }
}

module.exports = CommandsManager;
