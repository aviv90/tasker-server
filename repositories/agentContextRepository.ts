/**
 * Agent Context Repository
 * Handles direct database interactions for agent short-term memory (context).
 */

import { Pool } from 'pg';

export interface ToolCall {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    timestamp?: Date;
    [key: string]: unknown;
}

export interface GeneratedAssets {
    images: string[];
    videos: string[];
    audio: string[];
}

export interface AgentContext {
    toolCalls: ToolCall[];
    generatedAssets: GeneratedAssets;
    lastUpdated: Date;
}

class AgentContextRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Upsert agent context
   * @param {string} chatId 
   * @param {ToolCall[]} toolCalls 
   * @param {GeneratedAssets} generatedAssets 
   */
  async upsert(chatId: string, toolCalls: ToolCall[], generatedAssets: GeneratedAssets): Promise<void> {
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
        JSON.stringify(generatedAssets || { images: [], videos: [], audio: [] } as GeneratedAssets)
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
  async findByChatId(chatId: string): Promise<AgentContext | null> {
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
  async deleteByChatId(chatId: string) {
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
  async deleteOlderThanDays(days: number): Promise<number> {
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

export default AgentContextRepository;
