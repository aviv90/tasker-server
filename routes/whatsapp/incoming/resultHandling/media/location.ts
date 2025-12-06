/**
 * Result Handling - Location Media
 * Handles sending location results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { shouldSkipAgentResult } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';
import { AgentResult } from '../types';

/**
 * Location send result
 */
export interface LocationSendResult {
  sent: boolean;
  descriptionSent: boolean;
}

/**
 * Send location result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns Result indicating what was sent
 */
export async function sendLocationResult(
  chatId: string,
  agentResult: AgentResult,
  quotedMessageId: string | null = null
): Promise<LocationSendResult> {
  if (!agentResult.latitude || !agentResult.longitude) return { sent: false, descriptionSent: false };

  // For multi-step, location is already sent in agentService - skip here
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`⏭️ [Agent] Skipping location send - already sent in multi-step`);
    return { sent: false, descriptionSent: false };
  }

  logger.debug(`📍 [Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
  await greenApiService.sendLocation(chatId, agentResult.latitude, agentResult.longitude, '', '', quotedMessageId || undefined, 1000);

  // Send location info as separate text message
  // CRITICAL: Clean locationInfo to remove JSON wrappers and ensure it's plain text
  let descriptionSent = false;
  if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
    const { cleanJsonWrapper } = await import('../../../../../utils/textSanitizer');
    const cleanLocationInfo = cleanJsonWrapper(agentResult.locationInfo);
    if (cleanLocationInfo && cleanLocationInfo.trim()) {
      await greenApiService.sendTextMessage(chatId, `📍 ${cleanLocationInfo}`, quotedMessageId || undefined, 1000);
      descriptionSent = true;
      logger.debug(`📍 [Agent] Location description sent: ${cleanLocationInfo.substring(0, 50)}...`);
    }
  }
  return { sent: true, descriptionSent };
}

