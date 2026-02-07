/**
 * Video Creation Tools
 * 
 * Default provider: Veo 3
 * No automatic fallbacks - user can use retry_with_different_provider for manual switching
 */

import { formatProviderName } from '../../utils/providerUtils';
import { enhancePrompt } from '../../utils/promptEnhancer';
import { getServices } from '../../utils/serviceLoader';
import { cleanMarkdown } from '../../../../utils/textSanitizer';
import logger from '../../../../utils/logger';
import * as replicateService from '../../../replicateService';
import * as grokService from '../../../grokService';
import { formatErrorForLogging, formatProviderError } from '../../../../utils/errorHandler';
import { VIDEO_PROVIDERS, PROVIDERS } from '../../config/constants';
import { REQUIRED, ERROR, PROVIDER_MISMATCH, AGENT_INSTRUCTIONS } from '../../../../config/messages';
import { createTool } from '../base';
import type {
  CreateVideoArgs,
  ImageToVideoArgs,
  VideoProviderResult
} from './types';

/**
 * Clean prompt from context markers that may leak from conversation history
 */
function cleanPromptFromContext(prompt: string): string {
  return prompt
    // Remove quoted message markers
    .replace(/\[הודעה מצוטטת:[^\]]*\]/g, '')
    .replace(/\[בקשה נוכחית:\]/g, '')
    // Remove IMPORTANT instructions meant for LLM
    .replace(/\*\*IMPORTANT:[^*]*\*\*/g, '')
    .replace(/\*\*CRITICAL:[^*]*\*\*/g, '')
    // Remove image_url/video_url instructions
    .replace(/Use this image_url parameter directly:[^\n]*/gi, '')
    .replace(/Use this video_url parameter directly:[^\n]*/gi, '')
    .replace(/image_url: "[^"]*"/gi, '')
    .replace(/video_url: "[^"]*"/gi, '')
    // Remove analysis/edit instructions meant for tool selection
    .replace(/- For analysis\/questions[^-]*/gi, '')
    .replace(/- For edits[^-]*/gi, '')
    .replace(/- DO NOT use retry_last_command[^*]*/gi, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Tool: Create Video
 * 
 * Default provider: Veo 3
 * No automatic fallbacks - user can use retry_with_different_provider for manual switching
 */
export const create_video = createTool<CreateVideoArgs>(
  {
    name: 'create_video',
    description: 'Create a video from text description. Default provider: Veo 3 (Google). Other providers: Sora/Sora-Pro (OpenAI), Kling, Grok. CRITICAL: If user mentions a specific provider (e.g., "עם Grok", "with Sora", "באמצעות קלינג"), you MUST set the provider parameter!',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the desired video'
        },
        provider: {
          type: 'string',
          description: 'CRITICAL: Extract provider from user request! "Grok"/"גרוק" → "grok", "Sora"/"סורה" → "sora", "Kling"/"קלינג" → "kling". Leave empty ONLY if no provider mentioned.',
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
    // Determine provider: user-requested or default (Veo 3)
    const provider = (args.provider || PROVIDERS.VIDEO.VEO3) as string;

    logger.debug(`🔧 [Agent Tool] create_video called with provider: ${provider}`, {
      prompt: args.prompt?.substring(0, 100),
      provider,
      chatId: context.chatId
    });

    try {
      if (!args.prompt) {
        return {
          success: false,
          error: REQUIRED.VIDEO_DESCRIPTION
        };
      }

      // Validate provider: Block Image providers for Video generation
      const imageProviders = ['dalle', 'dall-e', 'dall-e-3', 'flux', 'midjourney'];
      if (args.provider && imageProviders.includes(args.provider.toLowerCase())) {
        return {
          success: false,
          error: PROVIDER_MISMATCH.IMAGE_PROVIDER_FOR_VIDEO(args.provider)
        };
      }

      const { geminiService, openaiService, greenApiService } = getServices();

      // Update expected media type in context
      context.expectedMediaType = 'video';

      // Clean prompt from any context markers that may have leaked
      let prompt = cleanPromptFromContext(args.prompt.trim());

      // MAGIC: Enhance prompt before generation
      try {
        prompt = await enhancePrompt(prompt, 'video');
      } catch (err) {
        logger.warn('Prompt enhancement failed, using original', { error: err });
      }

      logger.info(`🎬 [create_video] Generating with provider: ${provider}`);

      // Generate video with selected provider (no fallback)
      let videoResult: VideoProviderResult;
      try {
        if (provider === PROVIDERS.VIDEO.VEO3) {
          videoResult = (await geminiService.generateVideoForWhatsApp(prompt)) as VideoProviderResult;
        } else if (provider === PROVIDERS.VIDEO.SORA || provider === PROVIDERS.VIDEO.SORA_PRO) {
          const model = provider === PROVIDERS.VIDEO.SORA_PRO ? 'sora-2-pro' : 'sora-2';
          videoResult = (await openaiService.generateVideoWithSoraForWhatsApp(
            prompt,
            null,
            { model }
          )) as VideoProviderResult;
        } else if (provider === PROVIDERS.VIDEO.GROK || provider === 'grok') {
          // Grok (via xAI)
          logger.info('🎬 Executing Grok video generation...');
          videoResult = (await grokService.generateVideoForWhatsApp(prompt)) as VideoProviderResult;
        } else {
          // Kling (via Replicate) - Default fallback for other providers (Kling/Runway)
          logger.info(`🎬 Executing Kling (Replicate) video generation (Fallback for provider: ${provider})...`);
          videoResult = (await replicateService.generateVideoWithTextForWhatsApp(prompt)) as VideoProviderResult;
        }
      } catch (genError) {
        context.expectedMediaType = null;
        const errorMessage = genError instanceof Error ? genError.message : String(genError);
        logger.error(`❌ [create_video] ${provider} generation failed:`, { error: errorMessage });

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

      context.expectedMediaType = null;

      // Handle error response
      if (videoResult.error) {
        const errorMessage = typeof videoResult.error === 'string'
          ? videoResult.error
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

      let caption = videoResult.description || videoResult.revisedPrompt || videoResult.caption || '';
      if (caption) {
        caption = cleanMarkdown(caption);
      }

      return {
        success: true,
        data: `✅ הווידאו נוצר בהצלחה עם ${providerName}!`,
        videoUrl: videoResult.videoUrl || videoResult.url,
        videoCaption: caption,
        provider: providerName,
        providerKey: provider
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
 * 
 * Default provider: Veo 3
 * No automatic fallbacks - user can use retry_with_different_provider for manual switching
 */
export const image_to_video = createTool<ImageToVideoArgs>(
  {
    name: 'image_to_video',
    description: 'Convert/Animate an image to video. Default provider: Veo 3. Other providers: Sora/Sora-Pro (OpenAI), Kling, Grok. CRITICAL: If user mentions a specific provider (e.g., "עם Grok", "with Sora"), you MUST set the provider parameter!',
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
          description: 'CRITICAL: Extract provider from user request! "Grok"/"גרוק" → "grok", "Sora"/"סורה" → "sora", "Kling"/"קלינג" → "kling". Leave empty ONLY if no provider mentioned.',
          enum: [...VIDEO_PROVIDERS]
        }
      },
      required: ['image_url', 'prompt']
    }
  },
  async (args, context) => {
    // Determine provider: user-requested or default (Veo 3)
    const provider = (args.provider || PROVIDERS.VIDEO.VEO3) as string;

    logger.debug(`🔧 [Agent Tool] image_to_video called`, {
      imageUrl: args.image_url?.substring(0, 50),
      prompt: args.prompt?.substring(0, 100),
      provider,
      chatId: context.chatId
    });

    try {
      const { geminiService, openaiService, greenApiService } = getServices();

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

      // Clean prompt from any context markers that may have leaked
      let prompt = cleanPromptFromContext(args.prompt.trim());

      // MAGIC: Enhance prompt before animation
      try {
        prompt = await enhancePrompt(prompt, 'video');
      } catch (err) {
        logger.warn('Prompt enhancement failed, using original', { error: err });
      }

      const imageBuffer = await greenApiService.downloadFile(imageUrl);

      logger.info(`🎬 [image_to_video] Generating with provider: ${provider}`);

      // Generate video with selected provider (no fallback)
      let videoResult: VideoProviderResult;
      try {
        if (provider === PROVIDERS.VIDEO.VEO3) {
          videoResult = (await geminiService.generateVideoFromImageForWhatsApp(prompt, imageBuffer)) as VideoProviderResult;
        } else if (provider === PROVIDERS.VIDEO.SORA || provider === PROVIDERS.VIDEO.SORA_PRO) {
          const model = provider === PROVIDERS.VIDEO.SORA_PRO ? 'sora-2-pro' : 'sora-2';
          videoResult = (await openaiService.generateVideoWithSoraFromImageForWhatsApp(
            prompt,
            imageBuffer,
            { model }
          )) as VideoProviderResult;
        } else if (provider === PROVIDERS.VIDEO.GROK || provider === 'grok') {
          // Grok (via xAI)
          logger.info('🎬 Executing Grok image-to-video generation...');
          videoResult = (await grokService.generateVideoFromImageForWhatsApp(prompt, imageBuffer)) as VideoProviderResult;
        } else {
          // Kling (via Replicate) - Default fallback
          logger.info(`🎬 Executing Kling (Replicate) image-to-video generation (Fallback for provider: ${provider})...`);
          videoResult = (await replicateService.generateVideoFromImageForWhatsApp(imageBuffer, prompt)) as VideoProviderResult;
        }
      } catch (genError) {
        const errorMessage = genError instanceof Error ? genError.message : String(genError);
        logger.error(`❌ [image_to_video] ${provider} generation failed:`, { error: errorMessage });

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
      if (videoResult.error) {
        const errorMessage = typeof videoResult.error === 'string'
          ? videoResult.error
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

      return {
        success: true,
        data: `✅ התמונה הומרה לווידאו בהצלחה עם ${providerName}!`,
        videoUrl: videoResult.videoUrl || videoResult.url,
        provider: providerName,
        providerKey: provider
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

