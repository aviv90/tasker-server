/**
 * Green API WhatsApp Service
 * 
 * Handles sending messages and files via Green API.
 * Refactored to use modular components (Phase 5.3)
 */

import { sendTextMessage, sendFileByUrl, sendPoll, sendLocation } from './greenApi/messaging';
import { downloadFile, resolveLocalStaticPath } from './greenApi/fileHandling';
import { getChatHistory, getContacts, getMessage } from './greenApi/chat';
import { createGroup, setGroupPicture } from './greenApi/groups';

export {
  sendTextMessage,
  sendFileByUrl,
  downloadFile,
  getChatHistory,
  getContacts,
  getMessage,
  createGroup,
  setGroupPicture,
  sendPoll,
  sendLocation
};

// Also export resolveLocalStaticPath for backward compatibility
export { resolveLocalStaticPath };

