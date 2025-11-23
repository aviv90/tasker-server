/**
 * Contacts management
 */
const { CacheKeys, CacheTTL } = require('../../utils/cache');
const cache = require('../../utils/cache');
const logger = require('../../utils/logger');
const ContactsRepository = require('../../repositories/contactsRepository');

class ContactsManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
    this.repository = null;
  }

  _getRepository() {
    if (!this.repository && this.conversationManager.pool) {
        this.repository = new ContactsRepository(this.conversationManager.pool);
    }
    return this.repository;
  }

  /**
   * Sync contacts from Green API to database
   * Updates or inserts contacts based on contact_id
   */
  async syncContacts(contactsArray) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      let inserted = 0; // Tracking individual inserts/updates is harder with bulk/loop repository pattern unless repo returns status
      // For now, we'll just process them.
      
      // NOTE: ideally we would use a batch insert/upsert in the repository for performance.
      // But to keep it simple and match existing logic structure (loop), we'll use upsert per item.
      // Enhancing to batch upsert is a good future optimization.

      for (const contact of contactsArray) {
        const contactId = contact.id || contact.chatId;
        if (!contactId) continue;

        // Normalize contact object for repository
        const contactData = {
          id: contactId,
          name: contact.name,
          contactName: contact.contactName,
          type: contact.type,
          chatId: contact.id, // usually same as contactId
          ...contact
        };

        await this._getRepository().upsert(contactData);
      }

      logger.info(`📇 Contacts synced: ${contactsArray.length} processed`);
      
      // Invalidate contacts cache after sync
      cache.del(CacheKeys.allContacts());
      
      return { total: contactsArray.length };
    } catch (error) {
        logger.error('❌ Error syncing contacts:', error);
        throw error;
    }
  }

  /**
   * Get all contacts from database (with caching)
   */
  async getAllContacts() {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    // Try cache first
    const cacheKey = CacheKeys.allContacts();
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const contacts = await this._getRepository().findAll();
      
      // Cache for 5 minutes (contacts don't change frequently)
      cache.set(cacheKey, contacts, CacheTTL.MEDIUM);
      
      return contacts;
    } catch (error) {
      logger.error('❌ Error getting all contacts:', error);
      return [];
    }
  }

  /**
   * Get contacts by type (user, group, etc.)
   */
  async getContactsByType(type) {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    try {
      return await this._getRepository().findByType(type);
    } catch (error) {
      logger.error('❌ Error getting contacts by type:', error);
      return [];
    }
  }
}

module.exports = ContactsManager;
