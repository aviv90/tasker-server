/**
 * Contacts management
 */
const { CacheKeys, CacheTTL } = require('../../utils/cache');
const cache = require('../../utils/cache');
const logger = require('../../utils/logger');
const ContactsRepository = require('../../repositories/contactsRepository');
const { contactSchema } = require('../../schemas/contact.schema');

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
      let processed = 0;

      for (const contact of contactsArray) {
        const contactId = contact.id || contact.chatId;
        if (!contactId) continue;

        // Normalize contact object for repository
        const rawContactData = {
          id: contactId,
          name: contact.name,
          contactName: contact.contactName,
          type: contact.type,
          chatId: contact.id,
          ...contact
        };

        // Validate with Zod
        const validatedContact = contactSchema.parse(rawContactData);

        await this._getRepository().upsert(validatedContact);
        processed++;
      }

      logger.info(`📇 Contacts synced: ${processed} processed`);
      
      // Invalidate contacts cache after sync
      cache.del(CacheKeys.allContacts());
      
      return { total: processed };
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
