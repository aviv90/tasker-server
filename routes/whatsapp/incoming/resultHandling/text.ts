/**
 * Result Handling - Text Handlers
 * Handles sending text results to WhatsApp
 */

import * as greenApiService from '../../../../services/greenApiService';
import { cleanMediaDescription, cleanMultiStepText, isGenericSuccessMessage, isUnnecessaryApologyMessage } from '../../../../utils/textSanitizer';
import { cleanAgentText } from '../../../../services/whatsapp/utils';
import logger from '../../../../utils/logger';
import { AgentResult, NormalizedInput } from './types';

/**
 * Send multi-step text response
 * @param chatId - Chat ID
 * @param text - Text to send
 * @param quotedMessageId - Optional: ID of message to quote
 * @param agentResult - Optional: Agent result (for checking if text should be suppressed)
 * @param normalized - Optional: Normalized input (for checking user intent)
 */
export async function sendMultiStepText(
  chatId: string, 
  text: string, 
  quotedMessageId: string | null = null,
  agentResult: AgentResult | null = null,
  normalized: NormalizedInput | null = null
): Promise<void> {
  if (!text || !text.trim()) return;

  // CRITICAL: Suppress intermediate tool output when it's part of a pipeline
  // Example: get_chat_history → create_image (user asked "צייר גרף שמתאר את היסטוריית השיחה")
  // Example: get_chat_history → create_poll (user asked "שלח סקר שמבוסס על ההיסטוריה")
  // In these cases, we should send only the final output, not the intermediate data
  if (agentResult && normalized && isIntermediateToolOutputInPipeline(agentResult, normalized)) {
    logger.debug(`⏭️ [Multi-step] Skipping text - intermediate tool output in pipeline`);
    return;
  }

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
 * Map of data tools - tools that return intermediate data used by other tools
 * These tools' output should be suppressed when used in a pipeline
 */
const DATA_TOOLS = [
  'get_chat_history',
  'chat_summary',
  'search_web',
  'search_google_drive',
  'translate_text',
  'get_long_term_memory',
  'analyze_image_from_history',
  'transcribe_audio'
] as const;

/**
 * Map of output tools - tools that create final output (media, polls, locations, etc.)
 * These are the final tools in a pipeline whose output should be sent
 */
const OUTPUT_TOOLS = [
  'create_image',
  'create_video',
  'image_to_video',
  'animate_image',
  'create_poll',
  'send_location',
  'create_music',
  'text_to_speech',
  'translate_and_speak',
  'voice_clone_and_speak',
  'creative_audio_mix'
] as const;

/**
 * Check if user requested two separate commands (not a pipeline)
 * Examples: "שלח תמונה ואז שלח סקר" / "send image and then send poll"
 * @param userText - User's text input
 * @returns True if user requested two separate commands
 */
function isTwoSeparateCommands(userText: string): boolean {
  // Patterns that indicate two separate commands
  const separateCommandPatterns = [
    /(?:ואז|אחר כך|אחרי זה|and then|after that|and also|וגם)\s+(?:שלח|צור|create|send|make)/i,
    /(?:שלח|צור|create|send|make).*?(?:ואז|אחר כך|אחרי זה|and then|after that).*?(?:שלח|צור|create|send|make)/i,
    /(?:תמונה|image).*?(?:ואז|אחר כך|and then).*?(?:סקר|poll|מיקום|location)/i,
    /(?:סקר|poll).*?(?:ואז|אחר כך|and then).*?(?:תמונה|image|מיקום|location)/i
  ];
  
  return separateCommandPatterns.some(pattern => pattern.test(userText));
}

/**
 * Check if text looks like output from a data tool
 * @param text - Text to check
 * @param dataToolsUsed - List of data tools that were used
 * @returns True if text looks like data tool output
 */
function looksLikeDataToolOutput(text: string, dataToolsUsed: string[]): boolean {
  const lowerText = text.toLowerCase();
  
  // Patterns that indicate data tool output
  const dataToolPatterns: Record<string, RegExp[]> = {
    'get_chat_history': [
      /(?:היסטוריית|היסטוריה|הודעות|שיחה|conversation|history|messages|הודעה|message)/i,
      /(?:\[message|\[הודעה)/i
    ],
    'chat_summary': [
      /(?:סיכום|summary|תקציר)/i,
      /(?:נושאים|topics|key points)/i
    ],
    'search_web': [
      /(?:תוצאות|results|קישורים|links|found)/i,
      /https?:\/\//i
    ],
    'search_google_drive': [
      /(?:מצאתי|found|נמצא|located)/i,
      /(?:ב-Google Drive|in drive)/i
    ],
    'translate_text': [
      /(?:תרגום|translation|תרגמתי|translated)/i
    ],
    'get_long_term_memory': [
      /(?:העדפות|preferences|סיכומים|summaries)/i
    ]
  };
  
  // Check if any data tool pattern matches
  for (const tool of dataToolsUsed) {
    const patterns = dataToolPatterns[tool];
    if (patterns && patterns.some(pattern => pattern.test(text))) {
      return true;
    }
  }
  
  // Generic patterns for data output
  const genericDataPatterns = [
    /(?:\[|\]|הודעות|messages|תוצאות|results|קישורים|links)/i,
    /(?:https?:\/\/|www\.)/i,
    /(?:מצאתי|found|נמצא|located|תוצאות|results)/i
  ];
  
  // If text contains structured data indicators and is relatively long, it's likely data output
  if (genericDataPatterns.some(pattern => pattern.test(text)) && text.length > 100) {
    return true;
  }
  
  return false;
}

/**
 * Get the last output tool in the pipeline (the final tool whose output should be sent)
 * @param toolsUsed - List of tools used
 * @returns The last output tool, or null if none found
 */
function getLastOutputTool(toolsUsed: string[]): string | null {
  // Find the last output tool in the sequence
  for (let i = toolsUsed.length - 1; i >= 0; i--) {
    const tool = toolsUsed[i];
    if (OUTPUT_TOOLS.includes(tool as typeof OUTPUT_TOOLS[number])) {
      return tool;
    }
  }
  return null;
}

/**
 * Check if text is intermediate result from a tool pipeline
 * A pipeline is when data tools (or intermediate output tools) are used to feed into final output tools
 * Examples:
 * - get_chat_history → create_image (data → output)
 * - get_chat_history → chat_summary → create_poll (data → data → output)
 * - create_image → image_to_video (output → output)
 * @param agentResult - Agent result
 * @param normalized - Normalized input
 * @returns True if text should be suppressed because it's intermediate tool output in a pipeline
 */
function isIntermediateToolOutputInPipeline(agentResult: AgentResult, normalized: NormalizedInput): boolean {
  const toolsUsed = agentResult.toolsUsed || [];
  
  // If no tools were used, this is not a pipeline
  if (toolsUsed.length === 0) {
    return false;
  }
  
  // Check if user requested two separate commands (not a pipeline)
  const userText = normalized.userText || '';
  if (isTwoSeparateCommands(userText)) {
    logger.debug(`📝 [Text] User requested two separate commands - not suppressing intermediate output`);
    return false;
  }
  
  // Check if final output was created (media, poll, location, etc.)
  const hasFinalOutput = !!agentResult.imageUrl || 
                         !!agentResult.videoUrl || 
                         !!agentResult.audioUrl ||
                         !!agentResult.poll ||
                         (!!agentResult.latitude && !!agentResult.longitude);
  
  if (!hasFinalOutput) {
    return false;
  }
  
  // Get the last output tool (the final tool in the pipeline)
  const lastOutputTool = getLastOutputTool(toolsUsed);
  if (!lastOutputTool) {
    return false;
  }
  
  // Identify data tools and intermediate output tools used (everything except the last output tool)
  const dataToolsUsed = toolsUsed.filter(tool => 
    DATA_TOOLS.includes(tool as typeof DATA_TOOLS[number]) && tool !== lastOutputTool
  );
  
  // Also check for intermediate output tools (e.g., create_image → image_to_video)
  const intermediateOutputTools = toolsUsed.filter(tool => 
    OUTPUT_TOOLS.includes(tool as typeof OUTPUT_TOOLS[number]) && tool !== lastOutputTool
  );
  
  // If no intermediate tools (data or output), this is not a pipeline
  if (dataToolsUsed.length === 0 && intermediateOutputTools.length === 0) {
    return false;
  }
  
  // Check if text looks like intermediate tool output
  const text = agentResult.text || '';
  if (!text.trim()) {
    return false;
  }
  
  // Check if text looks like data tool output
  if (dataToolsUsed.length > 0 && looksLikeDataToolOutput(text, dataToolsUsed)) {
    logger.debug(`⏭️ [Text] Suppressing intermediate data tool output from pipeline: ${dataToolsUsed.join(', ')} → ${lastOutputTool}`);
    return true;
  }
  
  // Check if text looks like intermediate output tool result
  // For example, if create_image was used and then image_to_video, we should suppress the image description
  if (intermediateOutputTools.length > 0) {
    // Check if text contains patterns that suggest it's from an intermediate output tool
    // For example, image descriptions when image_to_video was the final tool
    const intermediatePatterns = [
      /(?:תמונה נוצרה|image created|תמונה של|image of)/i,
      /(?:✅.*תמונה|✅.*image)/i
    ];
    
    if (intermediatePatterns.some(pattern => pattern.test(text))) {
      logger.debug(`⏭️ [Text] Suppressing intermediate output tool result from pipeline: ${intermediateOutputTools.join(', ')} → ${lastOutputTool}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Send single-step text result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param mediaSent - Whether media was already sent
 * @param quotedMessageId - Optional: ID of message to quote
 * @param textAlreadySent - Optional: Whether text was already sent by media handler
 * @param normalized - Optional: Normalized input (for checking user intent)
 */
export async function sendSingleStepText(
  chatId: string, 
  agentResult: AgentResult, 
  mediaSent: boolean, 
  quotedMessageId: string | null = null, 
  textAlreadySent: boolean = false,
  normalized: NormalizedInput | null = null
): Promise<void> {
  // Note: We don't skip on tool errors anymore - we want to send the agent's response
  // The error handling will be done at a higher level if needed
  
  // Single-step: Send text response
  // CRITICAL: If text was already sent by media handler (e.g., sendImageResult), don't send again
  if (textAlreadySent) {
    logger.debug(`⏭️ [Text] Skipping text - already sent by media handler`);
    return;
  }
  
  // CRITICAL: Suppress intermediate tool output when it's part of a pipeline
  // Example: get_chat_history → create_image (user asked "צייר גרף שמתאר את היסטוריית השיחה")
  // Example: get_chat_history → create_poll (user asked "שלח סקר שמבוסס על ההיסטוריה")
  // In these cases, we should send only the final output, not the intermediate data
  if (normalized && isIntermediateToolOutputInPipeline(agentResult, normalized)) {
    logger.debug(`⏭️ [Text] Skipping text - intermediate tool output in pipeline`);
    return;
  }
  
  // CRITICAL: Even if media was sent, we should send additional text if it exists
  // This ensures users get both media (with caption) AND any additional context/description
  if (!agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (!multipleTools) {
      // Single tool: Check if text is different from caption (to avoid duplicates)
      let shouldSendText = true;
      
      // CRITICAL: If location was sent, skip text - location description is already sent separately
      // This prevents double-sending the location description
      if (agentResult.latitude && agentResult.longitude) {
        shouldSendText = false;
        logger.debug(`⏭️ [Text] Skipping text - location was sent (description already sent separately)`);
      }
      
      if (mediaSent && shouldSendText) {
        // If media was sent, check if text is just the caption (already sent with media)
        const textToCheck = cleanMediaDescription(agentResult.text);
        const imageCaption = agentResult.imageCaption ? cleanMediaDescription(agentResult.imageCaption) : '';
        
        // CRITICAL: Skip unnecessary apology messages when media was successfully created
        // These confuse users because they think something went wrong when it didn't
        if (isUnnecessaryApologyMessage(textToCheck)) {
          shouldSendText = false;
          logger.debug(`⏭️ [Text] Skipping apology message - media was successfully created`);
        }
        // For images: skip generic success messages - they're redundant when image is already sent
        else if (agentResult.imageUrl) {
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
      // Multiple tools: Still send text if it exists and is meaningful
      // BUT skip text if audio was generated (audio IS the response for TTS/translate_and_speak)
      if (agentResult.audioUrl) {
        logger.debug(`ℹ️ [Text] Multiple tools but audio exists - audio is the response, skipping text`);
      } else if (agentResult.text && agentResult.text.trim()) {
        const cleanText = cleanAgentText(agentResult.text);
        if (cleanText && cleanText.trim() && cleanText.length > 20) {
          logger.debug(`📝 [Text] Sending text despite multiple tools (${cleanText.length} chars)`);
          await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId || undefined, 1000);
        } else {
          logger.debug(`ℹ️ Multiple tools detected - text too short or empty, skipping`);
        }
      } else {
        logger.debug(`ℹ️ Multiple tools detected - no text to send`);
      }
    }
  }
  
  // CRITICAL: If no text was sent and no media was sent, send error message
  // This ensures user always gets a response
  if (!mediaSent && !agentResult.text?.trim()) {
    logger.warn(`⚠️ [Text] No text and no media - sending error message to user`);
    const errorMessage = agentResult.error || 'לא הצלחתי להשלים את הבקשה. אנא נסה שוב.';
    await greenApiService.sendTextMessage(chatId, errorMessage, quotedMessageId || undefined, 1000);
  }
}

