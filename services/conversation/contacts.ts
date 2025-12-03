/**
 * Contacts management
 */

import { CacheKeys, CacheTTL, get, set, del } from '../../utils/cache';
import logger from '../../utils/logger';
import { contactSchema } from '../../schemas/contact.schema';
import ContactsRepository from '../../repositories/contactsRepository';

/**
 * Contact structure from Green API
 */
export interface GreenApiContact {
  id?: string;
  chatId?: string;
  name?: string;
  contactName?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  [key: string]: unknown;
}

class ContactsManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;
  private repository: ContactsRepository | null;

  constructor(conversationManager: ConversationManager, repository: ContactsRepository | null) {
    this._conversationManager = conversationManager;
    this.repository = repository;
  }

  /**
   * Sync contacts from Green API to database
   * Updates or inserts contacts based on contact_id
   */
  async syncContacts(contactsArray: GreenApiContact[]): Promise<{ total: number }> {
    if (!this.repository) {
      throw new Error('Repository not initialized');
    }

    try {
      let processed = 0;

      const contactsToUpsert = contactsArray
        .map(contact => {
          const contactId = contact.id || contact.chatId;
          if (!contactId) return null;

          // Normalize contact object for repository
          const rawContactData = {
            id: contactId,
            name: contact.name,
            contactName: contact.contactName,
            type: contact.type,
            chatId: contact.id,
            ...contact
          };

          try {
            // Validate with Zod
            const validatedContact = contactSchema.parse(rawContactData);

            // Convert to Contact type expected by repository (convert null to undefined)
            return {
              id: validatedContact.id,
              name: validatedContact.name ?? undefined,
              contactName: validatedContact.contactName ?? undefined,
              type: validatedContact.type ?? undefined,
              chatId: validatedContact.chatId ?? undefined
            };
          } catch (e) {
            logger.warn(`⚠️ Invalid contact data for ID ${contactId}, skipping`, { error: e });
            return null;
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (contactsToUpsert.length > 0) {
        await this.repository.upsertBatch(contactsToUpsert);
        processed = contactsToUpsert.length;
      }

      logger.info(`📇 Contacts synced: ${processed} processed`);

      // Invalidate contacts cache after sync
      del(CacheKeys.allContacts());

      return { total: processed };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error syncing contacts:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }

  /**
   * Get all contacts from database (with caching)
   */
  async getAllContacts(): Promise<unknown[]> {
    if (!this.repository) {
      return [];
    }

    // Try cache first
    const cacheKey = CacheKeys.allContacts();
    const cached = get<unknown[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const contacts = await this.repository.findAll();

      // Cache for 5 minutes (contacts don't change frequently)
      set(cacheKey, contacts, CacheTTL.MEDIUM);

      return contacts;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting all contacts:', { error: errorMessage });
      return [];
    }
  }

  /**
   * Get contacts by type (user, group, etc.)
   */
  async getContactsByType(type: string): Promise<unknown[]> {
    if (!this.repository) {
      return [];
    }

    try {
      return await this.repository.findByType(type);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting contacts by type:', { error: errorMessage });
      return [];
    }
  }
}

export default ContactsManager;

