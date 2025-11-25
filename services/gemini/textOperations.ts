/**
 * Gemini Text Operations
 * 
 * Text generation, chat, translation, and summarization.
 * Refactored to use modular components (Phase 5.3)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiErrorMessage, cleanThinkingPatterns } from './utils';
import { sanitizeText } from '../../utils/textSanitizer';
import { detectLanguage } from '../../utils/agentHelpers';

// Import modular components
// eslint-disable-next-line @typescript-eslint/no-require-imports
const promptBuilder = require('./text/promptBuilder');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleSearchProcessor = require('./text/googleSearch');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const thinkingCleanup = require('./text/thinkingCleanup');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const summaryService = require('./text/summary');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const translationService = require('./text/translation');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Conversation message
 */
interface ConversationMessage {
  role: string;
  parts: Array<{ text: string }>;
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
    console.log('💬 Gemini text generation');

    // Sanitize prompt
    const cleanPrompt = sanitizeText(prompt);

    // Check if Google Search should be enabled
    const useGoogleSearch = options.useGoogleSearch === true;
    if (useGoogleSearch) {
      console.log('🔍 Google Search enabled for this request');
    }

    const model = genAI.getGenerativeModel({
      model: options.model || "gemini-2.5-flash"
    });

    // Detect user's language
    const detectedLang = detectLanguage(cleanPrompt);

    // Build conversation contents using prompt builder
    const contents = promptBuilder.buildConversationContents(
      cleanPrompt,
      conversationHistory,
      useGoogleSearch,
      detectedLang
    );

    console.log(`🔮 Gemini processing (${Array.isArray(conversationHistory) ? conversationHistory.length : 0} context messages)`);

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
      console.log('🔍 Google Search tool enabled');
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
        console.log('✅ Google Search was used by Gemini');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunksCount = (groundingMetadata as any).groundingChunks?.length || 0;
        console.log(`🔍 Found ${chunksCount} grounding chunks`);

        if (searchQueries) {
          console.log('🔎 Search query executed');
        }
      } else {
        console.warn('⚠️ WARNING: Google Search tool was enabled but Gemini did NOT use it!');
        console.warn('   Gemini likely answered from its training data (2023) instead of searching.');
        console.warn('   User may receive old/broken links.');
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseAny = response as any;
    if (!responseAny.candidates || responseAny.candidates.length === 0) {
      console.log('❌ Gemini: No candidates returned');
      const errorMsg = getGeminiErrorMessage(null, responseAny.promptFeedback);
      return { error: errorMsg };
    }

    let text = response.text();

    if (!text || text.trim().length === 0) {
      console.log('❌ Gemini: Empty text response');
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

    console.log(`✅ Gemini text generated: ${text.substring(0, 100)}...`);

    return {
      text: text,
      originalPrompt: cleanPrompt,
      metadata: {
        service: 'Gemini',
        model: options.model || "gemini-2.5-flash",
        type: 'text_generation',
        characterCount: text.length,
        created_at: new Date().toISOString()
      }
    };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Text generation failed';
    console.error('❌ Gemini text generation error:', err);

    // Emergency response
    return {
      text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Gemini. נסה שוב מאוחר יותר.',
      error: errorMessage
    };
  }
}

/**
 * Generate chat summary using Gemini
 */
export async function generateChatSummary(messages: ConversationMessage[]): Promise<unknown> {
  return await summaryService.generateChatSummary(messages);
}

/**
 * Translate text to target language
 */
export async function translateText(text: string, targetLanguage: string): Promise<unknown> {
  return await translationService.translateText(text, targetLanguage);
}

