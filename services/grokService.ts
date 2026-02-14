/**
 * Grok AI Service
 * Integration with x.ai Grok API for text, image, and video workflows
 * 
 * Text generation lives here; image and video are delegated to sub-modules.
 * Re-exports everything for backward compatibility.
 */

import { sanitizeText } from '../utils/textSanitizer';
import { detectLanguage } from './agent/utils/languageUtils';
import prompts from '../config/prompts';
import logger from '../utils/logger';
import { API_URLS, TIME } from '../utils/constants';
import { ERROR } from '../config/messages';

// Re-export image and video services for backward compatibility
export { generateImageForWhatsApp } from './grok/grokImageService';
export { generateVideoForWhatsApp, generateVideoFromImageForWhatsApp } from './grok/grokVideoService';
export type { ImageGenerationResult } from './grok/grokImageService';
export type { VideoGenerationResult } from './grok/grokVideoService';

/**
 * Conversation message structure
 */
interface ConversationMessage {
  role: string;
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
  originalPrompt?: string;
  error?: string;
  metadata?: {
    service: string;
    model: string;
    type: string;
    characterCount?: number;
    created_at: string;
  };
}

class GrokService {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROK_API_KEY;
    this.baseUrl = API_URLS.GROK;
    this.model = 'grok-4'; // Latest reasoning model

    if (!this.apiKey) {
      logger.warn('⚠️ GROK_API_KEY not found in environment variables');
    } else {
      logger.info('🤖 Grok service initialized');
    }
  }

  /**
   * Generate text response using Grok with conversation history support
   * @param prompt - User's input text
   * @param conversationHistory - Previous messages in conversation
   * @returns Response with text and usage info
   */
  async generateTextResponse(prompt: string, conversationHistory: ConversationMessage[] = []): Promise<TextGenerationResult> {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key not configured');
      }

      // Sanitize prompt
      const cleanPrompt = sanitizeText(prompt);

      // Detect user's language to ensure response matches input language
      const detectedLang = detectLanguage(cleanPrompt);

      // Build language-specific system prompt (SSOT - from config/prompts.ts)
      const systemContent = prompts.grokSystemInstruction(detectedLang);

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
        content: cleanPrompt
      });

      logger.debug(`🤖 Grok processing (${conversationHistory.length} context messages)`);

      // Make API request to Grok
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIME.CIRCUIT_BREAKER_TIMEOUT);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7,
            stream: false
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('❌ Grok API error:', { status: response.status, error: errorData });
        throw new Error(`Grok API error: ${response.status} - ${errorData}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response choices from Grok API');
      }

      const aiResponse = data.choices[0]?.message?.content || '';
      const usage = data.usage || null;

      logger.info('✅ Grok response received', { usage });

      return {
        text: aiResponse.trim(),
        usage: usage,
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: this.model,
          type: 'text_generation',
          characterCount: aiResponse.length,
          created_at: new Date().toISOString()
        }
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error generating Grok response:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });

      // Emergency response
      return {
        text: ERROR.emergencyResponse('Grok'),
        error: errorMessage,
        usage: null
      };
    }
  }
}

// Create and export instance
const grokService = new GrokService();

export const generateTextResponse = grokService.generateTextResponse.bind(grokService);
