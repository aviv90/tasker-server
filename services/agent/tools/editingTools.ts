/**
 * Editing Tools - Image and Video editing
 * Clean, modular tool definitions following SOLID principles
 */

import { formatProviderName } from '../utils/providerUtils';
import { getServices } from '../utils/serviceLoader';
import { ProviderFallback, ProviderResult } from '../../../utils/providerFallback';
import logger from '../../../utils/logger';
import * as replicateService from '../../replicateService';

type AgentToolContext = {
  chatId?: string;
  originalInput?: {
    userText?: string;
    language?: string;
    originalMessageId?: string;
  };
  normalized?: {
    text?: string;
    language?: string;
  };
  [key: string]: unknown;
};

type CommonToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
  [key: string]: unknown;
}>;

type EditImageArgs = {
  image_url?: string;
  edit_instruction?: string;
  service?: 'openai' | 'gemini';
};

type EditVideoArgs = {
  video_url?: string;
  edit_instruction?: string;
};

type ImageEditResult = ProviderResult & {
  imageUrl?: string;
  description?: string;
  caption?: string;
};

type VideoEditResult = ProviderResult & {
  videoUrl?: string;
  providerUsed?: string;
};

/**
 * Tool: Edit Image
 */
export const edit_image = {
  declaration: {
    name: 'edit_image',
    description:
      'ערוך תמונה קיימת. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description:
            'URL של התמונה לעריכה. אם זמין בפרומפט (בשורה "Use this image_url parameter directly"), קח אותו משם.'
        },
        edit_instruction: {
          type: 'string',
          description: 'מה לערוך בתמונה (הוסף, הסר, שנה, וכו\')'
        },
        service: {
          type: 'string',
          description: 'ספק לעריכה',
          enum: ['openai', 'gemini']
        }
      },
      required: ['image_url', 'edit_instruction']
    }
  },
  execute: async (args: EditImageArgs = {}, context: AgentToolContext = {}): CommonToolResult => {
    logger.debug(`🔧 [Agent Tool] edit_image called`, {
      imageUrl: args.image_url?.substring(0, 50),
      editInstruction: args.edit_instruction?.substring(0, 100),
      service: args.service,
      chatId: context?.chatId
    });

    try {
      if (!args.image_url) {
        return {
          success: false,
          error: 'חובה לספק קישור לתמונה לעריכה'
        };
      }
      if (!args.edit_instruction) {
        return {
          success: false,
          error: 'חובה לספק הוראות עריכה לתמונה'
        };
      }

      const { openaiService, geminiService, greenApiService } = getServices();
      const requestedService = args.service || null;
      const servicesToTry = requestedService ? [requestedService] : ['gemini', 'openai'];

      const imageBuffer = await greenApiService.downloadFile(args.image_url);
      const base64Image = imageBuffer.toString('base64');

      const fallback = new ProviderFallback({
        toolName: 'edit_image',
        providersToTry: servicesToTry,
        requestedProvider: requestedService,
        context
      });

      const providerResult = (await fallback.tryWithFallback<ImageEditResult>(async service => {
        if (service === 'openai') {
          const result = (await openaiService.editImageForWhatsApp(
            args.edit_instruction as string,
            base64Image,
            null
          )) as ImageEditResult;
          result.provider = service;
          return result;
        }
        const result = (await geminiService.editImageForWhatsApp(
          args.edit_instruction as string,
          base64Image,
          null
        )) as ImageEditResult;
        result.provider = service;
        return result;
      })) as ImageEditResult;

      if (!providerResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (providerResult.error) {
        return {
          success: false,
          error:
            typeof providerResult.error === 'string'
              ? providerResult.error
              : 'העריכה נכשלה אצל הספק המבוקש'
        };
      }

      const providerKey = (providerResult.provider as string) || requestedService || servicesToTry[0];
      const providerName = formatProviderName(providerKey) || providerKey;

      return {
        success: true,
        data: `✅ התמונה נערכה בהצלחה עם ${providerName}!`,
        imageUrl: providerResult.imageUrl,
        caption: providerResult.description || providerResult.caption || '',
        provider: providerName
      };
    } catch (error) {
      logger.error('❌ Error in edit_image', {
        error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
        imageUrl: args.image_url?.substring(0, 50),
        editInstruction: args.edit_instruction?.substring(0, 100),
        service: args.service,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

/**
 * Tool: Edit Video
 */
export const edit_video = {
  declaration: {
    name: 'edit_video',
    description:
      'ערוך סרטון וידאו קיים. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description:
            'URL של הוידאו לעריכה. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
        },
        edit_instruction: {
          type: 'string',
          description: 'מה לערוך בווידאו'
        }
      },
      required: ['video_url', 'edit_instruction']
    }
  },
  execute: async (args: EditVideoArgs = {}, context: AgentToolContext = {}): CommonToolResult => {
    logger.debug(`🔧 [Agent Tool] edit_video called`, {
      videoUrl: args.video_url?.substring(0, 50),
      editInstruction: args.edit_instruction?.substring(0, 100),
      chatId: context?.chatId
    });

    try {
      if (!args.video_url) {
        return {
          success: false,
          error: 'חובה לספק קישור לוידאו לעריכה'
        };
      }
      if (!args.edit_instruction) {
        return {
          success: false,
          error: 'חובה לספק הוראות עריכה לוידאו'
        };
      }

      const { greenApiService } = getServices();

      const videoBuffer = await greenApiService.downloadFile(args.video_url);
      const providersToTry = ['replicate'];

      const fallback = new ProviderFallback({
        toolName: 'edit_video',
        providersToTry,
        requestedProvider: null,
        context
      });

      const providerResult = (await fallback.tryWithFallback<VideoEditResult>(async provider => {
        if (provider === 'replicate') {
          const result = (await replicateService.generateVideoFromVideoForWhatsApp(
            videoBuffer,
            args.edit_instruction as string
          )) as VideoEditResult;
          result.providerUsed = provider;
          return result;
        }
        throw new Error(`Provider ${provider} not supported for video editing yet`);
      })) as VideoEditResult;

      if (!providerResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (providerResult.error) {
        return {
          success: false,
          error:
            typeof providerResult.error === 'string'
              ? providerResult.error
              : 'העריכה נכשלה אצל הספק המבוקש'
        };
      }

      const providerKey = providerResult.providerUsed || 'replicate';
      const providerName = formatProviderName(providerKey) || providerKey;

      return {
        success: true,
        data: `✅ הוידאו נערך בהצלחה!`,
        videoUrl: providerResult.videoUrl,
        provider: providerName
      };
    } catch (error) {
      logger.error('❌ Error in edit_video', {
        error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
        videoUrl: args.video_url?.substring(0, 50),
        editInstruction: args.edit_instruction?.substring(0, 100),
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

module.exports = {
  edit_image,
  edit_video
};

