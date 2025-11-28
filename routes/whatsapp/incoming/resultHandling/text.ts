/**
 * Result Handling - Text Handlers
 * Handles sending text results to WhatsApp
 */

import * as greenApiService from '../../../../services/greenApiService';
import { cleanMediaDescription, cleanMultiStepText, isGenericSuccessMessage } from '../../../../utils/textSanitizer';
import { cleanAgentText } from '../../../../services/whatsapp/utils';
import logger from '../../../../utils/logger';
import { AgentResult } from './types';

/**
 * Send multi-step text response
 * @param chatId - Chat ID
 * @param text - Text to send
 * @param quotedMessageId - Optional: ID of message to quote
 */
export async function sendMultiStepText(
  chatId: string, 
  text: string, 
  quotedMessageId: string | null = null
): Promise<void> {
  if (!text || !text.trim()) return;

  // Use centralized text cleaning function (SSOT)
  const cleanText = cleanMultiStepText(text);

  if (cleanText) {
    await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId || undefined, 1000);
    logger.debug(`📤 [Multi-step] Text sent first (${cleanText.length} chars)`);
  } else {
    logger.warn(`⚠️ [Multi-step] Text exists but cleanText is empty`);
  }
}

/**
 * Send single-step text result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param mediaSent - Whether media was already sent
 * @param quotedMessageId - Optional: ID of message to quote
 * @param textAlreadySent - Optional: Whether text was already sent by media handler
 */
export async function sendSingleStepText(
  chatId: string, 
  agentResult: AgentResult, 
  mediaSent: boolean, 
  quotedMessageId: string | null = null, 
  textAlreadySent: boolean = false
): Promise<void> {
  // CRITICAL: If tool failed and error was already sent, don't send Gemini's error text
  // This prevents duplicate error messages (one from tool, one from Gemini final response)
  const hasToolError = agentResult.toolResults && 
                       Object.values(agentResult.toolResults).some((result: any) => result?.error);
  
  if (hasToolError) {
    logger.debug(`⚠️ [Result Handling] Tool error detected - skipping Gemini final text to avoid duplicate`);
    return;
  }
  
  // Single-step: Send text response
  // CRITICAL: If text was already sent by media handler (e.g., sendImageResult), don't send again
  if (textAlreadySent) {
    logger.debug(`⏭️ [Text] Skipping text - already sent by media handler`);
    return;
  }
  
  // CRITICAL: Even if media was sent, we should send additional text if it exists
  // This ensures users get both media (with caption) AND any additional context/description
  if (!agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (!multipleTools) {
      // Single tool: Check if text is different from caption (to avoid duplicates)
      let shouldSendText = true;
      
      // CRITICAL: If location was sent, check if text contains locationInfo (already sent separately)
      if (agentResult.latitude && agentResult.longitude && agentResult.locationInfo) {
        const textToCheck = agentResult.text.trim();
        const locationInfoToCheck = agentResult.locationInfo.trim();
        
        // If text is same as locationInfo or contains it, don't send again (already sent in sendLocationResult)
        if (textToCheck === locationInfoToCheck || 
            textToCheck.includes(locationInfoToCheck) || 
            locationInfoToCheck.includes(textToCheck)) {
          shouldSendText = false;
          logger.debug(`⏭️ [Text] Skipping text - same as locationInfo (already sent separately)`);
        }
      }
      
      if (mediaSent && shouldSendText) {
        // If media was sent, check if text is just the caption (already sent with media)
        const textToCheck = cleanMediaDescription(agentResult.text);
        const imageCaption = agentResult.imageCaption ? cleanMediaDescription(agentResult.imageCaption) : '';
        
        // For images: skip generic success messages - they're redundant when image is already sent
        if (agentResult.imageUrl) {
          if (isGenericSuccessMessage(textToCheck.trim(), 'image')) {
            shouldSendText = false;
            logger.debug(`⏭️ [Text] Skipping generic success message after image`);
          }
          // If text is same as caption, don't send again
          else if (textToCheck.trim() === imageCaption.trim()) {
            shouldSendText = false;
            logger.debug(`ℹ️ [Text] Skipping text - same as image caption`);
          }
        }
        // For videos: skip generic success messages - they're redundant when video is already sent
        else if (agentResult.videoUrl) {
          if (isGenericSuccessMessage(textToCheck.trim(), 'video')) {
            shouldSendText = false;
            logger.debug(`⏭️ [Text] Skipping generic success message after video`);
          }
          // If text was already sent by sendVideoResult, don't send again
          else if (textAlreadySent) {
            shouldSendText = false;
            logger.debug(`ℹ️ [Text] Skipping text - already sent with video`);
          }
        }
        // For audio: audio IS the response, no additional text needed
        else if (agentResult.audioUrl) {
          shouldSendText = false;
          logger.debug(`ℹ️ [Text] Skipping text - audio is the response`);
        }
        // For other media: send text if it's meaningfully different
        else if (textToCheck.trim().length < 20) {
          shouldSendText = false;
          logger.debug(`ℹ️ [Text] Skipping text - too short to be meaningful`);
        }
      }
    
      if (shouldSendText) {
        const cleanText = cleanAgentText(agentResult.text);
        if (cleanText && cleanText.trim()) {
          logger.debug(`📝 [Text] Sending text ${mediaSent ? 'after media' : 'as response'} (${cleanText.length} chars)`);
          await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId || undefined, 1000);
        }
      }
    } else {
      logger.debug(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
    }
  }
}

