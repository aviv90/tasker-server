/**
 * Agent context management (persistent storage)
 */
class AgentContextManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Save agent context to database (persistent storage)
   */
  async saveAgentContext(chatId, context) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save agent context');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO agent_context (chat_id, tool_calls, generated_assets, last_updated)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id)
        DO UPDATE SET
          tool_calls = $2,
          generated_assets = $3,
          last_updated = CURRENT_TIMESTAMP
      `, [
        chatId,
        JSON.stringify(context.toolCalls || []),
        JSON.stringify(context.generatedAssets || { images: [], videos: [], audio: [] })
      ]);

      console.log(`💾 [Agent Context] Saved to DB for chat ${chatId}`);
    } catch (error) {
      console.error('❌ Error saving agent context:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get agent context from database
   */
  async getAgentContext(chatId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get agent context');
      return null;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT tool_calls, generated_assets, last_updated
        FROM agent_context
        WHERE chat_id = $1
      `, [chatId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        toolCalls: row.tool_calls || [],
        generatedAssets: row.generated_assets || { images: [], videos: [], audio: [] },
        lastUpdated: row.last_updated
      };
    } catch (error) {
      console.error('❌ Error getting agent context:', error.message);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Clear agent context for a chat
   */
  async clearAgentContext(chatId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot clear agent context');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query(`
        DELETE FROM agent_context
        WHERE chat_id = $1
      `, [chatId]);

      console.log(`🗑️ [Agent Context] Cleared for chat ${chatId}`);
    } catch (error) {
      console.error('❌ Error clearing agent context:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old agent context (older than specified days)
   * @param {number} olderThanDays - Delete context older than X days (default: 30)
   * @returns {number} - Number of rows deleted
   */
  async cleanupOldAgentContext(olderThanDays = 30) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot cleanup agent context');
      return 0;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        DELETE FROM agent_context
        WHERE last_updated < NOW() - INTERVAL '${olderThanDays} days'
        RETURNING chat_id
      `);

      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        console.log(`🧹 [Agent Context Cleanup] Deleted ${deletedCount} old context(s) (older than ${olderThanDays} days)`);
      } else {
        console.log(`✅ [Agent Context Cleanup] No old contexts found`);
      }

      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old agent context:', error.message);
      return 0;
    } finally {
      client.release();
    }
  }
}

module.exports = AgentContextManager;

