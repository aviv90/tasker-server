/**
 * Allow lists and authorization management
 */

const logger = require('../../utils/logger');
const AllowListsRepository = require('../../repositories/allowListsRepository');

class AllowListsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
    this.repository = null;
  }

  _getRepository() {
    if (!this.repository && this.conversationManager.pool) {
        this.repository = new AllowListsRepository(this.conversationManager.pool);
    }
    return this.repository;
  }

  /**
   * Set voice transcription status
   */
  async setVoiceTranscriptionStatus(enabled) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().setVoiceSettings(enabled);
      logger.info(`💾 Voice transcription status updated: ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error('❌ Error setting voice transcription status:', error);
      throw error;
    }
  }

  /**
   * Get voice transcription status
   */
  async getVoiceTranscriptionStatus() {
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    try {
      return await this._getRepository().getVoiceSettings();
    } catch (error) {
      logger.error('❌ Error getting voice transcription status:', error);
      return false;
    }
  }

  /**
   * Add contact to voice allow list
   */
  async addToVoiceAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().addToAllowList('voice_allow_list', contactName);
      logger.info(`✅ Added ${contactName} to voice allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error adding to voice allow list:', error);
      return false;
    }
  }

  /**
   * Remove contact from voice allow list
   */
  async removeFromVoiceAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().removeFromAllowList('voice_allow_list', contactName);
      logger.info(`🚫 Removed ${contactName} from voice allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error removing from voice allow list:', error);
      return false;
    }
  }

  /**
   * Get all contacts in voice allow list
   */
  async getVoiceAllowList() {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    try {
      return await this._getRepository().getAllowList('voice_allow_list');
    } catch (error) {
      logger.error('❌ Error getting voice allow list:', error);
      return [];
    }
  }

  /**
   * Check if contact is in voice allow list (simple name check)
   */
  async isInVoiceAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    try {
      return await this._getRepository().isInAllowList('voice_allow_list', contactName);
    } catch (error) {
      logger.error('❌ Error checking voice allow list:', error);
      return false;
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
        
        return groupAuthorized || senderAuthorized;
        
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
      logger.error('❌ Error checking voice transcription authorization:', error);
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

    try {
      await this._getRepository().addToAllowList('media_allow_list', contactName);
      logger.info(`✅ Added ${contactName} to media allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error adding to media allow list:', error);
      return false;
    }
  }

  /**
   * Remove contact from media allow list
   */
  async removeFromMediaAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().removeFromAllowList('media_allow_list', contactName);
      logger.info(`🚫 Removed ${contactName} from media allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error removing from media allow list:', error);
      return false;
    }
  }

  /**
   * Get all contacts in media allow list
   */
  async getMediaAllowList() {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    try {
      return await this._getRepository().getAllowList('media_allow_list');
    } catch (error) {
      logger.error('❌ Error getting media allow list:', error);
      return [];
    }
  }

  /**
   * Add contact to group creation allow list
   */
  async addToGroupCreationAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().addToAllowList('group_creation_allow_list', contactName);
      logger.info(`✅ Added ${contactName} to group creation allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error adding to group creation allow list:', error);
      throw error;
    }
  }

  /**
   * Remove contact from group creation allow list
   */
  async removeFromGroupCreationAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      await this._getRepository().removeFromAllowList('group_creation_allow_list', contactName);
      logger.info(`🚫 Removed ${contactName} from group creation allow list`);
      return true;
    } catch (error) {
      logger.error('❌ Error removing from group creation allow list:', error);
      return false;
    }
  }

  /**
   * Get all contacts in group creation allow list
   */
  async getGroupCreationAllowList() {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    try {
      return await this._getRepository().getAllowList('group_creation_allow_list');
    } catch (error) {
      logger.error('❌ Error getting group creation allow list:', error);
      return [];
    }
  }

  /**
   * Check if contact is in group creation allow list
   */
  async isInGroupCreationAllowList(contactName) {
    if (!this.conversationManager.isInitialized) {
      return false;
    }

    try {
      return await this._getRepository().isInAllowList('group_creation_allow_list', contactName);
    } catch (error) {
      logger.error('❌ Error checking group creation allow list:', error);
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    if (!this.conversationManager.isInitialized) {
      return { conversations: 0, voiceAllowList: 0, mediaAllowList: 0, groupCreationAllowList: 0 };
    }

    try {
      return await this._getRepository().getStats();
    } catch (error) {
      logger.error('❌ Error getting database stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Clear all conversations from database
   */
  async clearAllConversations() {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      // Currently there is no conversations table usage (deprecated), but keeping for cleanup
      const client = await this.conversationManager.pool.connect();
      try {
        const result = await client.query('DELETE FROM conversations');
        logger.info(`🗑️ Cleared ${result.rowCount} conversations from database`);
        return result.rowCount;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('❌ Error clearing conversations:', error);
      throw error;
    }
  }
}

module.exports = AllowListsManager;
