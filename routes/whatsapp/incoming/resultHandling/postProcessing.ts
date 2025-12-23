/**
 * Result Handling - Post Processing
 * Handles post-processing operations like complementary image generation
 */

import { executeAgentQuery } from '../../../../services/agentService';
import conversationManager from '../../../../services/conversationManager';
import logger from '../../../../utils/logger';
import { AgentResult, NormalizedInput } from './types';
import resultSender from '../../../../services/agent/execution/resultSender';

/**
 * Handle post-processing: generate complementary image if text+image requested
 * @param chatId - Chat ID
 * @param normalized - Normalized input
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 */
export async function handlePostProcessing(
  chatId: string,
  normalized: NormalizedInput,
  agentResult: AgentResult,
  quotedMessageId: string | null = null
): Promise<void> {
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
      // CRITICAL: Mark chat as having active bot operation to prevent ghost sessions
      conversationManager.startBotOperation(chatId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let imageResult: any;
      try {
        imageResult = await executeAgentQuery(imagePrompt, chatId, {
          // For media-only secondary calls, conversation history may confuse the model.
          // We explicitly disable history here to keep the prompt focused on image generation.
          useConversationHistory: false,
          input: {
            ...normalized,
            userText: imagePrompt
          },
          lastCommand: null,
          maxIterations: 4
        });
      } finally {
        // End operation after a delay to allow result sending
        setTimeout(() => {
          conversationManager.endBotOperation(chatId);
        }, 5000);
      }

      if (imageResult && (imageResult as AgentResult).success && (imageResult as AgentResult).imageUrl) {
        const result = imageResult as AgentResult;
        logger.debug(`📸 [Agent Post] Sending complementary image generated from text: ${result.imageUrl}`);

        // Use centralized ResultSender
        // Map AgentResult to StepResult
        const stepResult = {
          ...result,
          text: result.text || '',
          caption: result.caption || result.imageCaption
        };
        await resultSender.sendImage(chatId, stepResult, null, quotedMessageId);
        // Note: textAlreadySent flag not needed here as this is post-processing, not part of main result flow
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

