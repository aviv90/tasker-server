/**
 * Result Handling - Location Media
 * Handles sending location results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { shouldSkipAgentResult } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';
import { AgentResult } from '../types';

/**
 * Send location result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns True if sent
 */
export async function sendLocationResult(
  chatId: string, 
  agentResult: AgentResult, 
  quotedMessageId: string | null = null
): Promise<boolean> {
  if (!agentResult.latitude || !agentResult.longitude) return false;

  // For multi-step, location is already sent in agentService - skip here
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`⏭️ [Agent] Skipping location send - already sent in multi-step`);
    return false;
  }

  logger.debug(`📍 [Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
  await greenApiService.sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '', quotedMessageId || undefined, 1000);
  // Send location info as separate text message
  if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
    await greenApiService.sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`, quotedMessageId || undefined, 1000);
  }
  return true;
}

