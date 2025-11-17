/**
 * Green API WhatsApp Service
 * 
 * Handles sending messages and files via Green API.
 * Refactored to use modular components (Phase 5.3)
 */

const { sendTextMessage, sendFileByUrl, sendPoll, sendLocation } = require('./greenApi/messaging');
const { downloadFile, resolveLocalStaticPath } = require('./greenApi/fileHandling');
const { getChatHistory, getContacts, getMessage } = require('./greenApi/chat');
const { createGroup, setGroupPicture } = require('./greenApi/groups');

module.exports = {
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
