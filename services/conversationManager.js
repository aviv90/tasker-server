const { Pool } = require('pg');

class ConversationManager {
  constructor() {
    this.maxMessages = 50; // Keep last 50 messages per chat
    this.pool = null;
    this.isInitialized = false;
    
    console.log('💭 ConversationManager initializing with PostgreSQL...');
    this.initializeDatabase();
  }

  /**
   * Initialize PostgreSQL database connection and create tables
   */
  async initializeDatabase(attempt = 1) {
    try {
      // Create connection pool
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 10, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 10000, // Allow up to 10s for cold starts / sleeping DBs
      });

      // Test connection
      const client = await this.pool.connect();
      console.log('✅ Connected to PostgreSQL database');
      client.release();

      // Create tables
      await this.createTables();
      
      // Initialize voice settings
      await this.initializeVoiceSettings();
      
      this.isInitialized = true;
      console.log('✅ Database initialization completed successfully');
      
    } catch (error) {
      console.error('❌ Database initialization failed:', error.message);
      // Retry with exponential backoff to avoid crashing the app on transient DB issues
      const maxAttempts = 5;
      if (attempt < maxAttempts) {
        const delayMs = Math.min(30000, 2000 * Math.pow(2, attempt - 1));
        console.warn(`⏳ Retrying DB init in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`);
        setTimeout(() => this.initializeDatabase(attempt + 1).catch(() => {}), delayMs);
      } else {
        console.error('🚫 Giving up on DB initialization after multiple attempts. Running without DB until next restart.');
      }
    }
  }

  /**
   * Create all necessary tables
   */
  async createTables() {
    const client = await this.pool.connect();
    
    try {
        // Create conversations table
      await client.query(`
          CREATE TABLE IF NOT EXISTS conversations (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
            content TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
      `);
        
      // Create voice_settings table
      await client.query(`
          CREATE TABLE IF NOT EXISTS voice_settings (
          id SERIAL PRIMARY KEY,
          enabled BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create voice_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS voice_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create media_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS media_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create contacts table for WhatsApp contacts and groups
      await client.query(`
        CREATE TABLE IF NOT EXISTS contacts (
          id SERIAL PRIMARY KEY,
          contact_id VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(500),
          contact_name VARCHAR(500),
          type VARCHAR(50),
          chat_id VARCHAR(255),
          raw_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_chat_id 
        ON conversations(chat_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_timestamp 
        ON conversations(timestamp DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_contacts_contact_id
        ON contacts(contact_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_contacts_type
        ON contacts(type)
      `);

      console.log('✅ All database tables and indexes created successfully');
      
    } finally {
      client.release();
    }
  }

  /**
   * Initialize voice settings with default values
   */
  async initializeVoiceSettings() {
    const client = await this.pool.connect();
    
    try {
      // Check if voice settings already exist
      const result = await client.query('SELECT id FROM voice_settings LIMIT 1');
      
      if (result.rows.length === 0) {
        // Insert default voice settings
        await client.query(`
          INSERT INTO voice_settings (enabled) 
          VALUES (false)
        `);
        console.log('🔊 Voice transcription initialized: disabled (default)');
      } else {
        console.log('🔊 Voice settings already exist');
      }
    } finally {
      client.release();
    }
  }

  /**
   * Add a message to user's conversation history
   */
  async addMessage(chatId, role, content) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const timestamp = Date.now();
      
      // Insert the new message
      const result = await client.query(`
        INSERT INTO conversations (chat_id, role, content, timestamp)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [chatId, role, content, timestamp]);
      
      const messageId = result.rows[0].id;
      console.log(`💬 Added ${role} message to ${chatId} (ID: ${messageId})`);
        
        // Keep only the last N messages for this chat
      await this.trimMessagesForChat(chatId);
      
      return messageId;
    } finally {
      client.release();
    }
  }

  /**
   * Trim messages to keep only the last N messages for a specific chat
   */
  async trimMessagesForChat(chatId) {
    if (!this.isInitialized) {
          return;
        }
        
    const client = await this.pool.connect();
    
    try {
      // Delete old messages, keeping only the last maxMessages
      await client.query(`
          DELETE FROM conversations 
        WHERE chat_id = $1 
          AND id NOT IN (
            SELECT id FROM conversations 
          WHERE chat_id = $1 
            ORDER BY timestamp DESC 
          LIMIT $2
        )
      `, [chatId, this.maxMessages]);
    } finally {
      client.release();
    }
  }

  /**
   * Get conversation history for a specific chat
   */
  async getConversationHistory(chatId) {
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT role, content, timestamp
        FROM conversations 
        WHERE chat_id = $1 
        ORDER BY timestamp ASC
      `, [chatId]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Set voice transcription status
   */
  async setVoiceTranscriptionStatus(enabled) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      await client.query(`
        UPDATE voice_settings 
        SET enabled = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = 1
      `, [enabled]);
      
      console.log(`💾 Voice transcription status updated: ${enabled ? 'enabled' : 'disabled'}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get voice transcription status
   */
  async getVoiceTranscriptionStatus() {
    if (!this.isInitialized) {
      return false;
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT enabled FROM voice_settings WHERE id = 1
      `);
      
      return result.rows.length > 0 ? result.rows[0].enabled : false;
    } finally {
      client.release();
    }
  }

  /**
   * Add contact to voice allow list
   */
  async addToVoiceAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO voice_allow_list (contact_name) 
        VALUES ($1) 
        ON CONFLICT (contact_name) DO NOTHING
        RETURNING id
      `, [contactName]);
      
      const wasAdded = result.rows.length > 0;
      if (wasAdded) {
        console.log(`✅ Added ${contactName} to voice allow list`);
      }
      
      return wasAdded;
    } finally {
      client.release();
    }
  }

  /**
   * Remove contact from voice allow list
   */
  async removeFromVoiceAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        DELETE FROM voice_allow_list 
        WHERE contact_name = $1
      `, [contactName]);
      
      const wasRemoved = result.rowCount > 0;
        if (wasRemoved) {
          console.log(`🚫 Removed ${contactName} from voice allow list`);
      }
      
      return wasRemoved;
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts in voice allow list
   */
  async getVoiceAllowList() {
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT contact_name FROM voice_allow_list 
        ORDER BY created_at ASC
      `);
      
      return result.rows.map(row => row.contact_name);
    } finally {
      client.release();
    }
  }

  /**
   * Check if contact is in voice allow list
   */
  async isInVoiceAllowList(contactName) {
    if (!this.isInitialized) {
      return false;
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 1 FROM voice_allow_list 
        WHERE contact_name = $1
      `, [contactName]);
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error checking voice allow list:', error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Add contact to media allow list
   */
  async addToMediaAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO media_allow_list (contact_name) 
        VALUES ($1) 
        ON CONFLICT (contact_name) DO NOTHING
        RETURNING id
      `, [contactName]);
      
      const wasAdded = result.rows.length > 0;
      if (wasAdded) {
        console.log(`✅ Added ${contactName} to media allow list`);
      }
      
      return wasAdded;
    } finally {
      client.release();
    }
  }

  /**
   * Remove contact from media allow list
   */
  async removeFromMediaAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        DELETE FROM media_allow_list 
        WHERE contact_name = $1
      `, [contactName]);
      
      const wasRemoved = result.rowCount > 0;
      if (wasRemoved) {
        console.log(`🚫 Removed ${contactName} from media allow list`);
      }
      
      return wasRemoved;
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts in media allow list
   */
  async getMediaAllowList() {
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT contact_name FROM media_allow_list 
        ORDER BY created_at ASC
      `);
      
      return result.rows.map(row => row.contact_name);
    } finally {
      client.release();
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    if (!this.isInitialized) {
      return { conversations: 0, voiceAllowList: 0, mediaAllowList: 0 };
    }

    const client = await this.pool.connect();
    
    try {
      const [conversations, voiceAllowList, mediaAllowList] = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM conversations'),
        client.query('SELECT COUNT(*) as count FROM voice_allow_list'),
        client.query('SELECT COUNT(*) as count FROM media_allow_list')
      ]);

      return {
        conversations: parseInt(conversations.rows[0].count),
        voiceAllowList: parseInt(voiceAllowList.rows[0].count),
        mediaAllowList: parseInt(mediaAllowList.rows[0].count)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Clear all conversations from database
   */
  async clearAllConversations() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query('DELETE FROM conversations');
      console.log(`🗑️ Cleared ${result.rowCount} conversations from database`);
      return result.rowCount;
    } finally {
      client.release();
    }
  }

  /**
   * Sync contacts from Green API to database
   * Updates or inserts contacts based on contact_id
   */
  async syncContacts(contactsArray) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
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
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
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
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
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

  /**
   * Close database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('🔌 PostgreSQL connection pool closed');
    }
  }
}

// Create and export singleton instance
const conversationManager = new ConversationManager();
module.exports = conversationManager;
