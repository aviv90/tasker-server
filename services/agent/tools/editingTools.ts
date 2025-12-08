import { getServices } from '../utils/serviceLoader';
import { formatProviderName } from '../utils/providerUtils';
import { repairMediaUrl } from './urlRepair';
import { ProviderFallback, ProviderResult } from '../../../utils/providerFallback';
import logger from '../../../utils/logger';
import * as replicateService from '../../replicateService';
import { formatErrorForLogging } from '../../../utils/errorHandler';
import { REQUIRED, ERROR } from '../../../config/messages';
import { createTool } from './base';

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
export const edit_image = createTool<EditImageArgs>(
  {
    name: 'edit_image',
    description: 'Edit an existing image. CRITICAL: If prompt contains "Use this image_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL of image to edit. If available in prompt "Use this image_url...", take it.'
        },
        edit_instruction: {
          type: 'string',
          description: 'What to edit (add, remove, change, etc.)'
        },
        service: {
          type: 'string',
          description: 'Service: openai (default) or gemini',
          enum: ['openai', 'gemini']
        }
      },
      required: ['image_url', 'edit_instruction']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] edit_image called`, {
      imageUrl: args.image_url?.substring(0, 50),
      editInstruction: args.edit_instruction?.substring(0, 100),
      service: args.service,
      chatId: context.chatId
    });

    try {
      let imageUrl = repairMediaUrl(args.image_url, 'image', context);

      if (!imageUrl) {
        return {
          success: false,
          error: REQUIRED.IMAGE_URL_FOR_EDIT
        };
      }

      if (!args.edit_instruction) {
        return {
          success: false,
          error: REQUIRED.EDIT_INSTRUCTIONS_IMAGE
        };
      }

      const { openaiService, geminiService, greenApiService } = getServices();
      const requestedService = args.service || null;
      const servicesToTry = requestedService ? [requestedService] : ['gemini', 'openai'];

      const imageBuffer = await greenApiService.downloadFile(imageUrl);
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
        ...formatErrorForLogging(error),
        imageUrl: args.image_url?.substring(0, 50),
        editInstruction: args.edit_instruction?.substring(0, 100),
        service: args.service,
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
 * Tool: Edit Video
 */
export const edit_video = createTool<EditVideoArgs>(
  {
    name: 'edit_video',
    description:
      'Edit an existing video. CRITICAL: If prompt contains "Use this video_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description:
            'URL of video to edit. If available in prompt "Use this video_url...", take it.'
        },
        edit_instruction: {
          type: 'string',
          description: 'What to edit in the video'
        }
      },
      required: ['video_url', 'edit_instruction']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] edit_video called`, {
      videoUrl: args.video_url?.substring(0, 50),
      editInstruction: args.edit_instruction?.substring(0, 100),
      chatId: context.chatId
    });

    try {
      let videoUrl = repairMediaUrl(args.video_url, 'video', context);

      if (!videoUrl) {
        return {
          success: false,
          error: REQUIRED.VIDEO_URL_FOR_EDIT
        };
      }
      if (!args.edit_instruction) {
        return {
          success: false,
          error: REQUIRED.EDIT_INSTRUCTIONS_VIDEO
        };
      }

      const { greenApiService } = getServices();

      const videoBuffer = await greenApiService.downloadFile(videoUrl);
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
        ...formatErrorForLogging(error),
        videoUrl: args.video_url?.substring(0, 50),
        editInstruction: args.edit_instruction?.substring(0, 100),
        chatId: context.chatId
      });
      return {
        success: false,
        error: ERROR.generic(error instanceof Error ? error.message : String(error))
      };
    }
  }
);

