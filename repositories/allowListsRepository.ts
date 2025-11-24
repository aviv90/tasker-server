/**
 * Allow Lists Repository
 * Handles direct database interactions for various allow lists (Voice, Media, Groups).
 */

import { Pool } from 'pg';

class AllowListsRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ═══════════════════ VOICE SETTINGS ═══════════════════

  async getVoiceSettings(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT enabled FROM voice_settings LIMIT 1');
      return result.rows.length > 0 ? result.rows[0].enabled : false;
    } finally {
      client.release();
    }
  }

  async setVoiceSettings(enabled: boolean) {
    const client = await this.pool.connect();
    try {
      // Try update first
      const result = await client.query(`
        UPDATE voice_settings SET enabled = $1, updated_at = CURRENT_TIMESTAMP
        RETURNING enabled
      `, [enabled]);
      
      if (result.rowCount === 0) {
        // Insert if not exists
        await client.query(`
          INSERT INTO voice_settings (enabled) VALUES ($1)
        `, [enabled]);
      }
    } finally {
      client.release();
    }
  }

  // ═══════════════════ GENERIC ALLOW LIST METHODS ═══════════════════

  /**
   * Add to an allow list table
   * @param {string} tableName 
   * @param {string} contactName 
   */
  async addToAllowList(tableName: string, contactName: string) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO ${tableName} (contact_name)
        VALUES ($1)
        ON CONFLICT (contact_name) DO NOTHING
      `, [contactName]);
    } finally {
      client.release();
    }
  }

  /**
   * Remove from an allow list table
   * @param {string} tableName 
   * @param {string} contactName 
   */
  async removeFromAllowList(tableName: string, contactName: string) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        DELETE FROM ${tableName}
        WHERE contact_name = $1
      `, [contactName]);
    } finally {
      client.release();
    }
  }

  /**
   * Get all entries from an allow list table
   * @param {string} tableName 
   * @returns {Promise<Array>}
   */
  async getAllowList(tableName: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT contact_name FROM ${tableName}`);
      return result.rows.map((row: { contact_name: string }) => row.contact_name);
    } finally {
      client.release();
    }
  }

  /**
   * Check if contact is in an allow list table
   * @param {string} tableName 
   * @param {string} contactName 
   * @returns {Promise<boolean>}
   */
  async isInAllowList(tableName: string, contactName: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 1 FROM ${tableName}
        WHERE contact_name = $1
      `, [contactName]);
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Clear an allow list table
   * @param {string} tableName 
   */
  async clearAllowList(tableName: string) {
    const client = await this.pool.connect();
    try {
      await client.query(`DELETE FROM ${tableName}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get database stats (row counts)
   * @returns {Promise<Object>}
   */
  async getStats(): Promise<Record<string, number | string>> {
    const client = await this.pool.connect();
    try {
      const tables = [
        'voice_allow_list', 
        'media_allow_list', 
        'group_creation_allow_list',
        'contacts',
        'agent_context',
        'conversation_summaries',
        'message_types',
        'last_commands'
      ];
      
      const stats: Record<string, number | string> = {};
      
      for (const table of tables) {
        try {
          const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
          stats[table] = parseInt(result.rows[0].count);
        } catch (err) {
          stats[table] = 'error';
        }
      }
      
      return stats;
    } finally {
      client.release();
    }
  }
}

export default AllowListsRepository;
