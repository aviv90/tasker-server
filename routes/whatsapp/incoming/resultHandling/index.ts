/**
 * Incoming Message Result Handling
 * 
 * Handles sending agent results (text, media, polls, locations) to WhatsApp
 * 
 * This file acts as a facade, delegating to the centralized ResultSender
 */

// Export types
export type { AgentResult, NormalizedInput, MediaSendResult } from './types';

// Export post-processing and history
export { handlePostProcessing } from './postProcessing';
export { saveBotResponse } from './history';

// Import dependencies
import { shouldSkipAgentResult, extractQuotedMessageId } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
import { AgentResult, NormalizedInput } from './types';
import resultSender from '../../../../services/agent/execution/resultSender';
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
    await saveBotResponse(chatId, agentResult);

    logger.info(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
    return true;
  }

  // Get quotedMessageId from agentResult or normalized
  const quotedMessageId = extractQuotedMessageId({ agentResult, normalized });

  // Map AgentResult to StepResult structure for ResultSender
  // (AgentResult is compatible with StepResult mostly)
  const stepResult = {
    ...agentResult,
    text: agentResult.text || '', // Ensure text is string
    toolsUsed: agentResult.toolsUsed,
    toolCalls: agentResult.toolCalls,
    toolResults: agentResult.toolResults,
    // Ensure all media properties are present
    imageUrl: agentResult.imageUrl || undefined,
    videoUrl: agentResult.videoUrl || undefined,
    audioUrl: agentResult.audioUrl || undefined,
    poll: agentResult.poll || undefined,
    latitude: agentResult.latitude,
    longitude: agentResult.longitude,
    locationInfo: agentResult.locationInfo,
    caption: agentResult.caption || agentResult.imageCaption || agentResult.videoCaption
  };

  try {
    // Send all results using ResultSender
    // This handles order: location -> poll -> image -> video -> audio -> text
    // And duplicate text suppression logic
    await resultSender.sendStepResults(chatId, stepResult, null, quotedMessageId, normalized.userText || null);

    // Check if anything was sent?
    // ResultSender doesn't return info on what was sent.
    // We assume if it didn't throw, it worked or logged errors.
    // If no content existed, it just returns.

    // Verify if we need to send error?
    // ResultSender handles "nothing to send" gracefully essentially. 
    // But if we want to ensure *something* was sent...
    // We can check the input agentResult for content.
    const hasContent = agentResult.text || agentResult.imageUrl || agentResult.videoUrl ||
      agentResult.audioUrl || agentResult.poll || agentResult.latitude;

    if (!hasContent && !agentResult.suppressedFinalResponse) {
      logger.error(`❌ [Result Handling] Nothing was sent to user! Sending error message.`);
      const { sendErrorToUser, ERROR_MESSAGES } = await import('../../../../utils/errorSender');
      await sendErrorToUser(chatId, agentResult?.error || ERROR_MESSAGES.UNKNOWN, { quotedMessageId: quotedMessageId || undefined });
    }

    // Handle post-processing (complementary image generation)
    await handlePostProcessing(chatId, normalized, agentResult, quotedMessageId);

    // Save bot response to conversation history
    await saveBotResponse(chatId, agentResult);

    logger.info(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
    return true;

  } catch (error) {
    logger.error('❌ Error sending results:', error);
    return false;
  }
}
