/**
 * Last commands management (for retry functionality)
 * 
 * Persistent storage for commands in DB (replaces in-memory messageTypeCache).
 * Supports both single-step and multi-step commands.
 */
class CommandsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Save command for retry functionality
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   * @param {Object} metadata - Command metadata (tool, toolArgs, plan, prompt, etc.)
   */
  async saveCommand(chatId, messageId, metadata) {
    if (!chatId || !messageId) return;
    
    if (!this.conversationManager.isInitialized) {
      const logger = require('../../utils/logger');
      logger.warn('⚠️ Database not initialized, cannot save command');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    const logger = require('../../utils/logger');
    
    try {
      const timestamp = Date.now();
      const {
        tool,
        toolArgs,
        args,
        plan,
        isMultiStep,
        prompt,
        result,
        failed,
        normalized,
        imageUrl,
        videoUrl,
        audioUrl
      } = metadata;
      
      // Use UPSERT (INSERT ... ON CONFLICT) to update if exists
      await client.query(`
        INSERT INTO last_commands (
          chat_id, message_id, tool, tool_args, args, plan, is_multi_step,
          prompt, result, failed, normalized, image_url, video_url, audio_url, timestamp, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id, message_id) 
        DO UPDATE SET 
          tool = EXCLUDED.tool,
          tool_args = EXCLUDED.tool_args,
          args = EXCLUDED.args,
          plan = EXCLUDED.plan,
          is_multi_step = EXCLUDED.is_multi_step,
          prompt = EXCLUDED.prompt,
          result = EXCLUDED.result,
          failed = EXCLUDED.failed,
          normalized = EXCLUDED.normalized,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          audio_url = EXCLUDED.audio_url,
          timestamp = EXCLUDED.timestamp,
          updated_at = CURRENT_TIMESTAMP
      `, [
        chatId,
        messageId,
        tool || null,
        toolArgs ? JSON.stringify(toolArgs) : null,
        args ? JSON.stringify(args) : null,
        plan ? JSON.stringify(plan) : null,
        isMultiStep || false,
        prompt || null,
        result ? JSON.stringify(result) : null,
        failed || false,
        normalized ? JSON.stringify(normalized) : null,
        imageUrl || null,
        videoUrl || null,
        audioUrl || null,
        timestamp
      ]);
      
      logger.debug(`💾 [Commands] Saved command ${messageId} for retry in ${chatId}: ${tool}`);
    } catch (error) {
      logger.error('❌ Error saving command:', { error: error.message, chatId, messageId });
    } finally {
      client.release();
    }
  }

  /**
   * Save last command for retry functionality (backward compatibility)
   * @deprecated Use saveCommand() instead
   */
  async saveLastCommand(chatId, tool, args, options = {}) {
    const logger = require('../../utils/logger');
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
    
    if (!this.conversationManager.isInitialized) {
      const logger = require('../../utils/logger');
      logger.warn('⚠️ Database not initialized, cannot get last command');
      return null;
    }

    const client = await this.conversationManager.pool.connect();
    const logger = require('../../utils/logger');
    
    try {
      // Get the most recent command (highest timestamp)
      const result = await client.query(`
        SELECT 
          message_id, tool, tool_args, args, plan, is_multi_step,
          prompt, result, failed, normalized, image_url, video_url, audio_url, timestamp
        FROM last_commands
        WHERE chat_id = $1
        ORDER BY timestamp DESC
        LIMIT 1
      `, [chatId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
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
    } finally {
      client.release();
    }
  }

  /**
   * Cleanup old commands (older than TTL)
   * @param {number} ttlMs - TTL in milliseconds (default: 30 days)
   */
  async cleanup(ttlMs = 30 * TIME.DAY) {
    if (!this.conversationManager.isInitialized) {
      return;
    }

    const client = await this.conversationManager.pool.connect();
    const logger = require('../../utils/logger');
    const cutoffTime = Date.now() - ttlMs;
    
    try {
      const result = await client.query(`
        DELETE FROM last_commands
        WHERE timestamp < $1
      `, [cutoffTime]);
      
      if (result.rowCount > 0) {
        logger.info(`🧹 [Commands] Cleaned up ${result.rowCount} old commands`);
      }
    } catch (error) {
      logger.error('❌ Error cleaning up commands:', { error: error.message });
    } finally {
      client.release();
    }
  }

  /**
   * Clear all commands (for management command)
   */
  async clearAll() {
    if (!this.conversationManager.isInitialized) {
      return;
    }

    const client = await this.conversationManager.pool.connect();
    const logger = require('../../utils/logger');
    
    try {
      await client.query('DELETE FROM last_commands');
      logger.info('🗑️ [Commands] All commands cleared');
    } catch (error) {
      logger.error('❌ Error clearing commands:', { error: error.message });
    } finally {
      client.release();
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

