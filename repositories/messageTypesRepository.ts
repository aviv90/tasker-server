/**
 * Message Types Repository
 * Handles direct database interactions for message type identification.
 */

import { Pool } from 'pg';

class MessageTypesRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Upsert a message type (bot/user_outgoing)
   * @param {string} chatId 
   * @param {string} messageId 
   * @param {string} type - 'bot' | 'user_outgoing'
   * @param {number} timestamp 
   */
  async upsert(chatId: string, messageId: string, type: string, timestamp: number) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO message_types (chat_id, message_id, message_type, timestamp)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (chat_id, message_id) 
        DO UPDATE SET message_type = $3, timestamp = $4
      `, [chatId, messageId, type, timestamp]);
    } finally {
      client.release();
    }
  }

  /**
   * Get message type by ID
   * @param {string} chatId 
   * @param {string} messageId 
   * @returns {Promise<string|null>}
   */
  async findType(chatId: string, messageId: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT message_type FROM message_types
        WHERE chat_id = $1 AND message_id = $2
      `, [chatId, messageId]);
      
      return result.rows.length > 0 ? result.rows[0].message_type : null;
    } finally {
      client.release();
    }
  }

  /**
   * Delete entries older than timestamp
   * @param {number} cutoffTime 
   * @returns {Promise<number>} count of deleted rows
   */
  async deleteOlderThan(cutoffTime: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM message_types
        WHERE timestamp < $1
      `, [cutoffTime]);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Clear all entries
   */
  async deleteAll() {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM message_types');
    } finally {
      client.release();
    }
  }
}

export default MessageTypesRepository;
