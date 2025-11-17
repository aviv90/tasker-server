/**
 * Contacts management
 */
class ContactsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Sync contacts from Green API to database
   * Updates or inserts contacts based on contact_id
   */
  async syncContacts(contactsArray) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      let inserted = 0;
      let updated = 0;

      for (const contact of contactsArray) {
        const contactId = contact.id || contact.chatId;
        if (!contactId) continue;

        const result = await client.query(`
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
          RETURNING (xmax = 0) AS inserted
        `, [
          contactId,
          contact.name || null,
          contact.contactName || null,
          contact.type || null,
          contact.id || null,
          JSON.stringify(contact)
        ]);

        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }
      }

      console.log(`📇 Contacts synced: ${inserted} inserted, ${updated} updated (total: ${contactsArray.length})`);
      return { inserted, updated, total: contactsArray.length };
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts from database
   */
  async getAllContacts() {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT contact_id, name, contact_name, type, chat_id, raw_data, created_at, updated_at
        FROM contacts
        ORDER BY name ASC
      `);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get contacts by type (user, group, etc.)
   */
  async getContactsByType(type) {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT contact_id, name, contact_name, type, chat_id, raw_data, created_at, updated_at
        FROM contacts
        WHERE type = $1
        ORDER BY name ASC
      `, [type]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }
}

module.exports = ContactsManager;

