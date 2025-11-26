/**
 * Incoming Message Parsing
 * 
 * Handles parsing of incoming WhatsApp messages (text, captions, types)
 */

import { MessageData } from '../../../services/whatsapp/types';
import logger from '../../../utils/logger';

/**
 * Parse incoming message and extract text content
 * @param {Object} messageData - Message data from webhook
 * @returns {Object} Parsed message with text and type info
 */
export function parseIncomingMessage(messageData: MessageData) {
  let messageText: string | undefined | null = null;

  // Handle text messages (regular, extended, quoted, and edited)
  if (messageData.typeMessage === 'textMessage') {
    messageText = messageData.textMessageData?.textMessage;
  } else if (messageData.typeMessage === 'extendedTextMessage') {
    messageText = messageData.extendedTextMessageData?.text;
  } else if (messageData.typeMessage === 'quotedMessage') {
    // When replying to a message, the text is in extendedTextMessageData
    messageText = messageData.extendedTextMessageData?.text;
    // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
    if (!messageText) {
      messageText = messageData.fileMessageData?.caption ||
        messageData.imageMessageData?.caption ||
        messageData.videoMessageData?.caption ||
        messageData.stickerMessageData?.caption;
    }
  } else if (messageData.typeMessage === 'editedMessage') {
    // Handle edited messages - treat them as regular messages
    messageText = messageData.editedMessageData?.textMessage;
    logger.info(`✏️ Edited message detected: "${messageText}"`);
  } else if (messageData.typeMessage === 'imageMessage') {
    // Extract caption from image messages
    messageText = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
  } else if (messageData.typeMessage === 'videoMessage') {
    // Extract caption from video messages
    messageText = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
  } else if (messageData.typeMessage === 'stickerMessage') {
    // Extract caption from sticker messages (rare but possible)
    messageText = messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption;
  }

  return {
    messageText,
    type: messageData.typeMessage
  };
}

/**
 * Extract prompt from message text (remove "# " prefix if exists)
 * @param {string} messageText - Raw message text
 * @returns {string} Cleaned prompt
 */
export function extractPrompt(messageText: string) {
  if (!messageText) return '';
  // Extract the prompt (remove "# " prefix if exists)
  // For edited messages, # might be removed by WhatsApp/Green API
  return messageText.trim().replace(/^#\s+/, '').trim();
}

/**
 * Log incoming message details for debugging
 * @param {Object} messageData - Message data
 * @param {string} senderName - Sender name
 * @param {string} messageText - Extracted message text
 */
export function logIncomingMessage(messageData: MessageData, senderName: string, messageText: string | null | undefined) {
  logger.info(`📱 Incoming from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
  if (messageText) {
    logger.info(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
  }
  if (messageData.typeMessage === 'imageMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    logger.info(`   Image Caption: ${caption || 'N/A'}`);
  }
  if (messageData.typeMessage === 'stickerMessage') {
    const caption = messageData.fileMessageData?.caption;
    logger.info(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
  }
  if (messageData.typeMessage === 'videoMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    logger.info(`   Video Caption: ${caption || 'N/A'}`);
  }
  if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
    logger.info(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
    if (messageData.quotedMessage.textMessageData?.textMessage) {
      logger.info(`   Quoted Text: ${messageData.quotedMessage.textMessageData.textMessage.substring(0, 50)}...`);
    }
    // Note: textMessage on recursive type is not defined in interface but might be there in raw data
    // or inside textMessageData. Let's use textMessageData.
    if (messageData.quotedMessage.caption) {
      logger.info(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
    }
  }
}
