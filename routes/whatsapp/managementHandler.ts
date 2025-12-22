/**
 * Management Command Handler
 * 
 * Handles management commands (non-AI commands that don't go through router).
 * Refactored to delegate logic to specialized services (v1398).
 */

// Import services
import { getServices } from '../../services/agent/utils/serviceLoader';
import { sendErrorToUser } from '../../utils/errorSender';
import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';

// Import specialized management services
import { UserManagementService } from '../../services/whatsapp/management/UserManagementService';
import { GroupManagementService } from '../../services/whatsapp/management/GroupManagementService';
import { SystemManagementService } from '../../services/whatsapp/management/SystemManagementService';

// Instance creation
const userService = new UserManagementService();
const groupService = new GroupManagementService();
const systemService = new SystemManagementService();

/**
 * Handle management commands
 * @param {Object} command - Command object with type and optional contactName
 * @param {string} chatId - Chat ID
 * @param {string} senderId - Sender ID
 * @param {string} senderName - Sender name
 * @param {string} senderContactName - Sender contact name
 * @param {string} chatName - Chat name
 * @param {string} [originalMessageId] - Optional: ID of original message for quoting
 */
export async function handleManagementCommand(
  command: { type: string; contactName?: string; isCurrentContact?: boolean },
  chatId: string,
  _senderId: string, // Unused
  senderName: string,
  senderContactName: string,
  chatName: string,
  originalMessageId: string | null | undefined = null
) {
  const { greenApiService } = getServices();
  try {
    const origId = originalMessageId || undefined;

    switch (command.type) {
      // ... (omitted for brevity, assume cases are preserved)
      // --- System Management ---
      case 'clear_all_conversations':
        await systemService.clearAllConversations(chatId, senderName, origId);
        break;

      case 'show_history':
        await systemService.showHistory(chatId, origId);
        break;

      case 'sync_contacts':
        await systemService.syncContacts(chatId, senderName, origId);
        break;

      // --- Media Authorization ---
      case 'media_creation_status':
        await userService.getMediaAuthorizationStatus(chatId, origId);
        break;

      case 'add_media_authorization':
        await userService.handleMediaAuthorization(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      case 'remove_media_authorization':
        await userService.removeMediaAuthorization(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      // --- Voice/Transcription Authorization ---
      case 'voice_transcription_status':
        await userService.getTranscriptionAuthorizationStatus(chatId, origId);
        break;

      case 'include_in_transcription':
        await userService.handleTranscriptionInclusion(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      case 'exclude_from_transcription':
        await userService.handleTranscriptionExclusion(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      // --- Group Authorization ---
      case 'group_creation_status':
        await groupService.getGroupAuthorizationStatus(chatId, origId);
        break;

      case 'add_group_authorization':
        await groupService.handleGroupAuthorization(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      case 'add_group_authorization_current':
        await groupService.handleGroupAuthorizationCurrent(chatId, chatName, senderName, senderContactName, origId);
        break;

      case 'remove_group_authorization':
        await groupService.removeGroupAuthorization(chatId, command.contactName || '', command.isCurrentContact || false, senderName, origId);
        break;

      default:
        logger.warn(`⚠️ Unknown management command type: ${command.type}`);
        await greenApiService.sendTextMessage(chatId, `⚠️ Unknown management command type: ${command.type}`, origId, TIME.TYPING_INDICATOR);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`❌ Error handling management command ${command.type}:`, { error: errorMessage, stack: errorStack });
    await sendErrorToUser(chatId, error, { context: 'MANAGEMENT_CMD', quotedMessageId: originalMessageId || undefined });
  }
}
