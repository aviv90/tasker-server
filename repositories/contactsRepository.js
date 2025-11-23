/**
 * Contacts Repository
 * Handles direct database interactions for contacts and groups storage.
 */

class ContactsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Upsert a contact
   * @param {Object} contact 
   */
  async upsert(contact) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO contacts (contact_id, name, contact_name, type, chat_id, raw_data, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (contact_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          contact_name = EXCLUDED.contact_name,
          type = EXCLUDED.type,
          chat_id = EXCLUDED.chat_id,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
      `, [
        contact.id,
        contact.name || '',
        contact.contactName || '',
        contact.type || 'user',
        contact.chatId || '',
        JSON.stringify(contact)
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts
   * @returns {Promise<Array>}
   */
  async findAll() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT raw_data 
        FROM contacts 
        ORDER BY name ASC
      `);
      return result.rows.map(row => row.raw_data);
    } finally {
      client.release();
    }
  }

  /**
   * Get contacts by type (user/group)
   * @param {string} type 
   * @returns {Promise<Array>}
   */
  async findByType(type) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT raw_data 
        FROM contacts 
        WHERE type = $1
        ORDER BY name ASC
      `, [type]);
      return result.rows.map(row => row.raw_data);
    } finally {
      client.release();
    }
  }
}

module.exports = ContactsRepository;

