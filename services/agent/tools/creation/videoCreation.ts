/**
 * Video Creation Tools
 * Clean, modular tool definitions following SOLID principles
 */

import { formatProviderName } from '../../utils/providerUtils';
import { getServices } from '../../utils/serviceLoader';
import { ProviderFallback } from '../../../../utils/providerFallback';
import { cleanMarkdown } from '../../../../utils/textSanitizer';
import logger from '../../../../utils/logger';
import * as replicateService from '../../../replicateService';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { VIDEO_PROVIDERS, DEFAULT_VIDEO_PROVIDERS, PROVIDERS } from '../../config/constants';
import { REQUIRED, ERROR } from '../../../../config/messages';
import { TIME } from '../../../../utils/constants'; // Import TIME CONSTANTS
import { createTool } from '../base';
import type {
  CreateVideoArgs,
  ImageToVideoArgs,
  VideoProviderResult
} from './types';

/**
 * Tool: Create Video
 */
export const create_video = createTool<CreateVideoArgs>(
  {
    name: 'create_video',
    description: 'Create a video from text description. Supports Veo3 (Google), Sora (OpenAI), Kling (default).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the desired video'
        },
        provider: {
          type: 'string',
          description: 'Video provider',
          enum: [...VIDEO_PROVIDERS]
        }
      },
      required: ['prompt']
    },
    historyContext: {
      ignore: false,
      reason: 'Keep history to support "make it longer" or "change style" requests based on previous generation.'
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] create_video called with provider: ${args.provider || PROVIDERS.VIDEO.KLING}`, {
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || PROVIDERS.VIDEO.KLING,
      chatId: context.chatId
    });

    try {
      if (!args.prompt) {
        return {
          success: false,
          error: REQUIRED.VIDEO_DESCRIPTION
        };
      }

      const { geminiService, openaiService } = getServices();
      const prompt = args.prompt.trim();
      const requestedProvider = args.provider || null;

      const providersToTry = requestedProvider
        ? [requestedProvider]
        : [...DEFAULT_VIDEO_PROVIDERS];

      // Update expected media type in context
      context.expectedMediaType = 'video';

      const fallback = new ProviderFallback({
        toolName: 'create_video',
        providersToTry,
        requestedProvider,
        context,
        timeout: TIME.VIDEO_GENERATION_TIMEOUT
      });

      const videoResult = (await fallback.tryWithFallback<VideoProviderResult>(async provider => {
        if (provider === PROVIDERS.VIDEO.VEO3) {
          const result = (await geminiService.generateVideoForWhatsApp(prompt)) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        } else if (provider === PROVIDERS.VIDEO.SORA || provider === PROVIDERS.VIDEO.SORA_PRO) {
          const model = provider === PROVIDERS.VIDEO.SORA_PRO ? 'sora-2-pro' : 'sora-2';
          const result = (await openaiService.generateVideoWithSoraForWhatsApp(
            prompt,
            null,
            { model }
          )) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        } else {
          const result = (await replicateService.generateVideoWithTextForWhatsApp(prompt)) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        }
      })) as VideoProviderResult;

      context.expectedMediaType = null;
      if (!videoResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (videoResult.error) {
        const errorMessage =
          typeof videoResult.error === 'string'
            ? videoResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: `${errorMessage} CRITICAL: The user has already been notified of this error via a system message. DO NOT generate a text response apologizing or explaining the error again. Just terminate or wait for new input.`
        };
      }

      const videoProviderKey =
        (videoResult.providerUsed as string | undefined) ||
        requestedProvider ||
        providersToTry[0] ||
        PROVIDERS.VIDEO.KLING;
      const formattedVideoProviderName = formatProviderName(videoProviderKey);
      const providerName =
        typeof formattedVideoProviderName === 'string' && formattedVideoProviderName.length > 0
          ? formattedVideoProviderName
          : videoProviderKey;

      let caption = videoResult.description || videoResult.revisedPrompt || videoResult.caption || '';
      if (caption) {
        caption = cleanMarkdown(caption);
      }

      return {
        success: true,
        data: `✅ הוידאו נוצר בהצלחה עם ${providerName}!`,
        videoUrl: videoResult.videoUrl || videoResult.url,
        videoCaption: caption,
        provider: providerName
      };
    } catch (error) {
      context.expectedMediaType = null;
      logger.error('❌ Error in create_video', {
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

/**
 * Tool: Image to Video
 */
export const image_to_video = createTool<ImageToVideoArgs>(
  {
    name: 'image_to_video',
    description: 'Convert/Animate an image to video. USE THIS when user says "image to video", "animate", or specifies provider. CRITICAL: If prompt contains "Use this image_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL of image to animate. If available in prompt "Use this image_url...", take it from there.'
        },
        prompt: {
          type: 'string',
          description: 'Directives for animation - movement, action, effects'
        },
        provider: {
          type: 'string',
          description: 'Provider: veo3, sora/sora-pro, kling. If user specifies one, use it!',
          enum: [...VIDEO_PROVIDERS]
        }
      },
      required: ['image_url', 'prompt']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] image_to_video called`, {
      imageUrl: args.image_url?.substring(0, 50),
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || PROVIDERS.VIDEO.KLING,
      chatId: context.chatId
    });

    try {
      const { geminiService, openaiService, greenApiService } = getServices();
      const requestedProvider = args.provider || null;

      if (!args.image_url) {
        return {
          success: false,
          error: REQUIRED.IMAGE_URL_FOR_CONVERT
        };
      }
      if (!args.prompt) {
        return {
          success: false,
          error: REQUIRED.ANIMATION_DESCRIPTION
        };
      }

      const imageUrl = args.image_url;
      const prompt = args.prompt.trim();

      const imageBuffer = await greenApiService.downloadFile(imageUrl);

      const providersToTry = requestedProvider
        ? [requestedProvider]
        : [...DEFAULT_VIDEO_PROVIDERS];

      const fallback = new ProviderFallback({
        toolName: 'image_to_video',
        providersToTry,
        requestedProvider,
        context,
        timeout: TIME.VIDEO_GENERATION_TIMEOUT
      });

      const videoResult = (await fallback.tryWithFallback<VideoProviderResult>(async provider => {
        let result: VideoProviderResult & { error?: string };

        if (provider === PROVIDERS.VIDEO.VEO3) {
          result = (await geminiService.generateVideoFromImageForWhatsApp(prompt, imageBuffer)) as VideoProviderResult & { error?: string };
        } else if (provider === PROVIDERS.VIDEO.SORA || provider === PROVIDERS.VIDEO.SORA_PRO) {
          const model = provider === PROVIDERS.VIDEO.SORA_PRO ? 'sora-2-pro' : 'sora-2';
          result = (await openaiService.generateVideoWithSoraFromImageForWhatsApp(
            prompt,
            imageBuffer,
            { model }
          )) as VideoProviderResult & { error?: string };
        } else {
          result = (await replicateService.generateVideoFromImageForWhatsApp(imageBuffer, prompt)) as VideoProviderResult & { error?: string };
        }

        result.providerUsed = provider;
        return result;
      })) as VideoProviderResult;

      if (!videoResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (videoResult.error) {
        const errorMessage =
          typeof videoResult.error === 'string'
            ? videoResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: `${errorMessage} CRITICAL: The user has already been notified of this error via a system message. DO NOT generate a text response apologizing or explaining the error again. Just terminate or wait for new input.`
        };
      }

      const providerKey =
        (videoResult.providerUsed as string | undefined) ||
        requestedProvider ||
        providersToTry[0] ||
        PROVIDERS.VIDEO.KLING;
      const formattedProviderName = formatProviderName(providerKey);
      const providerName =
        typeof formattedProviderName === 'string' && formattedProviderName.length > 0
          ? formattedProviderName
          : providerKey;

      return {
        success: true,
        data: `✅ התמונה הומרה לוידאו בהצלחה עם ${providerName}!`,
        videoUrl: videoResult.videoUrl || videoResult.url,
        provider: providerName
      };
    } catch (error) {
      logger.error('❌ Error in image_to_video', {
        ...formatErrorForLogging(error),
        imageUrl: args.image_url?.substring(0, 50),
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

