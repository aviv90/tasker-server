/**
 * Search Tools - Web search capabilities
 * Clean, modular tool definitions following SOLID principles
 */


import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import prompts from '../../../config/prompts';
import { getLanguageInstruction } from '../utils/languageUtils';
import { REQUIRED, ERROR } from '../../../config/messages';

type AgentToolContext = {
  chatId?: string;
  originalInput?: {
    language?: string;
  };
  normalized?: {
    language?: string;
  };
};

type SearchWebArgs = {
  query?: string;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
}>;

// Initialize Gemini client for search_web (Google Search)

/**
 * Tool: search_web
 */
export const search_web = {
  declaration: {
    name: 'search_web',
    description: 'Search the internet using Google Search. Use for real-time information (news, weather, time) and finding links.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "latest news Israel", "weather Tel Aviv", "Youtube link for X")'
        }
      },
      required: ['query']
    }
  },
  execute: async (args: SearchWebArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] search_web called with query: ${args.query}`);

    try {
      if (!args.query) {
        return {
          success: false,
          error: REQUIRED.SEARCH_QUERY
        };
      }

      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      const normalizedLanguage = typeof language === 'string' ? language.toLowerCase() : 'he';
      const languageInstruction = getLanguageInstruction(normalizedLanguage);

      // Use SSOT from config/prompts.ts
      const systemInstruction = prompts.searchSystemInstruction(args.query, languageInstruction);

      const { geminiService } = getServices();
      const result = (await geminiService.generateTextResponse(args.query, [], {
        useGoogleSearch: true,
        systemInstruction
      })) as { text: string; error?: string };

      if (result.error) {
        return {
          success: false,
          error: result.error
        };
      }

      logger.info(`✅ [search_web] Got result (${result.text?.length || 0} chars)`);

      return {
        success: true,
        data: result.text
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in search_web tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.search(err.message)
      };
    }
  }
};

// ES6 exports only - CommonJS not needed in TypeScript
export default { search_web };

