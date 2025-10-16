/**
 * Group Creation Authorization Store
 * 
 * Manages user permissions for group creation
 * Uses PostgreSQL database through conversationManager for persistent storage
 * Follows the same pattern as media authorization
 */

const conversationManager = require('../services/conversationManager');

class GroupAuthStore {
  constructor() {
    console.log('👥 GroupAuthStore initialized with database backend');
  }

  /**
   * Check if user is authorized for group creation
   * Uses the same logic as media creation authorization
   * @param {Object} senderData - WhatsApp sender data from Green API
   * @returns {Promise<boolean>} - True if user is authorized
   */
  async isAuthorizedForGroupCreation(senderData) {
    try {
      // Get the allow list from database
      const allowList = await conversationManager.getGroupCreationAllowList();
      
      // If no users in allow list, deny access (closed by default)
      if (allowList.length === 0) {
        console.log(`🚫 Group creation denied - no users in allow list (closed by default)`);
        return false;
      }

      // Priority logic based on chat type:
      // Group chat (@g.us): check BOTH group name AND sender's contact name
      // Private chat (@c.us): check senderContactName first, then chatName, then senderName as fallback
      const isGroupChat = senderData.chatId && senderData.chatId.endsWith('@g.us');
      const isPrivateChat = senderData.chatId && senderData.chatId.endsWith('@c.us');
      
      if (isGroupChat) {
        // Group chat - check both the group AND the individual sender
        const groupName = senderData.chatName || '';
        const senderContact = senderData.senderContactName || senderData.senderName || '';
        
        console.log(`🔍 Checking group creation authorization in group "${groupName}" for sender "${senderContact}"`);
        
        // Allow if EITHER the group is authorized OR the individual sender is authorized
        const groupAuthorized = groupName && allowList.includes(groupName);
        const senderAuthorized = senderContact && allowList.includes(senderContact);
        
        if (groupAuthorized) {
          console.log(`✅ Group creation allowed - group "${groupName}" is in allow list`);
          return true;
        }
        
        if (senderAuthorized) {
          console.log(`✅ Group creation allowed - sender "${senderContact}" is in allow list (in group "${groupName}")`);
          return true;
        }
        
        console.log(`🚫 Group creation denied - neither group "${groupName}" nor sender "${senderContact}" are in allow list`);
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
        
        console.log(`🔍 Checking group creation authorization for: "${contactName}" (private chat)`);
        
        if (contactName && allowList.includes(contactName)) {
          console.log(`✅ Group creation authorized for: ${contactName}`);
          return true;
        } else {
          console.log(`🚫 Group creation denied for: ${contactName} (not in allow list)`);
          return false;
        }
      } else {
        // Fallback for unknown chat types
        const contactName = senderData.senderContactName || senderData.chatName || senderData.senderName;
        console.log(`🔍 Checking group creation authorization for: "${contactName}" (unknown chat type)`);
        
        if (contactName && allowList.includes(contactName)) {
          console.log(`✅ Group creation authorized for: ${contactName}`);
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error('❌ Error checking group creation authorization:', error);
      // Default to deny on error
      return false;
    }
  }

  /**
   * Add user to authorized list
   * @param {string} contactName - Contact name to authorize
   * @returns {Promise<boolean>} - True if user was added, false if already existed
   */
  async addAuthorizedUser(contactName) {
    try {
      return await conversationManager.addToGroupCreationAllowList(contactName);
    } catch (error) {
      console.error('❌ Error adding authorized user:', error);
      throw error;
    }
  }

  /**
   * Remove user from authorized list
   * @param {string} contactName - Contact name to remove
   * @returns {Promise<boolean>} - True if user was removed, false if didn't exist
   */
  async removeAuthorizedUser(contactName) {
    try {
      return await conversationManager.removeFromGroupCreationAllowList(contactName);
    } catch (error) {
      console.error('❌ Error removing authorized user:', error);
      throw error;
    }
  }

  /**
   * Get list of all authorized users
   * @returns {Promise<Array<string>>} - List of authorized contact names
   */
  async getAuthorizedUsers() {
    try {
      return await conversationManager.getGroupCreationAllowList();
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
        groupCreationUsers: authorizedUsers.length,
        openToAll: false, // Always closed by default
        closedByDefault: authorizedUsers.length === 0,
        authorizedUsers: authorizedUsers
      };
    } catch (error) {
      console.error('❌ Error getting authorization status:', error);
      return {
        groupCreationUsers: 0,
        openToAll: false,
        closedByDefault: true,
        authorizedUsers: []
      };
    }
  }
}

// Create and export singleton instance
const groupAuthStore = new GroupAuthStore();

module.exports = groupAuthStore;

