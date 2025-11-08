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
      
      // Start periodic cleanup task (monthly)
      this.startPeriodicCleanup();
      
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

      // Create group_creation_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS group_creation_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create last_commands table for retry functionality
      await client.query(`
        CREATE TABLE IF NOT EXISTS last_commands (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL UNIQUE,
          tool VARCHAR(100) NOT NULL,
          args JSONB,
          normalized JSONB,
          image_url TEXT,
          video_url TEXT,
          audio_url TEXT,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create tasks table for async task tracking (API routes)
      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id SERIAL PRIMARY KEY,
          task_id VARCHAR(255) NOT NULL UNIQUE,
          status VARCHAR(50) NOT NULL,
          result JSONB,
          error TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

      // Create agent_context table for persistent agent memory
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_context (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL UNIQUE,
          tool_calls JSONB DEFAULT '[]'::jsonb,
          generated_assets JSONB DEFAULT '{"images":[],"videos":[],"audio":[]}'::jsonb,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create conversation_summaries table for long-term memory
      await client.query(`
        CREATE TABLE IF NOT EXISTS conversation_summaries (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          summary TEXT NOT NULL,
          key_topics JSONB DEFAULT '[]'::jsonb,
          user_preferences JSONB DEFAULT '{}'::jsonb,
          message_count INTEGER DEFAULT 0,
          summary_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_context_chat_id
        ON agent_context(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_context_last_updated
        ON agent_context(last_updated DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversation_summaries_chat_id
        ON conversation_summaries(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversation_summaries_date
        ON conversation_summaries(summary_date DESC)
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
   * Check if contact is in voice allow list (simple name check)
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
   * Check if user is authorized for voice transcription
   * Similar to media/group authorization - checks both group and individual sender
   * @param {Object} senderData - WhatsApp sender data from Green API
   * @returns {Promise<boolean>} - True if authorized
   */
  async isAuthorizedForVoiceTranscription(senderData) {
    try {
      const allowList = await this.getVoiceAllowList();
      
      if (allowList.length === 0) {
        return false;
      }

      const isGroupChat = senderData.chatId && senderData.chatId.endsWith('@g.us');
      const isPrivateChat = senderData.chatId && senderData.chatId.endsWith('@c.us');
      
      if (isGroupChat) {
        // Group chat - check both the group AND the individual sender
        const groupName = senderData.chatName || '';
        const senderContact = senderData.senderContactName || senderData.senderName || '';
        
        // Allow if EITHER the group is authorized OR the individual sender is authorized
        const groupAuthorized = groupName && allowList.includes(groupName);
        const senderAuthorized = senderContact && allowList.includes(senderContact);
        
        if (groupAuthorized || senderAuthorized) {
          return true;
        }
        return false;
        
      } else if (isPrivateChat) {
        // Private chat - priority: senderContactName → chatName → senderName
        let contactName = "";
        if (senderData.senderContactName && senderData.senderContactName.trim()) {
          contactName = senderData.senderContactName;
        } else if (senderData.chatName && senderData.chatName.trim()) {
          contactName = senderData.chatName;
        } else {
          contactName = senderData.senderName;
        }
        
        return allowList.includes(contactName);
      } else {
        // Fallback
        const contactName = senderData.senderContactName || senderData.chatName || senderData.senderName;
        return allowList.includes(contactName);
      }
    } catch (error) {
      console.error('❌ Error checking voice transcription authorization:', error);
      return false;
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
   * Add contact to group creation allow list
   */
  async addToGroupCreationAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO group_creation_allow_list (contact_name) 
        VALUES ($1) 
        ON CONFLICT (contact_name) DO NOTHING
        RETURNING id
      `, [contactName]);
      
      const wasAdded = result.rows.length > 0;
      if (wasAdded) {
        console.log(`✅ Added ${contactName} to group creation allow list`);
      }
      
      return wasAdded;
    } catch (error) {
      console.error('❌ Error adding to group creation allow list:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Remove contact from group creation allow list
   */
  async removeFromGroupCreationAllowList(contactName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        DELETE FROM group_creation_allow_list 
        WHERE contact_name = $1
      `, [contactName]);
      
      const wasRemoved = result.rowCount > 0;
      if (wasRemoved) {
        console.log(`🚫 Removed ${contactName} from group creation allow list`);
      }
      
      return wasRemoved;
    } finally {
      client.release();
    }
  }

  /**
   * Get all contacts in group creation allow list
   */
  async getGroupCreationAllowList() {
    if (!this.isInitialized) {
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT contact_name FROM group_creation_allow_list 
        ORDER BY created_at ASC
      `);
      
      return result.rows.map(row => row.contact_name);
    } finally {
      client.release();
    }
  }

  /**
   * Check if contact is in group creation allow list
   */
  async isInGroupCreationAllowList(contactName) {
    if (!this.isInitialized) {
      return false;
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 1 FROM group_creation_allow_list 
        WHERE contact_name = $1
      `, [contactName]);
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error checking group creation allow list:', error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    if (!this.isInitialized) {
      return { conversations: 0, voiceAllowList: 0, mediaAllowList: 0, groupCreationAllowList: 0 };
    }

    const client = await this.pool.connect();
    
    try {
      const [conversations, voiceAllowList, mediaAllowList, groupCreationAllowList] = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM conversations'),
        client.query('SELECT COUNT(*) as count FROM voice_allow_list'),
        client.query('SELECT COUNT(*) as count FROM media_allow_list'),
        client.query('SELECT COUNT(*) as count FROM group_creation_allow_list')
      ]);

      return {
        conversations: parseInt(conversations.rows[0].count),
        voiceAllowList: parseInt(voiceAllowList.rows[0].count),
        mediaAllowList: parseInt(mediaAllowList.rows[0].count),
        groupCreationAllowList: parseInt(groupCreationAllowList.rows[0].count)
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
   * Save last command for retry functionality
   */
  async saveLastCommand(chatId, tool, args, options = {}) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save last command');
      return;
    }

    const client = await this.pool.connect();
    
    try {
      const timestamp = Date.now();
      const { normalized, imageUrl, videoUrl, audioUrl } = options;
      
      // Use UPSERT (INSERT ... ON CONFLICT) to update if chat_id exists
      await client.query(`
        INSERT INTO last_commands (chat_id, tool, args, normalized, image_url, video_url, audio_url, timestamp, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id) 
        DO UPDATE SET 
          tool = EXCLUDED.tool,
          args = EXCLUDED.args,
          normalized = EXCLUDED.normalized,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          audio_url = EXCLUDED.audio_url,
          timestamp = EXCLUDED.timestamp,
          updated_at = CURRENT_TIMESTAMP
      `, [
        chatId,
        tool,
        JSON.stringify(args),
        JSON.stringify(normalized),
        imageUrl || null,
        videoUrl || null,
        audioUrl || null,
        timestamp
      ]);
      
      console.log(`💾 Saved last command for ${chatId}: ${tool}`);
    } catch (error) {
      console.error('❌ Error saving last command:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get last command for retry functionality
   */
  async getLastCommand(chatId) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get last command');
      return null;
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT tool, args, normalized, image_url, video_url, audio_url, timestamp
        FROM last_commands
        WHERE chat_id = $1
      `, [chatId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        tool: row.tool,
        args: row.args,
        normalized: row.normalized,
        imageUrl: row.image_url,
        videoUrl: row.video_url,
        audioUrl: row.audio_url,
        timestamp: parseInt(row.timestamp)
      };
    } catch (error) {
      console.error('❌ Error getting last command:', error.message);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Save task status (for async API task tracking)
   */
  async saveTask(taskId, status, data = {}) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save task');
      return;
    }

    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO tasks (task_id, status, result, error, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (task_id) 
        DO UPDATE SET 
          status = EXCLUDED.status,
          result = EXCLUDED.result,
          error = EXCLUDED.error,
          updated_at = CURRENT_TIMESTAMP
      `, [
        taskId,
        status,
        data.result ? JSON.stringify(data.result) : null,
        data.error || null
      ]);
    } catch (error) {
      console.error('❌ Error saving task:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get task status (for async API task tracking)
   */
  async getTask(taskId) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get task');
      return null;
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT status, result, error
        FROM tasks
        WHERE task_id = $1
      `, [taskId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      const taskData = {
        status: row.status
      };
      
      if (row.result) {
        Object.assign(taskData, row.result);
      }
      
      if (row.error) {
        taskData.error = row.error;
      }
      
      return taskData;
    } catch (error) {
      console.error('❌ Error getting task:', error.message);
      return null;
    } finally {
      client.release();
    }
  }

  // ═══════════════════ AGENT CONTEXT (Persistent) ═══════════════════

  /**
   * Save agent context to database (persistent storage)
   */
  async saveAgentContext(chatId, context) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save agent context');
      return;
    }

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
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get agent context');
      return null;
    }

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
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot clear agent context');
      return;
    }

    const client = await this.pool.connect();
    
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
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot cleanup agent context');
      return 0;
    }

    const client = await this.pool.connect();
    
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

  /**
   * Clean up old conversation summaries (keep only recent N per chat)
   * @param {number} keepPerChat - Keep N most recent summaries per chat (default: 10)
   * @returns {number} - Number of rows deleted
   */
  async cleanupOldSummaries(keepPerChat = 10) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot cleanup summaries');
      return 0;
    }

    const client = await this.pool.connect();
    
    try {
      // Delete summaries that are not in the top N for each chat_id
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

      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        console.log(`🧹 [Summary Cleanup] Deleted ${deletedCount} old summaries (kept ${keepPerChat} per chat)`);
      } else {
        console.log(`✅ [Summary Cleanup] No old summaries to delete`);
      }

      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old summaries:', error.message);
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Run full cleanup (agent context + summaries)
   * @returns {Object} - Cleanup stats
   */
  async runFullCleanup() {
    console.log('🧹 Starting full cleanup...');
    
    const contextDeleted = await this.cleanupOldAgentContext(30);  // 30 days
    const summariesDeleted = await this.cleanupOldSummaries(10);   // Keep 10 per chat
    
    const stats = {
      contextDeleted,
      summariesDeleted,
      totalDeleted: contextDeleted + summariesDeleted,
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ Full cleanup completed:`, stats);
    return stats;
  }

  // ═══════════════════ LONG-TERM MEMORY ═══════════════════

  /**
   * Save conversation summary for long-term memory
   */
  async saveConversationSummary(chatId, summary, keyTopics = [], userPreferences = {}, messageCount = 0) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save summary');
      return;
    }

    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO conversation_summaries 
        (chat_id, summary, key_topics, user_preferences, message_count, summary_date)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [
        chatId,
        summary,
        JSON.stringify(keyTopics),
        JSON.stringify(userPreferences),
        messageCount
      ]);

      console.log(`📝 [Long-term Memory] Saved summary for chat ${chatId}`);
    } catch (error) {
      console.error('❌ Error saving conversation summary:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get recent conversation summaries for a chat
   */
  async getConversationSummaries(chatId, limit = 5) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get summaries');
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT summary, key_topics, user_preferences, message_count, summary_date
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT $2
      `, [chatId, limit]);
      
      return result.rows.map(row => ({
        summary: row.summary,
        keyTopics: row.key_topics || [],
        userPreferences: row.user_preferences || {},
        messageCount: row.message_count,
        summaryDate: row.summary_date
      }));
    } catch (error) {
      console.error('❌ Error getting conversation summaries:', error.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get aggregated user preferences from all summaries
   */
  async getUserPreferences(chatId) {
    if (!this.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get user preferences');
      return {};
    }

    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT user_preferences
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT 10
      `, [chatId]);
      
      // Merge all preferences (most recent takes precedence)
      const merged = {};
      for (const row of result.rows.reverse()) {
        Object.assign(merged, row.user_preferences || {});
      }
      
      return merged;
    } catch (error) {
      console.error('❌ Error getting user preferences:', error.message);
      return {};
    } finally {
      client.release();
    }
  }

  /**
   * Start periodic cleanup task (runs monthly)
   */
  startPeriodicCleanup() {
    // Run cleanup once per month (30 days)
    const CLEANUP_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days in milliseconds
    
    // Run first cleanup after 1 hour (to not impact startup)
    setTimeout(async () => {
      console.log('🧹 Running first scheduled cleanup...');
      await this.runFullCleanup();
      
      // Then schedule monthly cleanups
      setInterval(async () => {
        console.log('🧹 Running monthly scheduled cleanup...');
        await this.runFullCleanup();
      }, CLEANUP_INTERVAL_MS);
      
    }, 60 * 60 * 1000);  // 1 hour delay
    
    console.log('✅ Periodic cleanup scheduled (monthly)');
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
