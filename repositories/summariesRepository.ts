/**
 * Summaries Repository
 * Handles direct database interactions for long-term memory (summaries).
 */

import { Pool } from 'pg';

export interface SummaryData {
    id?: number;
    chatId?: string;
    summary: string;
    keyTopics?: string[];
    userPreferences?: Record<string, unknown>;
    messageCount: number;
    summaryDate?: Date;
}

class SummariesRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Save conversation summary
   */
  async save(summaryData: SummaryData): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Ensure chatId is present for saving
      if (!summaryData.chatId) {
        throw new Error('chatId is required for saving summary');
      }

      await client.query(`
        INSERT INTO conversation_summaries 
        (chat_id, summary, key_topics, user_preferences, message_count, summary_date)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [
        summaryData.chatId,
        summaryData.summary,
        JSON.stringify(summaryData.keyTopics || []),
        JSON.stringify(summaryData.userPreferences || {}),
        summaryData.messageCount
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get summaries for a chat
   */
  async findByChatId(chatId: string, limit: number): Promise<SummaryData[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT summary, key_topics, user_preferences, message_count, summary_date, id
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT $2
      `, [chatId, limit]);
      
      return result.rows.map((row) => ({
        id: row.id,
        chatId, // Explicitly return chatId even if not in select (implied)
        summary: row.summary,
        keyTopics: row.key_topics || [],
        userPreferences: row.user_preferences || {},
        messageCount: row.message_count,
        summaryDate: row.summary_date
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get user preferences from recent summaries
   */
  async findPreferences(chatId: string, limit: number): Promise<Record<string, unknown>[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT user_preferences
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT $2
      `, [chatId, limit]);
      
      return result.rows.map((row) => row.user_preferences || {});
    } finally {
      client.release();
    }
  }

  /**
   * Update user preferences for a specific summary
   */
  async updatePreferences(id: number, preferences: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE conversation_summaries
        SET user_preferences = $1, summary_date = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [JSON.stringify(preferences), id]);
    } finally {
      client.release();
    }
  }

  /**
   * Delete old summaries, keeping only N most recent per chat
   */
  async deleteOldSummaries(keepPerChat: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM conversation_summaries
        WHERE id NOT IN (
          SELECT id
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY summary_date DESC) as rn
            FROM conversation_summaries
          ) ranked
          WHERE rn <= $1
        )
        RETURNING id
      `, [keepPerChat]);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }
}

export default SummariesRepository;
