/**
 * Green API Messaging Functions (Legacy Facade)
 * Delegating to Container's MessagingService for backward compatibility.
 */

import container from '../container';
import { TIME } from '../../utils/constants';

/**
 * Send text message via Green API
 */
export async function sendTextMessage(
  chatId: string,
  message: string,
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  return container.getService('messaging').sendTextMessage(chatId, message, quotedMessageId, typingTime);
}

/**
 * Send file by URL via Green API
 */
export async function sendFileByUrl(
  chatId: string,
  fileUrl: string,
  fileName: string,
  caption: string = '',
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  return container.getService('messaging').sendFileByUrl(chatId, fileUrl, fileName, caption, quotedMessageId, typingTime);
}

/**
 * Send poll message via Green API
 */
export async function sendPoll(
  chatId: string,
  message: string,
  options: string[],
  multipleAnswers: boolean = false,
  _quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  return container.getService('messaging').sendPoll(chatId, message, options, multipleAnswers, _quotedMessageId, typingTime);
}

/**
 * Send location message via Green API
 */
export async function sendLocation(
  chatId: string,
  latitude: number,
  longitude: number,
  nameLocation: string = '',
  address: string = '',
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  return container.getService('messaging').sendLocation(chatId, latitude, longitude, nameLocation, address, quotedMessageId, typingTime);
}

/**
 * Set typing status via Green API
 */
export async function setTyping(chatId: string): Promise<unknown> {
  return container.getService('messaging').setTyping(chatId);
}
