/**
 * Retry Tools - Single-Step Retry Logic
 * Handles retry of single-step commands for various tools
 */

import logger from '../../../../utils/logger';
import { getServices } from '../../utils/serviceLoader';
import { RetryArgs, ToolContext, LastCommand, ToolResult } from './types';
import { sendRetryAck } from './ack';
import { extractQuotedMessageId } from '../../../../utils/messageHelpers';
import { NOT_FOUND, UNABLE } from '../../../../config/messages';

// Reference to agentTools (will be injected)
let agentTools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }> | null = null;

/**
 * Set agent tools reference (needed for retry)
 */
export function setAgentToolsReference(tools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>): void {
  agentTools = tools;
}

/**
 * Handle single-step command retry
 */
export async function handleSingleStepRetry(
  args: RetryArgs,
  context: ToolContext,
  lastCommand: LastCommand
): Promise<ToolResult> {
  const chatId = context.chatId;
  if (!chatId) {
    return {
      success: false,
      error: NOT_FOUND.CHAT_ID_FOR_RETRY
    };
  }

  const tool = lastCommand.tool;
  const storedWrapper = lastCommand.toolArgs || lastCommand.args || {};
  const originalArgs = storedWrapper as Record<string, unknown>;
  const storedResult = (lastCommand.result || storedWrapper?.result || {}) as Record<string, unknown>;
  
  // Build modified prompt if needed
  let modifiedPrompt = (originalArgs.prompt || originalArgs.text || storedResult.translation || storedResult.translatedText || '') as string;
  if (args.modifications && args.modifications.trim()) {
    modifiedPrompt = modifiedPrompt
      ? `${modifiedPrompt} ${args.modifications}`
      : args.modifications;
  }
  modifiedPrompt = (modifiedPrompt || '').toString().trim();
  
  // Determine provider override
  // CRITICAL: For manual retry, use the SAME provider as the original command
  // Only change provider if user explicitly specified provider_override
  let provider: string | null = args.provider_override || null;
  if (provider === 'none' || !provider) {
    // Keep original provider from the saved command
    provider = (originalArgs.provider || 
               originalArgs.service || 
               storedResult.provider ||
               storedResult.service ||
               null) as string | null;
    
    // If we still don't have a provider, try to infer from tool name
    if (!provider) {
      if (tool.includes('openai')) provider = 'openai';
      else if (tool.includes('grok')) provider = 'grok';
      else if (tool.includes('gemini')) provider = 'gemini';
      else if (tool.includes('sora')) provider = 'sora';
      else if (tool.includes('veo')) provider = 'veo3';
      else if (tool.includes('kling')) provider = 'kling';
    }
  }
  
  // Send specific ACK based on the tool and provider being retried
  const quotedMessageIdForAck = extractQuotedMessageId({ context });
  await sendRetryAck(chatId, tool, provider, quotedMessageIdForAck || null);
  
  // Route to appropriate tool based on last command
  return await routeToTool(tool, modifiedPrompt, originalArgs, storedResult, provider, context);
}

/**
 * Route retry to the appropriate tool
 */
async function routeToTool(
  tool: string,
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  provider: string | null,
  context: ToolContext
): Promise<ToolResult> {
  if (tool === 'gemini_image' || tool === 'openai_image' || tool === 'grok_image' || tool === 'create_image') {
    return await retryImageGeneration(modifiedPrompt, originalArgs, storedResult, provider, context);
  } else if (tool === 'veo3_video' || tool === 'sora_video' || tool === 'kling_text_to_video' || tool === 'create_video') {
    return await retryVideoGeneration(modifiedPrompt, originalArgs, storedResult, provider, context);
  } else if (tool === 'edit_image') {
    return await retryImageEditing(modifiedPrompt, originalArgs, storedResult, provider, context);
  } else if (tool === 'gemini_chat' || tool === 'openai_chat' || tool === 'grok_chat') {
    return await retryChat(modifiedPrompt, tool, provider);
  } else if (tool === 'text_to_speech') {
    return await retryTTS(modifiedPrompt, originalArgs, storedResult, context);
  } else if (tool === 'music_generation' || tool === 'create_music') {
    return await retryMusicGeneration(modifiedPrompt, originalArgs, storedResult, context);
  } else if (tool === 'translate_text') {
    return await retryTranslation(originalArgs, storedResult, context);
  } else if (tool === 'create_poll') {
    return await retryPoll(modifiedPrompt, originalArgs, context);
  } else {
    // Generic retry - just return info about what was done
    return {
      success: true,
      data: `הפקודה האחרונה הייתה: ${tool}\n\nלא יכול לחזור עליה אוטומטית, אבל אתה יכול לבקש אותה שוב ישירות.`,
      lastTool: tool,
      lastArgs: originalArgs
    };
  }
}

/**
 * Retry image generation
 */
async function retryImageGeneration(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  provider: string | null,
  context: ToolContext
): Promise<ToolResult> {
  const promptToUse = modifiedPrompt || (originalArgs.prompt || originalArgs.text || storedResult.prompt || '') as string;
  if (!promptToUse) {
    return {
      success: false,
      error: UNABLE.RESTORE_PROMPT
    };
  }
  
  const imageArgs = {
    prompt: promptToUse,
    provider: provider || 'gemini'
  };
  
  if (provider) {
    logger.info(`🔄 [Retry] Using original provider: ${provider}`);
  } else {
    logger.warn(`⚠️ [Retry] Original provider not found, using default: gemini`);
  }
  
  logger.debug(`🎨 Retrying image generation with:`, imageArgs);
  if (!agentTools?.create_image) {
    return { success: false, error: 'כלי יצירת תמונה לא זמין' };
  }
  return await agentTools.create_image.execute(imageArgs, context) as ToolResult;
}

