/**
 * Result Handling - Poll Media
 * Handles sending poll results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { sendErrorToUser } from '../../../../../utils/errorSender';
import { shouldSkipAgentResult } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';
import { AgentResult } from '../types';

/**
 * Send poll result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns True if sent
 */
export async function sendPollResult(
  chatId: string, 
  agentResult: AgentResult, 
  quotedMessageId: string | null = null
): Promise<boolean> {
  if (!agentResult.poll) return false;

  // For multi-step, poll is already sent in agentService - skip here
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`⏭️ [Agent] Skipping poll send - already sent in multi-step`);
    return false;
  }

  try {
    logger.debug(`📊 [Agent] Sending poll: ${agentResult.poll.question}`);
    // Convert options to Green API format - sendPoll expects string[] not { optionName: string }[]
    // Fix: Ensure options are strings
    const pollOptions: string[] = agentResult.poll.options.map((opt: any) => 
        typeof opt === 'string' ? opt : (opt?.optionName || String(opt))
    );
    await greenApiService.sendPoll(chatId, agentResult.poll.question, pollOptions, false, quotedMessageId || undefined, 1000);
    return true;
  } catch (error: any) {
    logger.error(`❌ [Agent] Failed to send poll:`, { error: error.message, stack: error.stack });
    
    // Send error to user
    try {
      await sendErrorToUser(chatId, error, { context: 'SENDING_POLL', quotedMessageId });
    } catch (sendError: any) {
      logger.error(`❌ [Agent] Failed to send poll error message:`, { error: sendError.message, stack: sendError.stack });
    }
    
    return false;
  }
}

