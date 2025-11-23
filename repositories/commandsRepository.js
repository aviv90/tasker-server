/**
 * Commands Repository
 * Handles direct database interactions for commands history.
 */

const logger = require('../utils/logger');

class CommandsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Save or update a command
   * @param {Object} commandData 
   */
  async save(commandData) {
    const client = await this.pool.connect();
    try {
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
        commandData.chatId,
        commandData.messageId,
        commandData.tool || null,
        commandData.toolArgs ? JSON.stringify(commandData.toolArgs) : null,
        commandData.args ? JSON.stringify(commandData.args) : null,
        commandData.plan ? JSON.stringify(commandData.plan) : null,
        commandData.isMultiStep || false,
        commandData.prompt || null,
        commandData.result ? JSON.stringify(commandData.result) : null,
        commandData.failed || false,
        commandData.normalized ? JSON.stringify(commandData.normalized) : null,
        commandData.imageUrl || null,
        commandData.videoUrl || null,
        commandData.audioUrl || null,
        commandData.timestamp
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get last command for a chat
   * @param {string} chatId 
   * @returns {Promise<Object|null>}
   */
  async findLastByChatId(chatId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          message_id, tool, tool_args, args, plan, is_multi_step,
          prompt, result, failed, normalized, image_url, video_url, audio_url, timestamp
        FROM last_commands
        WHERE chat_id = $1
        ORDER BY timestamp DESC
        LIMIT 1
      `, [chatId]);
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } finally {
      client.release();
    }
  }

  /**
   * Delete commands older than timestamp
   * @param {number} cutoffTime 
   * @returns {Promise<number>} count of deleted rows
   */
  async deleteOlderThan(cutoffTime) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM last_commands
        WHERE timestamp < $1
      `, [cutoffTime]);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Clear all commands
   */
  async deleteAll() {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM last_commands');
    } finally {
      client.release();
    }
  }
}

module.exports = CommandsRepository;

