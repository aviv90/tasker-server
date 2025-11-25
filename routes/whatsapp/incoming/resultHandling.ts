/**
 * Incoming Message Result Handling
 * 
 * Handles sending agent results (text, media, polls, locations) to WhatsApp
 */

import * as greenApiService from '../../../services/greenApiService';
import { getStaticFileUrl } from '../../../utils/urlUtils';
import { cleanMediaDescription, cleanMultiStepText } from '../../../utils/textSanitizer';
import { cleanAgentText } from '../../../services/whatsapp/utils';
import { executeAgentQuery } from '../../../services/agentService';
import { sendErrorToUser } from '../../../utils/errorSender';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import logger from '../../../utils/logger';

export interface AgentResult {
    success?: boolean;
    error?: string;
    text?: string;
    imageUrl?: string;
    imageCaption?: string;
    videoUrl?: string;
    audioUrl?: string;
    poll?: {
        question: string;
        options: string[];
    };
    latitude?: string;
    longitude?: string;
    locationInfo?: string;
    multiStep?: boolean;
    alreadySent?: boolean;
    toolsUsed?: string[];
    iterations?: number;
    originalMessageId?: string;
    toolResults?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Send multi-step text response
 * @param {string} chatId - Chat ID
 * @param {string} text - Text to send
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
export async function sendMultiStepText(chatId: string, text: string, quotedMessageId: string | null = null) {
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
 * Send image result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
export async function sendImageResult(chatId: string, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<boolean> {
  if (!agentResult.imageUrl) return false;

  // For multi-step with alreadySent=true, image was already sent in agentService
  if (agentResult.multiStep && agentResult.alreadySent) {
    logger.debug(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
    return false;
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
      // Single tool → can use general text as fallback
      caption = agentResult.imageCaption || agentResult.text || '';
    }

    // Clean the caption: remove URLs, markdown links, code blocks, and technical markers
    caption = cleanMediaDescription(caption);
  }

  await greenApiService.sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId || undefined, 1000);
  return true;
}

/**
 * Send video result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
export async function sendVideoResult(chatId: string, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<boolean> {
  if (!agentResult.videoUrl) return false;

  // For multi-step, video is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    logger.debug(`⏭️ [Agent] Skipping video send - already sent in multi-step`);
    return false;
  }

  logger.debug(`🎬 [Agent] Sending generated video: ${agentResult.videoUrl}`);
  // Videos don't support captions well - send as file, text separately
  await greenApiService.sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '', quotedMessageId || undefined, 1000);

  // If there's meaningful text (description/revised prompt), send it separately
  if (agentResult.text && agentResult.text.trim()) {
    const videoDescription = cleanMediaDescription(agentResult.text);
    if (videoDescription && videoDescription.length > 2) {
      await greenApiService.sendTextMessage(chatId, videoDescription, quotedMessageId || undefined, 1000);
    }
  }

  return true;
}

/**
 * Send audio result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
export async function sendAudioResult(chatId: string, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<boolean> {
  if (!agentResult.audioUrl) return false;

  // For multi-step, audio is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    logger.debug(`⏭️ [Agent] Skipping audio send - already sent in multi-step`);
    return false;
  }

  logger.debug(`🎵 [Agent] Sending generated audio: ${agentResult.audioUrl}`);
  // Audio doesn't support captions - send as file only
  const fullAudioUrl = agentResult.audioUrl.startsWith('http')
    ? agentResult.audioUrl
    : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
  await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '', quotedMessageId || undefined, 1000);

  // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
  return true;
}

/**
 * Send poll result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
export async function sendPollResult(chatId: string, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<boolean> {
  if (!agentResult.poll) return false;

  // For multi-step, poll is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
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

/**
 * Send location result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
export async function sendLocationResult(chatId: string, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<boolean> {
  if (!agentResult.latitude || !agentResult.longitude) return false;

  // For multi-step, location is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
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

/**
 * Send single-step text result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {boolean} mediaSent - Whether media was already sent
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
export async function sendSingleStepText(chatId: string, agentResult: AgentResult, mediaSent: boolean, quotedMessageId: string | null = null): Promise<void> {
  // CRITICAL: If tool failed and error was already sent, don't send Gemini's error text
  // This prevents duplicate error messages (one from tool, one from Gemini final response)
  const hasToolError = agentResult.toolResults && 
                       Object.values(agentResult.toolResults).some((result: any) => result?.error);
  
  if (hasToolError) {
    logger.debug(`⚠️ [Result Handling] Tool error detected - skipping Gemini final text to avoid duplicate`);
    return;
  }
  
  // Single-step: If no media was sent and it's not multi-step, send text response
  if (!agentResult.multiStep && !mediaSent && agentResult.text && agentResult.text.trim()) {
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (!multipleTools) {
      // Single tool → safe to send text
      const cleanText = cleanAgentText(agentResult.text);
      if (cleanText) {
        await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId || undefined, 1000);
      }
    } else {
      logger.debug(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
    }
  }
}

/**
 * Handle post-processing: generate complementary image if text+image requested
 * @param {string} chatId - Chat ID
 * @param {Object} normalized - Normalized input
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
export interface NormalizedInput {
    userText?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
    hasAudio?: boolean;
    imageUrl?: string | null;
    videoUrl?: string | null;
    audioUrl?: string | null;
    quotedContext?: unknown;
    originalMessageId?: string;
    chatType?: string;
    language?: string;
    authorizations?: Record<string, boolean | null>; // Updated to match usage
    [key: string]: unknown;
}

export async function handlePostProcessing(chatId: string, normalized: NormalizedInput, agentResult: AgentResult, quotedMessageId: string | null = null): Promise<void> {
  try {
    const userText = normalized.userText || '';

    // זיהוי בקשה לטקסט (ספר/כתוב/תאר/תגיד/אמור/describe/tell/write)
    const wantsText = /(ספר|תספר|כתוב|תכתוב|תכתבי|תכתבו|תאר|תארי|תארו|הסבר|תסביר|תסבירי|תגיד|תגידי|תאמר|תאמרי|ברכה|בדיחה|סיפור|טקסט|describe|tell|write|say|story|joke|text)/i.test(userText);

    // זיהוי בקשה לתמונה (תמונה/ציור/צייר/איור/image/picture/draw)
    const wantsImage = /(תמונה|תמונות|ציור|ציורית|צייר|ציירי|ציירו|תצייר|תציירי|תציירו|אייר|איירי|איירו|איור|איורים|image|images|picture|pictures|photo|photos|drawing|draw|illustration|art|poster|thumbnail)/i.test(userText);

    const imageAlreadyGenerated = !!agentResult.imageUrl;
    const hasTextResponse = agentResult.text && agentResult.text.trim().length > 0;

    if (wantsText && wantsImage && !imageAlreadyGenerated && hasTextResponse) {
      logger.debug('🎯 [Agent Post] Multi-step text+image request detected, but no image was generated. Creating image from text response...');

      // נבנה פרומפט לתמונה שמבוססת על הטקסט שהבוט כבר החזיר (למשל בדיחה)
      const baseText = agentResult.text?.trim();
      if (!baseText) {
        logger.warn('⚠️ [Agent Post] No text in agentResult for image generation');
        return;
      }
      const imagePrompt = `צור תמונה שממחישה בצורה ברורה ומצחיקה את הטקסט הבא (אל תכתוב טקסט בתמונה): """${baseText}"""`;

      // קריאה שנייה לאג'נט – הפעם בקשת תמונה פשוטה בלבד
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageResult: any = await executeAgentQuery(imagePrompt, chatId, {
        input: {
          ...normalized,
          userText: imagePrompt
        },
        lastCommand: null,
        maxIterations: 4
      });

      if (imageResult && (imageResult as AgentResult).success && (imageResult as AgentResult).imageUrl) {
        const result = imageResult as AgentResult;
        logger.debug(`📸 [Agent Post] Sending complementary image generated from text: ${result.imageUrl}`);

        // Clean caption before sending
        let caption = (result.imageCaption || '').trim();
        caption = cleanMediaDescription(caption);
        await greenApiService.sendFileByUrl(
          chatId,
          result.imageUrl!,
          `agent_image_${Date.now()}.png`,
          caption,
          quotedMessageId || undefined,
          1000
        );
      } else {
        logger.warn('⚠️ [Agent Post] Failed to generate complementary image for text+image request');
      }
    }
  } catch (postError: unknown) {
    const errorMessage = postError instanceof Error ? postError.message : String(postError);
    const errorStack = postError instanceof Error ? postError.stack : undefined;
    logger.error('❌ [Agent Post] Error while handling text+image multi-step fallback:', { error: errorMessage, stack: errorStack });
  }
}

/**
 * Save bot response to conversation history
 * @param {string} _chatId - Chat ID
 * @param {Object} _agentResult - Agent result
 */
export async function saveBotResponse(_chatId: string, _agentResult: AgentResult): Promise<void> {
  // NOTE: Bot messages are no longer saved to DB to avoid duplication.
  // Bot messages are tracked in DB (message_types table) when sent through Green API,
  // and retrieved from Green API getChatHistory when needed.
  // This approach:
  // - Eliminates duplication (messages exist only in Green API)
  // - Reduces DB size (no message content stored, only type metadata)
  // - Provides accurate bot message identification via DB (persistent)
  // 
  // Bot messages will be available in get_chat_history via Green API
  // and identified using conversationManager.isBotMessage() (DB-backed)
  logger.debug(`💾 [Agent] Bot response sent (tracked in DB)`);
}

/**
 * Send all agent results (text, media, polls, locations)
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {Object} normalized - Normalized input
 * @returns {Promise<boolean>} True if results were sent successfully
 */
export async function sendAgentResults(chatId: string, agentResult: AgentResult, normalized: NormalizedInput): Promise<boolean> {
  // For multi-step, results are sent immediately after each step in agentService
  // If alreadySent is true, skip sending here to avoid duplicates
  if (agentResult.multiStep && agentResult.alreadySent) {
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
  } else {
    logger.warn(`⚠️ [Multi-step] Text not sent - multiStep: ${agentResult.multiStep}, text: ${!!agentResult.text}, trimmed: ${!!agentResult.text?.trim()}`);
  }

  // CRITICAL: Send media if URLs exist (Rule: Media MUST be sent!)
  if (await sendImageResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendVideoResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
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
  await sendSingleStepText(chatId, agentResult, mediaSent, quotedMessageId);

  // Handle post-processing (complementary image generation)
  await handlePostProcessing(chatId, normalized, agentResult, quotedMessageId);

  // Save bot response to conversation history
  await saveBotResponse(chatId, agentResult);

  logger.info(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
  return true;
}
