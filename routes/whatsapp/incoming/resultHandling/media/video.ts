/**
 * Result Handling - Video Media
 * Handles sending video results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { cleanMediaDescription } from '../../../../../utils/textSanitizer';
import { cleanAgentText } from '../../../../../services/whatsapp/utils';
import { shouldSkipAgentResult } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';
import { AgentResult, MediaSendResult } from '../types';

/**
 * Send video result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns Object with sent flag and textSent flag
 */
export async function sendVideoResult(
  chatId: string,
  agentResult: AgentResult,
  quotedMessageId: string | null = null
): Promise<MediaSendResult> {
  if (!agentResult.videoUrl) return { sent: false, textSent: false };

  // For multi-step, video is already sent in agentService - skip here
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`⏭️ [Agent] Skipping video send - already sent in multi-step`);
    return { sent: false, textSent: false };
  }

  logger.debug(`🎬 [Agent] Sending generated video: ${agentResult.videoUrl}`);

  // CRITICAL: Caption MUST be sent with the video, not in a separate message
  // Priority: videoCaption > caption > text (if text is not generic success message)
  let caption = agentResult.videoCaption || '';

  // If no caption but text exists and is not a generic success message, use text as caption
  if (!caption && agentResult.text && agentResult.text.trim()) {

    caption = agentResult.text;
  }

  const cleanCaption = cleanMediaDescription(caption);

  // Send video WITH caption (caption is always sent with media, never separately)
  await greenApiService.sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, cleanCaption, quotedMessageId || undefined, 1000);

  // Track if additional text was sent (to prevent duplicate sending in sendSingleStepText)
  let textSent = false;

  // If there's additional text beyond the caption, send it in a separate message
  if (agentResult.text && agentResult.text.trim()) {
    const textToCheck = cleanMediaDescription(agentResult.text);
    const captionToCheck = cleanMediaDescription(caption);


    // Only send if text is meaningfully different from caption (more than just whitespace/formatting)
    if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
      const additionalText = cleanAgentText(agentResult.text);
      if (additionalText && additionalText.trim()) {
        logger.debug(`📝 [Video] Sending additional text after video (${additionalText.length} chars)`);
        await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
        textSent = true;
      }
    }
  }

  return { sent: true, textSent };
}