/**
 * Retry video generation
 */
async function retryVideoGeneration(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  provider: string | null,
  context: ToolContext
): Promise<ToolResult> {
  const promptToUse = modifiedPrompt || (originalArgs.prompt || originalArgs.text || storedResult.prompt || '') as string;
  if (!promptToUse) {
    return {
      success: false,
      error: UNABLE.RESTORE_VIDEO_PROMPT
    };
  }
  
  const videoArgs = {
    prompt: promptToUse,
    provider: provider || 'kling'
  };
  
  if (provider) {
    logger.info(`🔄 [Retry] Using original provider: ${provider}`);
  } else {
    logger.warn(`⚠️ [Retry] Original provider not found, using default: kling`);
  }
  
  logger.debug(`🎬 Retrying video generation with:`, videoArgs);
  if (!agentTools?.create_video) {
    return { success: false, error: 'כלי יצירת וידאו לא זמין' };
  }
  return await agentTools.create_video.execute(videoArgs, context) as ToolResult;
}

/**
 * Retry image editing
 */
async function retryImageEditing(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  provider: string | null,
  context: ToolContext
): Promise<ToolResult> {
  const editInstruction = modifiedPrompt || (originalArgs.edit_instruction || originalArgs.prompt || '') as string;
  const imageUrl = (originalArgs.image_url || storedResult.imageUrl || '') as string;
  
  if (!editInstruction || !imageUrl) {
    return {
      success: false,
      error: UNABLE.RESTORE_EDIT_INSTRUCTIONS
    };
  }
  
  const editArgs = {
    image_url: imageUrl,
    edit_instruction: editInstruction,
    service: provider || (originalArgs.service || 'openai') as string
  };
  
  if (provider || originalArgs.service) {
    logger.info(`🔄 [Retry] Using original service: ${provider || originalArgs.service}`);
  } else {
    logger.warn(`⚠️ [Retry] Original service not found, using default: openai`);
  }
  
  logger.debug(`✏️ Retrying image edit with:`, editArgs);
  if (!agentTools?.edit_image) {
    return { success: false, error: 'כלי עריכת תמונה לא זמין' };
  }
  return await agentTools.edit_image.execute(editArgs, context) as ToolResult;
}

/**
 * Retry chat
 */
async function retryChat(
  modifiedPrompt: string,
  tool: string,
  provider: string | null
): Promise<ToolResult> {
  const chatProvider = provider || (tool.includes('openai') ? 'openai' : tool.includes('grok') ? 'grok' : 'gemini');
  
  const { geminiService, openaiService, grokService } = getServices();
  
  let result;
  if (chatProvider === 'openai') {
    result = await openaiService.generateTextResponse(modifiedPrompt, []);
  } else if (chatProvider === 'grok') {
    result = await grokService.generateTextResponse(modifiedPrompt, []);
  } else {
    result = await geminiService.generateTextResponse(modifiedPrompt, []);
  }
  
  return {
    success: !(result as { error?: string }).error,
    data: ((result as { text?: string; error?: string }).text || (result as { error?: string }).error) as string,
    error: (result as { error?: string }).error
  };
}

/**
 * Retry TTS
 */
async function retryTTS(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const textToSpeak = modifiedPrompt || (originalArgs.text || storedResult.translation || storedResult.translatedText || '') as string;
  if (!textToSpeak) {
    return {
      success: false,
      error: UNABLE.RESTORE_TTS_TEXT
    };
  }
  if (!agentTools?.text_to_speech) {
    return { success: false, error: 'כלי TTS לא זמין' };
  }
  return await agentTools.text_to_speech.execute({
    text: textToSpeak,
    target_language: (originalArgs.target_language || originalArgs.language || 'he') as string
  }, context) as ToolResult;
}

/**
 * Retry music generation
 */
async function retryMusicGeneration(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const promptToUse = modifiedPrompt || (originalArgs.prompt || storedResult.prompt || originalArgs.text || '') as string;
  if (!promptToUse) {
    return {
      success: false,
      error: UNABLE.RESTORE_MUSIC_PROMPT
    };
  }
  if (!agentTools?.create_music) {
    return { success: false, error: 'כלי יצירת מוזיקה לא זמין' };
  }
  return await agentTools.create_music.execute({
    prompt: promptToUse
  }, context) as ToolResult;
}

/**
 * Retry translation
 */
async function retryTranslation(
  originalArgs: Record<string, unknown>,
  storedResult: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const translationArgs = {
    text: (originalArgs.text || storedResult.originalText || originalArgs.prompt || '') as string,
    target_language: (originalArgs.target_language || originalArgs.language || storedResult.target_language || storedResult.language || 'he') as string
  };
  
  if (!translationArgs.text || !translationArgs.target_language) {
    return {
      success: false,
      error: UNABLE.RESTORE_TRANSLATION
    };
  }
  if (!agentTools?.translate_text) {
    return { success: false, error: 'כלי תרגום לא זמין' };
  }
  return await agentTools.translate_text.execute(translationArgs, context) as ToolResult;
}

/**
 * Retry poll creation
 */
async function retryPoll(
  modifiedPrompt: string,
  originalArgs: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const topicToUse = modifiedPrompt || (originalArgs.topic || originalArgs.prompt || '') as string;
  if (!topicToUse) {
    return {
      success: false,
      error: UNABLE.RESTORE_POLL_TOPIC
    };
  }
  if (!agentTools?.create_poll) {
    return { success: false, error: 'כלי יצירת סקר לא זמין' };
  }
  return await agentTools.create_poll.execute({
    topic: topicToUse
  }, context) as ToolResult;
}

