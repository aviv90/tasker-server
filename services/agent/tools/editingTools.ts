import { getServices } from '../utils/serviceLoader';
import { formatProviderName } from '../utils/providerUtils';
import { repairMediaUrl } from './urlRepair';
import logger from '../../../utils/logger';
import * as replicateService from '../../replicateService';
import { formatErrorForLogging } from '../../../utils/errorHandler';
import { REQUIRED, ERROR, AGENT_INSTRUCTIONS } from '../../../config/messages';
import { PROVIDERS } from '../config/constants';
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
          description: 'Optional. LEAVE EMPTY for default (Gemini). Only set if user SPECIFICALLY asks for "OpenAI".',
          enum: ['gemini', 'openai']
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
      const imageUrl = repairMediaUrl(args.image_url, 'image', context);

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
      // Default to Gemini if no service specified
      const service = args.service || PROVIDERS.IMAGE.GEMINI;

      const imageBuffer = await greenApiService.downloadFile(imageUrl);
      const base64Image = imageBuffer.toString('base64');

      let imageUrlResult: string | undefined;
      let descriptionResult: string | undefined;

      // Execute based on service - NO FALLBACKS
      if (service === PROVIDERS.IMAGE.OPENAI) {
        const result = await openaiService.editImageForWhatsApp(
          args.edit_instruction as string,
          base64Image,
          null
        );
        imageUrlResult = result.imageUrl;
        descriptionResult = result.description;
      } else {
        // Gemini (default)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await geminiService.editImageForWhatsApp(
          args.edit_instruction as string,
          base64Image,
          null
        ) as any;
        imageUrlResult = result.imageUrl;
        descriptionResult = result.description;
      }

      const providerName = formatProviderName(service) || service;
      if (!imageUrlResult) {
        logger.warn(`⚠️ [edit_image] Provider ${providerName} failed to return an image URL for edit.`);
        return {
          success: false,
          error: `הספק ${providerName} לא הצליח לערוך את התמונה. ייתכן שההוראות אינן ברורות או שהספק אינו זמין.`
        };
      }

      return {
        success: true,
        data: `✅ התמונה נערכה בהצלחה עם ${providerName}!`,
        imageUrl: imageUrlResult,
        caption: descriptionResult || '',
        provider: providerName,
        providerKey: service
      };
    } catch (error) {
      logger.error('❌ Error in edit_image', {
        ...formatErrorForLogging(error),
        imageUrl: args.image_url?.substring(0, 50),
        editInstruction: args.edit_instruction?.substring(0, 100),
        service: args.service,
        chatId: context.chatId
      });

      // Use standard error formatting
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: ERROR.generic(errorMsg)
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
      const videoUrl = repairMediaUrl(args.video_url, 'video', context);

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

      // Replicate only for now
      const result = await replicateService.generateVideoFromVideoForWhatsApp(
        videoBuffer,
        args.edit_instruction as string
      );

      if (!result.success || result.error) {
        return {
          success: false,
          error: `${result.error || 'העריכה נכשלה'} ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`
        };
      }

      const providerKey = 'replicate';
      const providerName = formatProviderName(providerKey) || providerKey;

      return {
        success: true,
        data: `✅ הוידאו נערך בהצלחה!`,
        videoUrl: result.videoUrl,
        provider: providerName,
        providerKey: providerKey
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

