/**
 * Agent Context Repository
 * Handles direct database interactions for agent short-term memory (context).
 */

class AgentContextRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Upsert agent context
   * @param {string} chatId 
   * @param {Array} toolCalls 
   * @param {Object} generatedAssets 
   */
  async upsert(chatId, toolCalls, generatedAssets) {
    const client = await this.pool.connect();
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
        JSON.stringify(toolCalls || []),
        JSON.stringify(generatedAssets || { images: [], videos: [], audio: [] })
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get agent context by chat ID
   * @param {string} chatId 
   * @returns {Promise<Object|null>}
   */
  async findByChatId(chatId) {
    const client = await this.pool.connect();
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
    } finally {
      client.release();
    }
  }

  /**
   * Delete context for a chat
   * @param {string} chatId 
   */
  async deleteByChatId(chatId) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        DELETE FROM agent_context
        WHERE chat_id = $1
      `, [chatId]);
    } finally {
      client.release();
    }
  }

  /**
   * Delete contexts older than specific interval
   * @param {number} days 
   * @returns {Promise<number>} count of deleted rows
   */
  async deleteOlderThanDays(days) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM agent_context
        WHERE last_updated < NOW() - INTERVAL '${days} days'
        RETURNING chat_id
      `);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }
}

module.exports = AgentContextRepository;

