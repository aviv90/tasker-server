/**
 * Command Detector
 * 
 * Detects and parses management commands from outgoing messages.
 * Extracted from outgoingHandler.js for better modularity (DRY, SRP).
 */

import { isCommand } from '../../utils/commandUtils';

interface SenderData {
  chatId: string;
  chatName: string;
  senderName: string;
  senderContactName: string;
}

/**
 * Resolve current contact name based on chat type and sender data
 * @param {Object} params - Contact resolution parameters
 * @param {string} params.chatId - Chat ID
 * @param {string} params.chatName - Chat name
 * @param {string} params.senderName - Sender name
 * @param {string} params.senderContactName - Sender contact name
 * @returns {string} - Resolved contact name
 */
export function resolveCurrentContact({ chatId, chatName, senderName, senderContactName }: SenderData): string {
  const isGroupChat = chatId && chatId.endsWith('@g.us');
  const isPrivateChat = chatId && chatId.endsWith('@c.us');

  if (isGroupChat) {
    return chatName || senderName;
  } else if (isPrivateChat) {
    if (senderContactName && senderContactName.trim()) {
      return senderContactName;
    } else if (chatName && chatName.trim()) {
      return chatName;
    } else {
      return senderName;
    }
  } else {
    return senderContactName || chatName || senderName;
  }
}

/**
 * Detect management command from message text
 * @param {string} messageText - Message text to analyze
 * @param {Object} senderData - Sender data for contact resolution
 * @returns {Object|null} - Management command object or null if not a command
 */
export function detectManagementCommand(messageText: string, senderData: SenderData) {
  if (!messageText || !messageText.trim() || isCommand(messageText)) {
    return null; // Not a management command (has # prefix or empty)
  }

  const trimmed = messageText.trim();
  const { chatId, chatName, senderName, senderContactName } = senderData;

  const resolveContact = () => resolveCurrentContact({ chatId, chatName, senderName, senderContactName });

  // 1. הוסף ליצירה [שם אופציונלי]
  if (trimmed === 'הוסף ליצירה') {
    return {
      type: 'add_media_authorization',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הוסף ליצירה ')) {
    const contactName = trimmed.substring('הוסף ליצירה '.length).trim();
    if (contactName) {
      return {
        type: 'add_media_authorization',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 2. הסר מיצירה [שם אופציונלי]
  else if (trimmed === 'הסר מיצירה') {
    return {
      type: 'remove_media_authorization',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הסר מיצירה ')) {
    const contactName = trimmed.substring('הסר מיצירה '.length).trim();
    if (contactName) {
      return {
        type: 'remove_media_authorization',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 3. סטטוס יצירה
  else if (trimmed === 'סטטוס יצירה') {
    return { type: 'media_creation_status' };
  }
  // 4. הוסף לתמלול [שם אופציונלי]
  else if (trimmed === 'הוסף לתמלול') {
    return {
      type: 'include_in_transcription',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הוסף לתמלול ')) {
    const contactName = trimmed.substring('הוסף לתמלול '.length).trim();
    if (contactName) {
      return {
        type: 'include_in_transcription',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 5. הסר מתמלול [שם אופציונלי]
  else if (trimmed === 'הסר מתמלול') {
    return {
      type: 'exclude_from_transcription',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הסר מתמלול ')) {
    const contactName = trimmed.substring('הסר מתמלול '.length).trim();
    if (contactName) {
      return {
        type: 'exclude_from_transcription',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 6. סטטוס תמלול
  else if (trimmed === 'סטטוס תמלול') {
    return { type: 'voice_transcription_status' };
  }
  // 7. הוסף לקבוצות [שם אופציונלי]
  else if (trimmed === 'הוסף לקבוצות') {
    return {
      type: 'add_group_authorization',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הוסף לקבוצות ')) {
    const contactName = trimmed.substring('הוסף לקבוצות '.length).trim();
    if (contactName) {
      return {
        type: 'add_group_authorization',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 8. הסר מקבוצות [שם אופציונלי]
  else if (trimmed === 'הסר מקבוצות') {
    return {
      type: 'remove_group_authorization',
      contactName: resolveContact(),
      isCurrentContact: true
    };
  } else if (trimmed.startsWith('הסר מקבוצות ')) {
    const contactName = trimmed.substring('הסר מקבוצות '.length).trim();
    if (contactName) {
      return {
        type: 'remove_group_authorization',
        contactName: contactName,
        isCurrentContact: false
      };
    }
  }
  // 9. סטטוס קבוצות
  else if (trimmed === 'סטטוס קבוצות') {
    return { type: 'group_creation_status' };
  }
  // 10. עדכן אנשי קשר
  else if (trimmed === 'עדכן אנשי קשר') {
    return { type: 'sync_contacts' };
  }
  // 11. נקה היסטוריה
  else if (trimmed === 'נקה היסטוריה') {
    return { type: 'clear_all_conversations' };
  }

  return null; // No command detected
}
