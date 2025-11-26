/**
 * Authorization Store - Manages user permissions for multimedia content creation
 * 
 * Uses PostgreSQL database through conversationManager for persistent storage
 * Maintains exact compatibility with voice transcription authorization system
 */

import conversationManager from '../services/conversationManager';
import logger from '../utils/logger';

interface SenderData {
    chatId?: string;
    chatName?: string;
    senderName?: string;
    senderContactName?: string;
}

class AuthStore {
  constructor() {
    logger.info('🔐 AuthStore initialized with database backend');
  }

  /**
   * Check if user is authorized for media creation
   * Uses the exact same logic as voice transcription authorization
   * @param {Object} senderData - WhatsApp sender data from Green API
   * @returns {Promise<boolean>} - True if user is authorized
   */
  async isAuthorizedForMediaCreation(senderData: SenderData): Promise<boolean> {
    try {
      // Get the allow list from database
      const allowList = await conversationManager.getMediaAllowList();
      
      // If no users in allow list, deny access (closed by default like transcription)
      if (allowList.length === 0) {
        logger.debug(`🚫 Media creation denied - no users in allow list (closed by default)`);
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
        
        logger.debug(`🔍 Checking media creation authorization in group "${groupName}" for sender "${senderContact}"`);
        
        // Allow if EITHER the group is authorized OR the individual sender is authorized
        const groupAuthorized = groupName && allowList.includes(groupName);
        const senderAuthorized = senderContact && allowList.includes(senderContact);
        
        if (groupAuthorized) {
          logger.debug(`✅ Media creation allowed - group "${groupName}" is in allow list`);
          return true;
        }
        
        if (senderAuthorized) {
          logger.debug(`✅ Media creation allowed - sender "${senderContact}" is in allow list (in group "${groupName}")`);
          return true;
        }
        
        logger.debug(`🚫 Media creation denied - neither group "${groupName}" nor sender "${senderContact}" are in allow list`);
        return false;
        
      } else if (isPrivateChat) {
        // Private chat - priority: senderContactName → chatName → senderName
        let contactName = "";
        if (senderData.senderContactName && senderData.senderContactName.trim()) {
          contactName = senderData.senderContactName;
        } else if (senderData.chatName && senderData.chatName.trim()) {
          contactName = senderData.chatName;
        } else {
          contactName = senderData.senderName || '';
        }
        
        logger.debug(`🔍 Checking media creation authorization for: "${contactName}" (private chat)`);
        
        if (contactName && allowList.includes(contactName)) {
          logger.debug(`✅ Media creation allowed for ${contactName} - user is in allow list`);
          return true;
        } else {
          logger.debug(`🚫 Media creation not allowed for ${contactName} (not in allow list)`);
          return false;
        }
      } else {
        // Fallback for unknown chat types
        const contactName = senderData.senderContactName || senderData.chatName || senderData.senderName;
        logger.debug(`🔍 Checking media creation authorization for: "${contactName}" (unknown chat type)`);
        
        if (contactName && allowList.includes(contactName)) {
          logger.debug(`✅ Media creation allowed for ${contactName}`);
          return true;
        }
        return false;
      }
    } catch (error) {
      logger.error('❌ Error checking media authorization:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      // On error, default to denying (fail-closed for security, like transcription)
      return false;
    }
  }

  /**
   * Add user to media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {Promise<boolean>} - True if user was added (false if already existed)
   */
  async addAuthorizedUser(identifier: string): Promise<boolean> {
    try {
      const cleanId = identifier.trim();
      if (!cleanId) return false;
      
      return await conversationManager.addToMediaAllowList(cleanId);
    } catch (error) {
      logger.error('❌ Error adding authorized user:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      return false;
    }
  }

  /**
   * Remove user from media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {Promise<boolean>} - True if user was removed (false if didn't exist)
   */
  async removeAuthorizedUser(identifier: string): Promise<boolean> {
    try {
      const cleanId = identifier.trim();
      if (!cleanId) return false;
      
      return await conversationManager.removeFromMediaAllowList(cleanId);
    } catch (error) {
      logger.error('❌ Error removing authorized user:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      return false;
    }
  }

  /**
   * Get list of all authorized users for media creation
   * @returns {Promise<Array<string>>} - Array of authorized user identifiers
   */
  async getAuthorizedUsers(): Promise<string[]> {
    try {
      return await conversationManager.getMediaAllowList();
    } catch (error) {
      logger.error('❌ Error getting authorized users:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
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
        openToAll: false, // Always closed by default, never open to all
        closedByDefault: authorizedUsers.length === 0,
        authorizedUsers: authorizedUsers
      };
    } catch (error) {
      logger.error('❌ Error getting authorization status:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      return {
        mediaCreationUsers: 0,
        openToAll: false,
        closedByDefault: true,
        authorizedUsers: []
      };
    }
  }
}

// Create and export singleton instance
const authStore = new AuthStore();

export default authStore;
