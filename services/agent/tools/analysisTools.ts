/**
 * Analysis Tools - Image and Video analysis
 */

import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import { FAILED, ERROR } from '../../../config/messages';

type AnalyzeArgs = {
  image_url?: string;
  video_url?: string;
  question: string;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  analysis?: string;
  error?: string;
}>;

export const analyze_image = {
  declaration: {
    name: 'analyze_image',
    description:
      'נתח תמונה ישירות מ-URL. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly" או "image_url:" - קח את ה-URL משם ישירות! השתמש בכלי הזה כשיש URL זמין (תמונה מצורפת או מצוטטת), ובלי URL השתמש ב-analyze_image_from_history.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description:
            'URL של התמונה לניתוח. אם זמין בפרומפט (בשורה "image_url:" או "Use this image_url parameter directly"), קח אותו משם.'
        },
        question: {
          type: 'string',
          description: 'השאלה או הבקשה לגבי התמונה (מה זה, תאר, explain, וכו\')'
        }
      },
      required: ['image_url', 'question']
    }
  },
  execute: async (args: AnalyzeArgs): ToolResult => {
    logger.debug(`🔧 [Agent Tool] analyze_image called with image_url: ${args.image_url?.substring(0, 60)}...`);

    let imageBuffer: Buffer | null = null;
    try {
      if (!args.image_url) {
        return {
          success: false,
          error: 'חסר image_url לניתוח התמונה.'
        };
      }

      const { geminiService, greenApiService } = getServices();
      imageBuffer = await greenApiService.downloadFile(args.image_url);
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
          error: result.error || 'שגיאה בניתוח התמונה'
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
};

export const analyze_video = {
  declaration: {
    name: 'analyze_video',
    description:
      'נתח סרטון וידאו. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description:
            'URL של הוידאו לניתוח. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
        },
        question: {
          type: 'string',
          description: 'מה לנתח/לשאול על הוידאו'
        }
      },
      required: ['video_url', 'question']
    }
  },
  execute: async (args: AnalyzeArgs): ToolResult => {
    logger.debug('🔧 [Agent Tool] analyze_video called');

    try {
      if (!args.video_url) {
        return {
          success: false,
          error: 'חסר video_url לניתוח הוידאו.'
        };
      }

      const { geminiService, greenApiService } = getServices();
      const videoBuffer: Buffer = await greenApiService.downloadFile(args.video_url);
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
};

export default {
  analyze_image,
  analyze_video
};
