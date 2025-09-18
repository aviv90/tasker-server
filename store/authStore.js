/**
 * Authorization Store - Manages user permissions for multimedia content creation
 * 
 * Uses SQLite database through conversationManager for persistent storage
 * Maintains exact compatibility with voice transcription authorization system
 */

const conversationManager = require('../services/conversationManager');

class AuthStore {
  constructor() {
    console.log('🔐 AuthStore initialized with database backend');
  }

  /**
   * Check if user is authorized for media creation
   * Uses the exact same logic as voice transcription authorization
   * @param {Object} senderData - WhatsApp sender data from Green API
   * @returns {Promise<boolean>} - True if user is authorized
   */
  async isAuthorizedForMediaCreation(senderData) {
    try {
      // Get the allow list from database
      const allowList = await conversationManager.getMediaAllowList();
      
      // If no restrictions are set, allow all users
      if (allowList.length === 0) {
        return true;
      }

      // Use the EXACT same identifier logic as voice transcription
      // contactName = senderContactName || senderName
      const contactName = senderData.senderContactName || senderData.senderName;
      console.log(`🔍 Checking media creation authorization for: "${contactName}" (senderContactName: "${senderData.senderContactName}", senderName: "${senderData.senderName}")`);
      
      if (contactName && allowList.includes(contactName)) {
        console.log(`✅ Media creation allowed for ${contactName} - user is in allow list`);
        return true;
      } else {
        console.log(`🚫 Media creation not allowed for ${contactName} (not in allow list)`);
      }

      return false;
    } catch (error) {
      console.error('❌ Error checking media authorization:', error);
      // On error, default to allowing (fail-open for better UX)
      return true;
    }
  }

  /**
   * Add user to media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {Promise<boolean>} - True if user was added (false if already existed)
   */
  async addAuthorizedUser(identifier) {
    try {
      const cleanId = identifier.trim();
      if (!cleanId) return false;
      
      return await conversationManager.addToMediaAllowList(cleanId);
    } catch (error) {
      console.error('❌ Error adding authorized user:', error);
      return false;
    }
  }

  /**
   * Remove user from media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {Promise<boolean>} - True if user was removed (false if didn't exist)
   */
  async removeAuthorizedUser(identifier) {
    try {
      const cleanId = identifier.trim();
      if (!cleanId) return false;
      
      return await conversationManager.removeFromMediaAllowList(cleanId);
    } catch (error) {
      console.error('❌ Error removing authorized user:', error);
      return false;
    }
  }

  /**
   * Get list of all authorized users for media creation
   * @returns {Promise<Array<string>>} - Array of authorized user identifiers
   */
  async getAuthorizedUsers() {
    try {
      return await conversationManager.getMediaAllowList();
    } catch (error) {
      console.error('❌ Error getting authorized users:', error);
      return [];
    }
  }

  /**
   * Get authorization status summary
   * @returns {Promise<Object>} - Status information
   */
  async getStatus() {
    try {
      const authorizedUsers = await this.getAuthorizedUsers();
      return {
        mediaCreationUsers: authorizedUsers.length,
        openToAll: authorizedUsers.length === 0,
        authorizedUsers: authorizedUsers
      };
    } catch (error) {
      console.error('❌ Error getting authorization status:', error);
      return {
        mediaCreationUsers: 0,
        openToAll: true,
        authorizedUsers: []
      };
    }
  }
}

// Create and export singleton instance
const authStore = new AuthStore();

module.exports = authStore;
