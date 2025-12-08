/**
 * Analysis Tools - Image and Video analysis
 */

import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import { FAILED, ERROR } from '../../../config/messages';
import { createTool } from './base';

import { repairMediaUrl } from './urlRepair';

type AnalyzeArgs = {
  image_url?: string;
  video_url?: string;
  question: string;
};

export const analyze_image = createTool<AnalyzeArgs>(
  {
    name: 'analyze_image',
    description: 'Analyze an image from a direct URL. Use this if an input image URL is provided. For chat history images, use analyze_image_from_history.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'Direct URL of the image to analyze.'
        },
        question: {
          type: 'string',
          description: 'Question or prompt about the image.'
        }
      },
      required: ['image_url', 'question']
    }
  },
  async (args, context) => {
    let imageUrl = repairMediaUrl(args.image_url, 'image', context);
    logger.debug(`🔧 [Agent Tool] analyze_image called with image_url: ${imageUrl?.substring(0, 60)}...`);

    let imageBuffer: Buffer | null = null;
    try {
      if (!imageUrl) {
        return {
          success: false,
          error: 'Missing image_url.'
        };
      }

      const { geminiService, greenApiService } = getServices();
      imageBuffer = await greenApiService.downloadFile(imageUrl);
      const base64Image = imageBuffer.toString('base64');

      const result = (await geminiService.analyzeImageWithText(args.question, base64Image)) as { success: boolean; text?: string; error?: string };

      imageBuffer = null;

      if (result.success) {
        return {
          success: true,
          data: result.text
        };
      } else {
        return {
          success: false,
          error: result.error || 'Image analysis failed'
        };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in analyze_image tool:', err);
      imageBuffer = null;
      return {
        success: false,
        error: ERROR.imageAnalysis(err.message)
      };
    }
  }
);

export const analyze_video = createTool<AnalyzeArgs>(
  {
    name: 'analyze_video',
    description: 'Analyze a video from a direct URL. Use this if an input video URL is provided.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description: 'Direct URL of the video to analyze.'
        },
        question: {
          type: 'string',
          description: 'Question or prompt about the video.'
        }
      },
      required: ['video_url', 'question']
    }
  },
  async (args, context) => {
    logger.debug('🔧 [Agent Tool] analyze_video called');

    try {
      let videoUrl = repairMediaUrl(args.video_url, 'video', context);

      if (!videoUrl) {
        return {
          success: false,
          error: 'חסר video_url לניתוח הוידאו.'
        };
      }

      const { geminiService, greenApiService } = getServices();
      const videoBuffer: Buffer = await greenApiService.downloadFile(videoUrl);
      const result = (await geminiService.analyzeVideoWithText(args.question, videoBuffer)) as { error?: string; text?: string };

      if (result.error) {
        return {
          success: false,
          error: FAILED.VIDEO_ANALYSIS(result.error)
        };
      }

      return {
        success: true,
        data: result.text || 'ניתוח הושלם',
        analysis: result.text
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in analyze_video:', err);
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
);

export default {
  analyze_image,
  analyze_video
};
