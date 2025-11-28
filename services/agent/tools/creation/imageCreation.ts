/**
 * Image Creation Tool
 * Clean, modular tool definition following SOLID principles
 */

import { formatProviderName } from '../../utils/providerUtils';
import { getServices } from '../../utils/serviceLoader';
import { cleanMarkdown } from '../../../../utils/textSanitizer';
import { ProviderFallback } from '../../../../utils/providerFallback';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { IMAGE_PROVIDERS, DEFAULT_IMAGE_PROVIDERS, PROVIDERS } from '../../config/constants';
import type {
  AgentToolContext,
  ToolResult,
  CreateImageArgs,
  ImageProviderResult
} from './types';

/**
 * Tool: Create Image
 */
export const create_image = {
  declaration: {
    name: 'create_image',
    description: 'צור תמונה חדשה. ברירת מחדל: Gemini. אם תרצה ספק אחר, ציין בפרמטר provider.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'תיאור התמונה ליצירה',
        },
        provider: {
          type: 'string',
          description: 'ספק ליצירה: gemini (ברירת מחדל), openai, או grok',
          enum: [...IMAGE_PROVIDERS]
        }
      },
      required: ['prompt']
    }
  },
  execute: async (args: CreateImageArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] create_image called`, { 
      prompt: args.prompt?.substring(0, 100), 
      provider: args.provider,
      chatId: context?.chatId 
    });
    
    try {
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה לספק תיאור לתמונה'
        };
      }

      if (context?.expectedMediaType === 'video') {
        return {
          success: false,
          error: 'התבקשת ליצור וידאו, לא תמונה. בחר ספק וידאו מתאים או נסה שוב.'
        };
      }

      const requestedProvider = args.provider ?? null;
      // If user requested a specific provider, only try that one (no fallback)
      // If no provider specified (default), try all providers with fallback
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : [...DEFAULT_IMAGE_PROVIDERS];
      const { geminiService, openaiService, grokService } = getServices();
      
      // Use ProviderFallback utility for DRY code
      const fallback = new ProviderFallback({
        toolName: 'create_image',
        providersToTry,
        requestedProvider,
        context
      });
      
      const prompt = args.prompt.trim();
      const providerResult = (await fallback.tryWithFallback<ImageProviderResult>(async provider => {
        let imageResult: ImageProviderResult;
        if (provider === PROVIDERS.IMAGE.OPENAI) {
          imageResult = (await openaiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        } else if (provider === PROVIDERS.IMAGE.GROK) {
          imageResult = (await grokService.generateImageForWhatsApp(prompt)) as ImageProviderResult;
        } else {
          imageResult = (await geminiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        }
        imageResult.providerUsed = provider;
        return imageResult;
      })) as ImageProviderResult;

      if (!providerResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (providerResult.error) {
        const errorMessage =
          typeof providerResult.error === 'string'
            ? providerResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: errorMessage
        };
      }

      const providerKey =
        (providerResult.providerUsed as string | undefined) ||
        requestedProvider ||
        providersToTry[0] ||
        PROVIDERS.IMAGE.GEMINI;
      const formattedProviderName = formatProviderName(providerKey);
      const providerName =
        typeof formattedProviderName === 'string' && formattedProviderName.length > 0
          ? formattedProviderName
          : providerKey;

      if (providerResult.textOnly) {
        let text = providerResult.description || '';
        if (text) {
          text = cleanMarkdown(text);
        }
        return {
          success: true,
          data: text,
          provider: providerName
        };
      }

      let caption = providerResult.description || providerResult.revisedPrompt || '';
      if (caption) {
        caption = cleanMarkdown(caption);
      }

      return {
        success: true,
        // No generic success message - image is sent with caption, no need for redundant text
        imageUrl: providerResult.imageUrl,
        imageCaption: caption,
        provider: providerName
      };
    } catch (error) {
      logger.error('❌ Error in create_image tool', {
        ...formatErrorForLogging(error),
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

