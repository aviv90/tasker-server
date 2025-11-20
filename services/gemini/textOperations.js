/**
 * Gemini Text Operations
 * 
 * Text generation, chat, translation, and summarization.
 * Refactored to use modular components (Phase 5.3)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getGeminiErrorMessage, cleanThinkingPatterns } = require('./utils');
const { sanitizeText } = require('../../utils/textSanitizer');
const { detectLanguage } = require('../../utils/agentHelpers');

// Import modular components
const promptBuilder = require('./text/promptBuilder');
const googleSearchProcessor = require('./text/googleSearch');
const thinkingCleanup = require('./text/thinkingCleanup');
const summaryService = require('./text/summary');
const translationService = require('./text/translation');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate text response using Gemini
 */
async function generateTextResponse(prompt, conversationHistory = [], options = {}) {
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
      model: options.model || "gemini-3-pro-preview"
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
    const generateConfig = {
      contents,
      generationConfig: {
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
    let groundingMetadata = null;
    if (useGoogleSearch) {
      groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const searchQueries = response.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;

      if (groundingMetadata) {
        console.log('✅ Google Search was used by Gemini');
        const chunksCount = groundingMetadata.groundingChunks?.length || 0;
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

    if (!response.candidates || response.candidates.length === 0) {
      console.log('❌ Gemini: No candidates returned');
      const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
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
        model: options.model || "gemini-3-pro-preview",
        type: 'text_generation',
        characterCount: text.length,
        created_at: new Date().toISOString()
      }
    };

  } catch (err) {
    console.error('❌ Gemini text generation error:', err);

    // Emergency response
    return {
      text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Gemini. נסה שוב מאוחר יותר.',
      error: err.message || 'Text generation failed'
    };
  }
}

/**
 * Generate chat summary using Gemini
 */
async function generateChatSummary(messages) {
  return await summaryService.generateChatSummary(messages);
}

/**
 * Translate text to target language
 */
async function translateText(text, targetLanguage) {
  return await translationService.translateText(text, targetLanguage);
}

module.exports = {
  generateTextResponse,
  generateChatSummary,
  translateText
};
