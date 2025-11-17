/**
 * Allow lists and authorization management
 */
class AllowListsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Set voice transcription status
   */
  async setVoiceTranscriptionStatus(enabled) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      return { conversations: 0, voiceAllowList: 0, mediaAllowList: 0, groupCreationAllowList: 0 };
    }

    const client = await this.conversationManager.pool.connect();
    
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
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query('DELETE FROM conversations');
      console.log(`🗑️ Cleared ${result.rowCount} conversations from database`);
      return result.rowCount;
    } finally {
      client.release();
    }
  }
}

module.exports = AllowListsManager;

