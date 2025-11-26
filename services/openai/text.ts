/**
 * OpenAI Text Generation Service
 * 
 * Handles text generation using OpenAI Chat API.
 * Extracted from openaiService.js (Phase 5.3)
 */

import OpenAI from 'openai';
import { detectLanguage } from '../../utils/agentHelpers';
import prompts from '../../config/prompts';
import logger from '../../utils/logger';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Message in conversation history
 */
interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Text generation result
 */
interface TextGenerationResult {
    text: string;
    usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    } | null;
}

/**
 * Generate text response using OpenAI Chat API with conversation history
 */
export async function generateTextResponse(
    prompt: string,
    conversationHistory: ConversationMessage[] = []
): Promise<TextGenerationResult> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Detect user's language to ensure response matches input language
    const detectedLang = detectLanguage(prompt);
    
    // Build language-specific system prompt (SSOT - from config/prompts.js)
    const systemContent = prompts.openaiSystemInstruction(detectedLang);

    // Build messages array - OPTIMIZED
    const messages: ConversationMessage[] = [
      {
        role: 'system',
        content: systemContent
      }
    ];

    // Add conversation history if exists
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
      logger.debug(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: prompt
    });

    logger.debug(`🤖 OpenAI processing (${conversationHistory.length} context messages)`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective and good model
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    const aiResponse = response.choices[0]?.message?.content;
    const usage = response.usage;

    if (!aiResponse) {
      throw new Error('No response from OpenAI');
    }

    logger.info('✅ OpenAI Chat response received', { usage });

    return {
      text: aiResponse,
      usage: usage || null
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error generating OpenAI response:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    
    // Emergency response
    return {
      text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך. נסה שוב מאוחר יותר.',
      usage: null
    };
  }
}

