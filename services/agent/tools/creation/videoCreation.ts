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
import type {
  AgentToolContext,
  ToolResult,
  CreateVideoArgs,
  ImageToVideoArgs,
  VideoProviderResult
} from './types';

/**
 * Tool: Create Video
 */
export const create_video = {
  declaration: {
    name: 'create_video',
    description: 'צור סרטון וידאו מטקסט. תומך ב-Veo3 (Google), Sora (OpenAI), Kling (ברירת מחדל).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'תיאור הסרטון המבוקש'
        },
        provider: {
          type: 'string',
          description: 'ספק ליצירת הוידאו',
          enum: [...VIDEO_PROVIDERS]
        }
      },
      required: ['prompt']
    }
  },
  execute: async (args: CreateVideoArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] create_video called with provider: ${args.provider || PROVIDERS.VIDEO.KLING}`, {
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || PROVIDERS.VIDEO.KLING,
      chatId: context?.chatId
    });
    
    try {
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה לספק תיאור לסרטון'
        };
      }

      const { geminiService, openaiService } = getServices();
      const prompt = args.prompt.trim();
      const requestedProvider = args.provider || null;
      // If user requested a specific provider, only try that one (no fallback)
      // If no provider specified (default), try all providers with fallback
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : [...DEFAULT_VIDEO_PROVIDERS];
      context.expectedMediaType = 'video';
      
      // Use ProviderFallback utility for DRY code
      const fallback = new ProviderFallback({
        toolName: 'create_video',
        providersToTry,
        requestedProvider,
        context
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
          error: errorMessage
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

      // Extract caption from video result (description or revisedPrompt)
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
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

/**
 * Tool: Image to Video
 */
export const image_to_video = {
  declaration: {
    name: 'image_to_video',
    description: 'המר תמונה לסרטון וידאו מונפש. USE THIS TOOL when user says: "הפוך/המר לווידאו", "תמונה לוידאו", "הנפש", "image to video", "animate", or specifies provider like "עם Veo 3/Sora 2/Kling". CRITICAL: אם בפרומפט יש "Use this image_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL של התמונה להמרה. אם זמין בפרומפט (בשורה "Use this image_url parameter directly"), קח אותו משם.'
        },
        prompt: {
          type: 'string',
          description: 'הנחיות לאנימציה - מה יקרה בסרטון (תנועה, פעולה, אפקטים)'
        },
        provider: {
          type: 'string',
          description: 'ספק להמרה: veo3 (Gemini Veo 3 - best quality), sora/sora-pro (OpenAI Sora 2 - cinematic), kling (Replicate Kling - fast). אם המשתמש מציין ספק ספציפי, השתמש בו!',
          enum: [...VIDEO_PROVIDERS]
        }
      },
      required: ['image_url', 'prompt']
    }
  },
  execute: async (args: ImageToVideoArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] image_to_video called`, {
      imageUrl: args.image_url?.substring(0, 50),
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || PROVIDERS.VIDEO.KLING,
      chatId: context?.chatId
    });
    
    try {
      const { geminiService, openaiService, greenApiService } = getServices();
      const provider = args.provider || PROVIDERS.VIDEO.KLING;
      if (!args.image_url) {
        return {
          success: false,
          error: 'חובה להעביר קישור לתמונה להמרה'
        };
      }
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה להעביר תיאור לאנימציה'
        };
      }
      
      const imageUrl = args.image_url;
      const prompt = args.prompt.trim();
      
      // CRITICAL: All providers need imageBuffer (not URL)!
      // Download the image once, then pass to provider
      const imageBuffer = await greenApiService.downloadFile(imageUrl);
      
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
        // Kling also needs imageBuffer
        result = (await replicateService.generateVideoFromImageForWhatsApp(imageBuffer, prompt)) as VideoProviderResult & { error?: string };
      }
      
      if (result.error) {
        return {
          success: false,
          error: `המרה לוידאו נכשלה: ${result.error}`
        };
      }
      
      return {
        success: true,
        data: `✅ התמונה הומרה לוידאו בהצלחה עם ${formatProviderName(provider)}!`,
        videoUrl: result.videoUrl || result.url,
        provider: provider
      };
    } catch (error) {
      logger.error('❌ Error in image_to_video', {
        ...formatErrorForLogging(error),
        imageUrl: args.image_url?.substring(0, 50),
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

