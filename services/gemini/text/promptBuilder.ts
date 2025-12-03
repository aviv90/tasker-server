import prompts from '../../../config/prompts';
import logger from '../../../utils/logger';

/**
 * Conversation message
 */
interface ConversationMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

/**
 * Google Search example
 */
interface GoogleSearchExample {
  user: string;
  model: string;
}

/**
 * Prompt building utilities for Gemini text operations
 * Uses SSOT from config/prompts.ts for all prompts
 */

class PromptBuilder {
  /**
   * Build language-specific instruction
   * Uses SSOT from config/prompts.ts
   */
  buildLanguageInstruction(detectedLang: string): string {
    // Use SSOT from config/prompts.ts
    const instruction = prompts.languageInstructions[detectedLang];
    return instruction || prompts.languageInstructions['he'] || 'חשוב מאוד: ענה בעברית בלבד.';
  }

  /**
   * Build system prompt
   */
  buildSystemPrompt(languageInstruction: string, useGoogleSearch = false): string {
    return prompts.googleSearchSystemInstruction(languageInstruction, useGoogleSearch);
  }

  /**
   * Build model response for system prompt acknowledgment
   */
  buildModelResponse(detectedLang: string, useGoogleSearch = false): string {
    return prompts.googleSearchResponse(detectedLang, useGoogleSearch);
  }

  /**
   * Build Google Search example for conversation
   */
  buildGoogleSearchExample(detectedLang: string): GoogleSearchExample {
    return prompts.googleSearchExample(detectedLang);
  }

  /**
   * Build conversation contents for Gemini
   */
  buildConversationContents(
    cleanPrompt: string,
    conversationHistory: ConversationMessage[] = [],
    useGoogleSearch = false,
    detectedLang: string
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Build system prompt
    const languageInstruction = this.buildLanguageInstruction(detectedLang);
    const systemPrompt = this.buildSystemPrompt(languageInstruction, useGoogleSearch);

    // Add system prompt as first user message
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });

    // Add model response
    const modelResponse = this.buildModelResponse(detectedLang, useGoogleSearch);
    contents.push({
      role: 'model',
      parts: [{ text: modelResponse }]
    });

    // Add Google Search example if enabled
    if (useGoogleSearch) {
      const example = this.buildGoogleSearchExample(detectedLang);
      contents.push({
        role: 'user',
        parts: [{ text: example.user }]
      });
      contents.push({
        role: 'model',
        parts: [{ text: example.model }]
      });
    }

    // Normalize conversation history to an array
    if (!Array.isArray(conversationHistory)) {
      conversationHistory = [];
    }

    // Add conversation history if exists
    if (conversationHistory.length > 0) {
      // Keep this low-level log at debug level to avoid noisy production logs
      logger.debug(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);

      for (const msg of conversationHistory) {
        // Convert OpenAI format to Gemini format
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const content = msg.content || '';
        contents.push({
          role: role,
          parts: [{ text: content }]
        });
      }
    }

    // Add current user message
    contents.push({
      role: 'user',
      parts: [{ text: cleanPrompt }]
    });

    return contents;
  }
}

export default new PromptBuilder();

