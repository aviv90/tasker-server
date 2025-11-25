/**
 * WhatsApp Authorization Module
 * Handles user permissions for media creation, group creation, and admin commands
 */

import authStore from '../../store/authStore';
import groupAuthStore from '../../store/groupAuthStore';
import { sendTextMessage } from '../greenApiService';

/**
 * Sender data structure from Green API
 */
interface SenderData {
  chatId?: string;
  senderId?: string;
  [key: string]: unknown;
}

/**
 * Check if user is authorized for media creation (images, videos, music)
 * @param senderData - WhatsApp sender data from Green API
 * @returns True if user is authorized
 */
export async function isAuthorizedForMediaCreation(senderData: SenderData): Promise<boolean> {
  return await authStore.isAuthorizedForMediaCreation(senderData);
}

/**
 * Check if user is authorized for group creation
 * @param senderData - WhatsApp sender data from Green API
 * @returns True if user is authorized
 */
export async function isAuthorizedForGroupCreation(senderData: SenderData): Promise<boolean> {
  return await groupAuthStore.isAuthorizedForGroupCreation(senderData);
}

/**
 * Check if command requires media creation authorization
 * @param commandType - Command type
 * @returns True if command requires authorization
 */
export function requiresMediaAuthorization(commandType: string): boolean {
  const mediaCommands = [
    'gemini_image',
    'openai_image',
    'grok_image', 
    'veo3_video',
    'kling_text_to_video',
    'kling_image_to_video',
    'veo3_image_to_video',
    'runway_video_to_video',
    'music_generation',
    'text_to_speech',
    'gemini_image_edit',
    'openai_image_edit'
  ];
  return mediaCommands.includes(commandType);
}

/**
 * Check if a command is an admin/management command (should only work from outgoing messages)
 * @param commandType - Command type
 * @returns True if command is admin-only
 */
export function isAdminCommand(commandType: string): boolean {
  const adminCommands = [
    'include_in_transcription',
    'exclude_from_transcription',
    'add_media_authorization',
    'remove_media_authorization',
    'voice_transcription_status',
    'media_creation_status',
    'add_group_authorization',
    'remove_group_authorization',
    'group_creation_status',
    'clear_all_conversations',
    'sync_contacts',
    // New admin shortcuts without explicit name
    'add_media_authorization_current',
    'add_group_authorization_current',
    'include_in_transcription_current'
  ];
  return adminCommands.includes(commandType);
}

/**
 * Send unauthorized access message
 * @param chatId - WhatsApp chat ID
 * @param feature - Feature name (for logging)
 * @param originalMessageId - Optional: ID of original message for quoting
 */
export async function sendUnauthorizedMessage(chatId: string, feature: string, originalMessageId: string | null = null): Promise<void> {
  const message = '🔒 סליחה, אין לך הרשאה להשתמש בתכונה זו. פנה למנהל המערכת.';
  await sendTextMessage(chatId, message, originalMessageId, 1000);
  console.log(`🚫 Unauthorized access attempt to ${feature}`);
}

