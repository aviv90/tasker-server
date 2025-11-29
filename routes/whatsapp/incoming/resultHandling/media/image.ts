/**
 * Result Handling - Image Media
 * Handles sending image results to WhatsApp
 */

import * as greenApiService from '../../../../../services/greenApiService';
import { cleanMediaDescription, isGenericSuccessMessage, isUnnecessaryApologyMessage } from '../../../../../utils/textSanitizer';
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
  if (!agentResult.imageUrl) return {sent: false, textSent: false};

  // For multi-step with alreadySent=true, image was already sent in agentService
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
    return {sent: false, textSent: false};
  }

  logger.debug(`📸 [Agent] Sending generated image: ${agentResult.imageUrl}`);

  // CRITICAL: Caption MUST be sent with the image, not in a separate message
  // Priority: imageCaption > text (if text is not generic success message)
  let caption = agentResult.imageCaption || '';
  
  // If no caption but text exists and is not a generic success message, use text as caption
  // This ensures provider descriptions (like revisedPrompt) are shown as captions, not separate messages
  if (!caption && agentResult.text && agentResult.text.trim()) {
    const textToCheck = cleanMediaDescription(agentResult.text);
    if (!isGenericSuccessMessage(textToCheck.trim(), 'image')) {
      caption = agentResult.text;
      logger.debug(`📸 [Image] Using text as caption (no imageCaption provided)`);
    }
  }
  
  // Clean the caption: remove URLs, markdown links, code blocks, and technical markers
  caption = cleanMediaDescription(caption);

  await greenApiService.sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId || undefined, 1000);
  
  // Track if additional text was sent (to prevent duplicate sending in sendSingleStepText)
  let textSent = false;
  
  // If there's additional text beyond the caption, send it in a separate message
  // This ensures users get both the image with caption AND any additional context/description
  if (agentResult.text && agentResult.text.trim()) {
    const textToCheck = cleanMediaDescription(agentResult.text);
    const captionToCheck = cleanMediaDescription(caption);
    
    // Skip generic success messages - they're redundant when image is already sent
    if (isGenericSuccessMessage(textToCheck.trim(), 'image')) {
      logger.debug(`⏭️ [Image] Skipping generic success message after image`);
    }
    // Skip unnecessary apology messages when image was successfully created
    else if (isUnnecessaryApologyMessage(textToCheck)) {
      logger.debug(`⏭️ [Image] Skipping apology message after image`);
    }
    // Only send if text is meaningfully different from caption (more than just whitespace/formatting)
    else if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
      const additionalText = cleanAgentText(agentResult.text);
      if (additionalText && additionalText.trim()) {
        logger.debug(`📝 [Image] Sending additional text after image (${additionalText.length} chars)`);
        await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
        textSent = true;
      }
    }
  }
  
  return {sent: true, textSent};
}

