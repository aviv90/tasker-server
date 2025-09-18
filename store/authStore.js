/**
 * Authorization Store - Manages user permissions for multimedia content creation
 * 
 * Stores authorized users for different content creation features:
 * - Image generation and editing
 * - Video generation and editing
 * - Music generation
 */

class AuthStore {
  constructor() {
    // In-memory storage for authorized users
    // Key: feature type, Value: Set of authorized user identifiers
    this.authorizedUsers = {
      media_creation: new Set() // Images, videos, music generation
    };
    
    // Load initial authorized users from environment or hardcode defaults
    this.loadInitialUsers();
  }

  /**
   * Load initial authorized users from environment variables
   */
  loadInitialUsers() {
    // Load from environment variable if available
    const envUsers = process.env.AUTHORIZED_MEDIA_USERS;
    if (envUsers) {
      const users = envUsers.split(',').map(u => u.trim()).filter(u => u);
      users.forEach(user => this.authorizedUsers.media_creation.add(user));
      console.log(`🔐 Loaded ${users.length} authorized media users from environment`);
    }
    
    // Add default admin if no users found
    if (this.authorizedUsers.media_creation.size === 0) {
      // Default to allow all users initially - can be restricted later
      console.log('🔓 No authorized users configured - media creation open to all users initially');
    }
  }

  /**
   * Check if user is authorized for media creation
   * @param {Object} senderData - WhatsApp sender data from Green API
   * @returns {boolean} - True if user is authorized
   */
  isAuthorizedForMediaCreation(senderData) {
    // If no restrictions are set, allow all users
    if (this.authorizedUsers.media_creation.size === 0) {
      return true;
    }

    // Try multiple identification methods with fallbacks
    const identifiers = [
      senderData.senderContactName,  // Contact name (most user-friendly)
      senderData.senderName,         // Display name
      senderData.sender,             // Phone number ID
      senderData.chatId              // Chat ID (fallback)
    ].filter(id => id && id.trim()); // Remove empty values

    // Check if any identifier matches authorized users
    return identifiers.some(id => 
      this.authorizedUsers.media_creation.has(id) ||
      this.authorizedUsers.media_creation.has(id.toLowerCase())
    );
  }

  /**
   * Add user to media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {boolean} - True if user was added (false if already existed)
   */
  addAuthorizedUser(identifier) {
    const cleanId = identifier.trim();
    if (!cleanId) return false;
    
    const wasNew = !this.authorizedUsers.media_creation.has(cleanId);
    this.authorizedUsers.media_creation.add(cleanId);
    
    // Also add lowercase version for case-insensitive matching
    this.authorizedUsers.media_creation.add(cleanId.toLowerCase());
    
    console.log(`✅ Added user to media creation authorization: ${cleanId}`);
    return wasNew;
  }

  /**
   * Remove user from media creation authorization list
   * @param {string} identifier - User identifier (name, phone, etc.)
   * @returns {boolean} - True if user was removed (false if didn't exist)
   */
  removeAuthorizedUser(identifier) {
    const cleanId = identifier.trim();
    if (!cleanId) return false;
    
    const existed = this.authorizedUsers.media_creation.has(cleanId);
    this.authorizedUsers.media_creation.delete(cleanId);
    this.authorizedUsers.media_creation.delete(cleanId.toLowerCase());
    
    console.log(`🗑️ Removed user from media creation authorization: ${cleanId}`);
    return existed;
  }

  /**
   * Get list of all authorized users for media creation
   * @returns {Array<string>} - Array of authorized user identifiers
   */
  getAuthorizedUsers() {
    // Filter out lowercase duplicates for display
    const users = Array.from(this.authorizedUsers.media_creation);
    const unique = users.filter(user => 
      !users.some(other => other !== user && other.toLowerCase() === user)
    );
    return unique.sort();
  }

  /**
   * Get authorization status summary
   * @returns {Object} - Status information
   */
  getStatus() {
    const authorizedCount = this.getAuthorizedUsers().length;
    return {
      mediaCreationUsers: authorizedCount,
      openToAll: authorizedCount === 0,
      authorizedUsers: this.getAuthorizedUsers()
    };
  }
}

// Create and export singleton instance
const authStore = new AuthStore();

module.exports = authStore;
