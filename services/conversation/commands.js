/**
 * Last commands management (for retry functionality)
 */
class CommandsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Save last command for retry functionality
   */
  async saveLastCommand(chatId, tool, args, options = {}) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save last command');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const timestamp = Date.now();
      const { normalized, imageUrl, videoUrl, audioUrl } = options;
      
      // Use UPSERT (INSERT ... ON CONFLICT) to update if chat_id exists
      await client.query(`
        INSERT INTO last_commands (chat_id, tool, args, normalized, image_url, video_url, audio_url, timestamp, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id) 
        DO UPDATE SET 
          tool = EXCLUDED.tool,
          args = EXCLUDED.args,
          normalized = EXCLUDED.normalized,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          audio_url = EXCLUDED.audio_url,
          timestamp = EXCLUDED.timestamp,
          updated_at = CURRENT_TIMESTAMP
      `, [
        chatId,
        tool,
        JSON.stringify(args),
        JSON.stringify(normalized),
        imageUrl || null,
        videoUrl || null,
        audioUrl || null,
        timestamp
      ]);
      
      console.log(`💾 Saved last command for ${chatId}: ${tool}`);
    } catch (error) {
      console.error('❌ Error saving last command:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get last command for retry functionality
   */
  async getLastCommand(chatId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get last command');
      return null;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT tool, args, normalized, image_url, video_url, audio_url, timestamp
        FROM last_commands
        WHERE chat_id = $1
      `, [chatId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        tool: row.tool,
        args: this.parseJSON(row.args),
        normalized: this.parseJSON(row.normalized),
        imageUrl: row.image_url,
        videoUrl: row.video_url,
        audioUrl: row.audio_url,
        timestamp: parseInt(row.timestamp)
      };
    } catch (error) {
      console.error('❌ Error getting last command:', error.message);
      return null;
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
      console.warn(`⚠️ Failed to parse JSON value: ${err.message}`);
      return null;
    }
  }
}

module.exports = CommandsManager;

