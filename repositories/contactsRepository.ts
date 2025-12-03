/**
 * Contacts Repository
 * Handles direct database interactions for contacts and groups storage.
 */

import { Pool } from 'pg';

export interface Contact {
  id: string;
  name?: string;
  contactName?: string;
  type?: string;
  chatId?: string;
  [key: string]: unknown;
}

class ContactsRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Upsert a contact
   */
  async upsert(contact: Contact): Promise<void> {
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
   * Batch upsert contacts
   */
  async upsertBatch(contacts: Contact[]): Promise<void> {
    if (contacts.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Use UNNEST for efficient bulk upsert
      // We pass arrays of values
      const ids = contacts.map(c => c.id);
      const names = contacts.map(c => c.name || '');
      const contactNames = contacts.map(c => c.contactName || '');
      const types = contacts.map(c => c.type || 'user');
      const chatIds = contacts.map(c => c.chatId || '');
      const rawData = contacts.map(c => JSON.stringify(c));

      await client.query(`
        INSERT INTO contacts (contact_id, name, contact_name, type, chat_id, raw_data, updated_at)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[])
        ON CONFLICT (contact_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          contact_name = EXCLUDED.contact_name,
          type = EXCLUDED.type,
          chat_id = EXCLUDED.chat_id,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
      `, [ids, names, contactNames, types, chatIds, rawData]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts
   */
  async findAll(): Promise<Contact[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT raw_data 
        FROM contacts 
        ORDER BY name ASC
      `);
      return result.rows.map((row) => row.raw_data as Contact);
    } finally {
      client.release();
    }
  }

  /**
   * Get contacts by type (user/group)
   */
  async findByType(type: string): Promise<Contact[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT raw_data 
        FROM contacts 
        WHERE type = $1
        ORDER BY name ASC
      `, [type]);
      return result.rows.map((row) => row.raw_data as Contact);
    } finally {
      client.release();
    }
  }
}

export default ContactsRepository;
