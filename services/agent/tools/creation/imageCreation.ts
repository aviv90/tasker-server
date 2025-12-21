import { formatProviderName } from '../../utils/providerUtils';
import { enhancePrompt } from '../../utils/promptEnhancer';
import { getServices } from '../../utils/serviceLoader';
import { cleanMarkdown } from '../../../../utils/textSanitizer';
import { ProviderFallback } from '../../../../utils/providerFallback';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { IMAGE_PROVIDERS, DEFAULT_IMAGE_PROVIDERS, PROVIDERS } from '../../config/constants';
import { REQUIRED, ERROR, PROVIDER_MISMATCH, COMMON } from '../../../../config/messages';
import { createTool } from '../base';
import type { CreateImageArgs, ImageProviderResult } from './types';

/**
 * Tool: Create Image
 */
export const create_image = createTool<CreateImageArgs>(
  {
    name: 'create_image',
    description: 'Create a new image. Default provider: Gemini. Use "provider" arg for others. Use this for "Send [Object/Person]" requests. Important: Do NOT use this for WhatsApp group icons - use create_group instead. CRITICAL: If the user is quoting an image and asks to create/generate based on it, use "edit_image" instead!',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the image to create',
        },
        provider: {
          type: 'string',
          description: 'Provider: gemini (default), openai, or grok',
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
      // The Agent sometimes hallucinates and tries to use sora/veo/kling for images after a video failure
      const videoProviders = ['sora', 'sora-2', 'sora-pro', 'veo', 'veo3', 'kling', 'runway'];
      if (args.provider && videoProviders.includes(args.provider.toLowerCase())) {
        return {
          success: false,
          error: PROVIDER_MISMATCH.VIDEO_PROVIDER_FOR_IMAGE(args.provider)
        };
      }

      const requestedProvider = args.provider ?? null;
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : [...DEFAULT_IMAGE_PROVIDERS];
      const { geminiService, openaiService, grokService } = getServices();


      // ... (existing imports)

      const fallback = new ProviderFallback({
        toolName: 'create_image',
        providersToTry,
        requestedProvider,
        context
      });

      // MAGIC: Enhance prompt before generation
      let prompt = args.prompt.trim();


      try {
        prompt = await enhancePrompt(prompt, 'image');
      } catch (err) {
        logger.warn('Prompt enhancement failed, using original', { error: err });
      }

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
          error: COMMON.NO_PROVIDER_RESPONSE
        };
      }

      if (providerResult.error) {
        const errorMessage =
          typeof providerResult.error === 'string'
            ? providerResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: `${errorMessage} CRITICAL: The user has already been notified of this error via a system message. DO NOT generate a text response apologizing or explaining the error again. Just terminate or wait for new input.`,
          errorsAlreadySent: providerResult.errorsAlreadySent
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
          provider: providerName,
          providerKey: providerKey
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
        provider: providerName,
        providerKey: providerKey
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

