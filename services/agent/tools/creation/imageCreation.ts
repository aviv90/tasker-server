import { formatProviderName } from '../../utils/providerUtils';
import { enhancePrompt } from '../../utils/promptEnhancer';
import { getServices } from '../../utils/serviceLoader';
import { cleanMarkdown } from '../../../../utils/textSanitizer';
import logger from '../../../../utils/logger';
import { formatErrorForLogging, formatProviderError } from '../../../../utils/errorHandler';
import { IMAGE_PROVIDERS, PROVIDERS } from '../../config/constants';
import { REQUIRED, ERROR, PROVIDER_MISMATCH, AGENT_INSTRUCTIONS } from '../../../../config/messages';
import { createTool } from '../base';
import type { CreateImageArgs, ImageProviderResult } from './types';

import { cleanPromptFromContext } from '../../utils/promptCleaner';

/**
 * Tool: Create Image
 * 
 * Default provider: Gemini
 * No automatic fallbacks - user can use retry_last_command for manual retry
 */
export const create_image = createTool<CreateImageArgs>(
  {
    name: 'create_image',
    description: 'Create a new image. Default provider: Gemini. Enforced Rule: NO AUTOMATIC FALLBACKS. If Gemini fails, STOP. Use "provider" arg ONLY if user explicitly asks for "OpenAI" or "Grok". Important: Do NOT use this for WhatsApp group icons - use create_group instead. CRITICAL: If the user is quoting an image and asks to create/generate based on it, use "edit_image" instead!',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the image to create',
        },
        provider: {
          type: 'string',
          description: 'Optional. LEAVE EMPTY for default (Gemini). Only set if user SPECIFICALLY asks for "OpenAI" or "Grok".',
          enum: [...IMAGE_PROVIDERS]
        }
      },
      required: ['prompt']
    },
    historyContext: {
      ignore: false,
      reason: 'Keep history for context like "similar to the last one".'
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] create_image called`, {
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider,
      chatId: context.chatId
    });

    try {
      if (!args.prompt) {
        return {
          success: false,
          error: REQUIRED.IMAGE_DESCRIPTION
        };
      }

      if (context.expectedMediaType === 'video') {
        return {
          success: false,
          error: PROVIDER_MISMATCH.EXPECTED_VIDEO
        };
      }

      // Validate provider: Block Video providers for Image generation
      const videoProviders = ['sora', 'sora-2', 'sora-pro', 'veo', 'veo3', 'kling', 'runway'];
      if (args.provider && videoProviders.includes(args.provider.toLowerCase())) {
        return {
          success: false,
          error: PROVIDER_MISMATCH.VIDEO_PROVIDER_FOR_IMAGE(args.provider)
        };
      }

      // Determine provider: user-requested or default (Gemini)
      const provider = args.provider || PROVIDERS.IMAGE.GEMINI;
      const { geminiService, openaiService, grokService, greenApiService } = getServices();

      // Clean prompt from any context markers that may have leaked
      let prompt = cleanPromptFromContext(args.prompt.trim());

      // MAGIC: Enhance prompt before generation
      try {
        prompt = await enhancePrompt(prompt, 'image');
      } catch (err) {
        logger.warn('Prompt enhancement failed, using original', { error: err });
      }

      logger.info(`🎨 [create_image] Generating with provider: ${provider}`);

      // Generate image with selected provider (no fallback)
      let imageResult: ImageProviderResult;
      try {
        if (provider === PROVIDERS.IMAGE.OPENAI) {
          imageResult = (await openaiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        } else if (provider === PROVIDERS.IMAGE.GROK) {
          imageResult = (await grokService.generateImageForWhatsApp(prompt)) as ImageProviderResult;
        } else {
          // Default: Gemini
          imageResult = (await geminiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        }
      } catch (genError) {
        const errorMessage = genError instanceof Error ? genError.message : String(genError);
        logger.error(`❌ [create_image] ${provider} generation failed:`, { error: errorMessage });

        // Send error to user
        if (context.chatId) {
          const formattedError = formatProviderError(provider, errorMessage, 'he');
          await greenApiService.sendTextMessage(context.chatId, formattedError, undefined, 1000);
        }

        return {
          success: false,
          error: `${errorMessage} ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`,
          errorsAlreadySent: true
        };
      }

      // Handle error response
      if (imageResult.error) {
        const errorMessage = typeof imageResult.error === 'string'
          ? imageResult.error
          : 'הבקשה נכשלה אצל הספק המבוקש';

        // Send error to user
        if (context.chatId) {
          const formattedError = formatProviderError(provider, errorMessage, 'he');
          await greenApiService.sendTextMessage(context.chatId, formattedError, undefined, 1000);
        }

        return {
          success: false,
          error: `${errorMessage} ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`,
          errorsAlreadySent: true
        };
      }

      const providerName = formatProviderName(provider) || provider;

      // Handle text-only response - REJECT (Prevents ASCII art/refusal leakage)
      if (imageResult.textOnly) {
        logger.warn(`⚠️ [create_image] Provider ${provider} returned text instead of image. Prompt: "${prompt}"`);
        return {
          success: false,
          error: `הספק ${providerName} החזיר טקסט במקום תמונה. ייתכן שהתוכן אינו הולם או שהספק אינו זמין כעת.`
        };
      }

      let caption = imageResult.description || imageResult.revisedPrompt || '';
      if (caption) {
        caption = cleanMarkdown(caption);
      }

      return {
        success: true,
        imageUrl: imageResult.imageUrl,
        imageCaption: caption,
        provider: providerName,
        providerKey: provider
      };
    } catch (error) {
      logger.error('❌ Error in create_image tool', {
        ...formatErrorForLogging(error),
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context.chatId
      });
      return {
        success: false,
        error: ERROR.generic(error instanceof Error ? error.message : String(error))
      };
    }
  }
);

