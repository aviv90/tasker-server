/**
 * Incoming Message Result Handling
 * 
 * Handles sending agent results (text, media, polls, locations) to WhatsApp
 * 
 * This file now acts as a facade, importing from organized modules
 */

// Export types
export type { AgentResult, NormalizedInput, MediaSendResult } from './types';

// Export media handlers
export {
  sendImageResult,
  sendVideoResult,
  sendAudioResult,
  sendPollResult,
  sendLocationResult
} from './media';

// Export text handlers
export { sendMultiStepText, sendSingleStepText } from './text';

// Export post-processing and history
export { handlePostProcessing } from './postProcessing';
export { saveBotResponse } from './history';

// Import dependencies
import { shouldSkipAgentResult, extractQuotedMessageId } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
import { AgentResult, NormalizedInput } from './types';
import {
  sendImageResult,
  sendVideoResult,
  sendAudioResult,
  sendPollResult,
  sendLocationResult
} from './media';
import { sendMultiStepText, sendSingleStepText } from './text';
import { handlePostProcessing } from './postProcessing';
import { saveBotResponse } from './history';

/**
 * Send all agent results (text, media, polls, locations)
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param normalized - Normalized input
 * @returns True if results were sent successfully
 */
export async function sendAgentResults(
  chatId: string, 
  agentResult: AgentResult, 
  normalized: NormalizedInput
): Promise<boolean> {
  // For multi-step, results are sent immediately after each step in agentService
  // If alreadySent is true, skip sending here to avoid duplicates
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`✅ [Multi-step] Results already sent immediately after each step - skipping duplicate sending`);
    
    // CRITICAL: Still save bot response to conversation history even if already sent!
    // This ensures the bot can see its own previous responses in future requests
    await saveBotResponse(chatId, agentResult);
    
    logger.info(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
    return true;
  }

  // Get quotedMessageId from agentResult or normalized
  const quotedMessageId = extractQuotedMessageId({ agentResult, normalized });

  // Send any generated media (image/video/audio/poll) with captions
  let mediaSent = false;

  // Multi-step: Send text FIRST, then media
  if (agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
    await sendMultiStepText(chatId, agentResult.text, quotedMessageId);
  }

  // CRITICAL: Send media if URLs exist (Rule: Media MUST be sent!)
  // Track if text was already sent by media handlers to prevent duplicates
  let textAlreadySentByMedia = false;
  
  const imageResult = await sendImageResult(chatId, agentResult, quotedMessageId);
  if (imageResult.sent) {
    mediaSent = true;
    if (imageResult.textSent) {
      textAlreadySentByMedia = true;
    }
  }

  const videoResult = await sendVideoResult(chatId, agentResult, quotedMessageId);
  if (videoResult.sent) {
    mediaSent = true;
    if (videoResult.textSent) {
      textAlreadySentByMedia = true;
    }
  }

  if (await sendAudioResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendPollResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendLocationResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  // Single-step: If no media was sent, send text response
  // Pass textAlreadySentByMedia flag to prevent duplicate text sending
  await sendSingleStepText(chatId, agentResult, mediaSent, quotedMessageId, textAlreadySentByMedia);

  // Handle post-processing (complementary image generation)
  await handlePostProcessing(chatId, normalized, agentResult, quotedMessageId);

  // Save bot response to conversation history
  await saveBotResponse(chatId, agentResult);

  logger.info(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
  return true;
}

