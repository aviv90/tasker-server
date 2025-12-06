/**
 * Result Handling - Image Media
 * Handles sending image results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { cleanMediaDescription } from '../../../../../utils/textSanitizer';
import { cleanAgentText } from '../../../../../services/whatsapp/utils';
import { shouldSkipAgentResult } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';
import { AgentResult, MediaSendResult } from '../types';

/**
 * Send image result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns Object with sent flag and textSent flag
 */
export async function sendImageResult(
  chatId: string,
  agentResult: AgentResult,
  quotedMessageId: string | null = null
): Promise<MediaSendResult> {
  if (!agentResult.imageUrl) return { sent: false, textSent: false };

  // For multi-step with alreadySent=true, image was already sent in agentService
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
    return { sent: false, textSent: false };
  }

  logger.debug(`📸 [Agent] Sending generated image: ${agentResult.imageUrl}`);

  // CRITICAL: Caption MUST be sent with the image, not in a separate message
  // Priority: imageCaption > text (if text is not generic success message)
  let caption = agentResult.imageCaption || '';

  // If no caption but text exists and is not a generic success message, use text as caption
  // This ensures provider descriptions (like revisedPrompt) are shown as captions, not separate messages
  if (!caption && agentResult.text && agentResult.text.trim()) {

    caption = agentResult.text;
    logger.debug(`📸 [Image] Using text as caption (no imageCaption provided)`);
  }

  // Clean the caption: remove URLs, markdown links, code blocks, and technical markers
  caption = cleanMediaDescription(caption);

  await greenApiService.sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId || undefined, 1000);

  // Track if additional text was sent (to prevent duplicate sending in sendSingleStepText)
  let textSent = false;

  // If there's additional text beyond the caption, send it in a separate message
  // This ensures users get both the image with caption AND any additional context/description
  // (Additional text logic removed - delegated to sendSingleStepText)

  return { sent: true, textSent };
}

