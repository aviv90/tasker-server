/**
 * Gemini Text Operations
 * 
 * Text generation, chat, translation, and summarization.
 * Refactored to use modular components (Phase 5.3)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiErrorMessage, cleanThinkingPatterns } from './utils';
import { sanitizeText } from '../../utils/textSanitizer';
import { detectLanguage } from '../agent/utils/languageUtils';
import logger from '../../utils/logger';
import { ERROR } from '../../config/messages';

// Import modular components
import promptBuilder from './text/promptBuilder';
import googleSearchProcessor from './text/googleSearch';
import thinkingCleanup from './text/thinkingCleanup';
import summaryService from './text/summary';
import translationService from './text/translation';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Conversation message
 */
interface ConversationMessage {
  role: string;
  parts?: Array<{ text: string }>;
  content?: string; // For compatibility with other services
  [key: string]: unknown;
}

/**
 * Text generation options
 */
interface TextGenerationOptions {
  useGoogleSearch?: boolean;
  model?: string;
  [key: string]: unknown;
}

/**
 * Text generation result
 */
interface TextGenerationResult {
  text?: string;
  originalPrompt?: string;
  metadata?: {
    service: string;
    model: string;
    type: string;
    characterCount: number;
    created_at: string;
  };
  error?: string;
}

/**
 * Generate text response using Gemini
 */
export async function generateTextResponse(
  prompt: string,
  conversationHistory: ConversationMessage[] = [],
  options: TextGenerationOptions = {}
): Promise<TextGenerationResult> {
  try {
    logger.info('💬 Gemini text generation');

    // Sanitize prompt
    const cleanPrompt = sanitizeText(prompt);

    // Check if Google Search should be enabled
    const useGoogleSearch = options.useGoogleSearch === true;
    if (useGoogleSearch) {
      logger.info('🔍 Google Search enabled for this request');
    }

    const model = genAI.getGenerativeModel({
      model: options.model || "gemini-2.5-pro"
    });

    // Detect user's language
    const detectedLang = detectLanguage(cleanPrompt);

    // Standardize conversation history
    const standardizedHistory = conversationHistory.map(msg => {
      if (msg.parts) return msg;
      return {
        role: msg.role,
        parts: [{ text: msg.content || '' }],
        content: msg.content || '' // Ensure content is present
      };
    }) as Array<ConversationMessage>;

    // Build conversation contents using prompt builder
    const contents = promptBuilder.buildConversationContents(
      cleanPrompt,
      standardizedHistory as any,
      useGoogleSearch,
      detectedLang
    );

    logger.info(`🔮 Gemini processing (${Array.isArray(conversationHistory) ? conversationHistory.length : 0} context messages)`);

    // Build generation config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generateConfig: any = {
      contents,
      generationConfig: {
        temperature: useGoogleSearch ? 0.3 : 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048
      }
    };

    // Add Google Search tool if requested
    if (useGoogleSearch) {
      generateConfig.tools = [{
        googleSearch: {}
      }];
      logger.info('🔍 Google Search tool enabled');
    }

    // Generate response
    const result = await model.generateContent(generateConfig);
    const response = result.response;

    // Log if Google Search was actually used and extract grounding metadata
    let groundingMetadata: unknown = null;
    if (useGoogleSearch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      groundingMetadata = responseAny.candidates?.[0]?.groundingMetadata;
      const searchQueries = responseAny.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;

      if (groundingMetadata) {
        logger.info('✅ Google Search was used by Gemini');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunksCount = (groundingMetadata as any).groundingChunks?.length || 0;
        logger.info(`🔍 Found ${chunksCount} grounding chunks`);

        if (searchQueries) {
          logger.info('🔎 Search query executed');
        }
      } else {
        logger.warn('⚠️ WARNING: Google Search tool was enabled but Gemini did NOT use it!');
        logger.warn('   Gemini likely answered from its training data (2023) instead of searching.');
        logger.warn('   User may receive old/broken links.');
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseAny = response as any;
    if (!responseAny.candidates || responseAny.candidates.length === 0) {
      logger.warn('❌ Gemini: No candidates returned');
      const errorMsg = getGeminiErrorMessage(null, responseAny.promptFeedback);
      return { error: errorMsg };
    }

    let text = response.text();

    if (!text || text.trim().length === 0) {
      logger.warn('❌ Gemini: Empty text response');
      return { error: 'Empty response from Gemini' };
    }

    // Clean up verbose thinking patterns
    text = text.trim();
    text = cleanThinkingPatterns(text);
    text = thinkingCleanup.clean(text);

    // Process Google Search results (redirect resolution, URL formatting, validation)
    if (useGoogleSearch) {
      text = await googleSearchProcessor.processTextWithGoogleSearch(
        text,
        groundingMetadata,
        useGoogleSearch
      );
    } else {
      // Still fix URL formatting even without Google Search
      text = googleSearchProcessor.fixUrlFormatting(text);
    }

    logger.info(`✅ Gemini text generated: ${text.substring(0, 100)}...`);

    return {
      text: text,
      originalPrompt: cleanPrompt,
      metadata: {
        service: 'Gemini',
        model: options.model || "gemini-2.5-pro",
        type: 'text_generation',
        characterCount: text.length,
        created_at: new Date().toISOString()
      }
    };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Text generation failed';
    logger.error('❌ Gemini text generation error:', err as Error);

    // Emergency response
    return {
      text: ERROR.emergencyResponse('Gemini'),
      error: errorMessage
    };
  }
}

/**
 * Generate chat summary using Gemini
 * Accepts any[] because it handles GreenAPI message format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateChatSummary(messages: any[]): Promise<unknown> {
  return await summaryService.generateChatSummary(messages);
}

/**
 * Translate text to target language
 */
export async function translateText(text: string, targetLanguage: string): Promise<unknown> {
  return await translationService.translateText(text, targetLanguage);
}
