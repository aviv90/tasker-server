/**
 * Result Handling - Image Media
 * Handles sending image results to WhatsApp
 */

import * as greenApiService from '../../../../services/greenApiService';
import { cleanMediaDescription, isGenericSuccessMessage } from '../../../../utils/textSanitizer';
import { cleanAgentText } from '../../../../services/whatsapp/utils';
import { shouldSkipAgentResult } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
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

  let caption = '';

  // Multi-step: Use imageCaption if exists (LLM should return it in correct language)
  if (agentResult.multiStep) {
    caption = (agentResult.imageCaption && agentResult.imageCaption.trim()) || '';
    if (caption) {
      caption = cleanMediaDescription(caption);
      logger.debug(`📤 [Multi-step] Image sent with caption: "${caption.substring(0, 50)}..."`);
    } else {
      logger.debug(`📤 [Multi-step] Image sent after text (no caption)`);
    }
  } else {
    // Single-step: Images support captions - use them!
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (multipleTools) {
      // Multiple tools → use ONLY imageCaption (specific to this image)
      caption = agentResult.imageCaption || '';
      logger.debug(`ℹ️ Multiple tools detected - using imageCaption only to avoid mixing outputs`);
    } else {
      // Single tool → use imageCaption if available, otherwise empty (don't use general text to avoid sending history)
      // CRITICAL: For media creation commands, we should NOT send general text as caption
      // General text might contain history or other context that shouldn't be in the caption
      caption = agentResult.imageCaption || '';
    }

    // Clean the caption: remove URLs, markdown links, code blocks, and technical markers
    caption = cleanMediaDescription(caption);
  }

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

