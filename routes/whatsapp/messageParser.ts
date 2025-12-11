/**
 * Message Parser
 *
 * Parses WhatsApp message data to extract text and media information.
 * Extracted from outgoingHandler.js for better modularity (SRP).
 */

import logger from '../../utils/logger';
import { MessageData } from '../../services/whatsapp/types';

/**
 * Extract message text from various message types
 */
export function extractMessageText(messageData: MessageData): string | null {
  if (!messageData || !messageData.typeMessage) {
    return null;
  }

  const { typeMessage } = messageData;

  switch (typeMessage) {
    case 'textMessage':
      return messageData.textMessageData?.textMessage || null;

    case 'extendedTextMessage':
      return messageData.extendedTextMessageData?.text || null;

    case 'quotedMessage': {
      // When replying to a message, the text is in extendedTextMessageData
      const quotedText = messageData.extendedTextMessageData?.text;
      if (quotedText) return quotedText;

      // Fallback: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      return messageData.fileMessageData?.caption ||
        messageData.imageMessageData?.caption ||
        messageData.videoMessageData?.caption ||
        messageData.stickerMessageData?.caption ||
        null;
    }

    case 'editedMessage':
      return messageData.editedMessageData?.textMessage || null;

    case 'imageMessage':
      return messageData.fileMessageData?.caption || messageData.imageMessageData?.caption || null;

    case 'videoMessage':
      return messageData.fileMessageData?.caption || messageData.videoMessageData?.caption || null;

    case 'stickerMessage':
      return messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption || null;

    default:
      return null;
  }
}

export interface QuotedMessageContext {
  type: string;
  text: string;
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  stanzaId?: string;
}

/**
 * Build quoted context for Agent
 */
export function buildQuotedContext(
  quotedMessage: MessageData,
  imageUrl?: string | null,
  videoUrl?: string | null,
  audioUrl?: string | null
): QuotedMessageContext | null {
  if (!quotedMessage) {
    return null;
  }

  return {
    type: quotedMessage.typeMessage || 'unknown',
    text: quotedMessage.textMessage || quotedMessage.caption || '',
    hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
    hasVideo: quotedMessage.typeMessage === 'videoMessage',
    hasAudio: quotedMessage.typeMessage === 'audioMessage',
    imageUrl: imageUrl || null,
    videoUrl: videoUrl || null,
    audioUrl: audioUrl || null,
    stanzaId: quotedMessage.stanzaId
  };
}

/**
 * Log message details for debugging
 */
export function logMessageDetails(
  messageData: MessageData,
  senderName: string,
  messageText: string | null,
  direction: 'Incoming' | 'Outgoing' = 'Outgoing'
): void {
  const icon = direction === 'Incoming' ? '📱' : '📤';
  const logFn = direction === 'Incoming' ? logger.info.bind(logger) : logger.debug.bind(logger);

  logFn(`${icon} ${direction} from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);

  if (messageText) {
    // Truncate long text
    const truncatedText = messageText.length > 100 ? `${messageText.substring(0, 100)}...` : messageText;
    logFn(`   Text: ${truncatedText}`);
  }

  if (messageData.typeMessage === 'imageMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    logFn(`   Image Caption: ${caption || 'N/A'}`);
  }

  if (messageData.typeMessage === 'stickerMessage') {
    const caption = messageData.fileMessageData?.caption;
    logFn(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
  }

  if (messageData.typeMessage === 'videoMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    logFn(`   Video Caption: ${caption || 'N/A'}`);
  }

  if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
    logFn(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
    if (messageData.quotedMessage.textMessageData?.textMessage) {
      const qText = messageData.quotedMessage.textMessageData.textMessage;
      logFn(`   Quoted Text: ${qText.length > 50 ? qText.substring(0, 50) + '...' : qText}`);
    }
    if (messageData.quotedMessage.caption) {
      const qCaption = messageData.quotedMessage.caption;
      logFn(`   Quoted Caption: ${qCaption.length > 50 ? qCaption.substring(0, 50) + '...' : qCaption}`);
    }
  }
}
