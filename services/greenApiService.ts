/**
 * Green API WhatsApp Service
 * 
 * Handles sending messages and files via Green API.
 * Refactored to use modular components (Phase 5.3)
 */

import container from './container';

// Forwarding functions to container's messaging service
export const sendTextMessage = (chatId: string, message: string, quotedMessageId: string | null = null, typingTime: number = 0) =>
  container.getService('messaging').sendTextMessage(chatId, message, quotedMessageId, typingTime);

export const sendFileByUrl = (chatId: string, fileUrl: string, fileName: string, caption: string = '', quotedMessageId: string | null = null, typingTime: number = 0) =>
  container.getService('messaging').sendFileByUrl(chatId, fileUrl, fileName, caption, quotedMessageId, typingTime);

export const sendPoll = (chatId: string, message: string, options: string[], multipleAnswers: boolean = false, quotedMessageId: string | null = null, typingTime: number = 0) =>
  container.getService('messaging').sendPoll(chatId, message, options, multipleAnswers, quotedMessageId, typingTime);

export const sendLocation = (chatId: string, latitude: number, longitude: number, nameLocation: string = '', address: string = '', quotedMessageId: string | null = null, typingTime: number = 0) =>
  container.getService('messaging').sendLocation(chatId, latitude, longitude, nameLocation, address, quotedMessageId, typingTime);

// Re-export specific items from other modules
import { downloadFile, resolveLocalStaticPath } from './greenApi/fileHandling';
import { getChatHistory, getContacts, getMessage } from './greenApi/chat';
import { createGroup, setGroupPicture, getGroupInviteLink } from './greenApi/groups';

export {
  downloadFile,
  getChatHistory,
  getContacts,
  getMessage,
  createGroup,
  setGroupPicture,
  getGroupInviteLink
};

// Also export resolveLocalStaticPath for backward compatibility
export { resolveLocalStaticPath };

