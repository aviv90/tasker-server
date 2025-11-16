/**
 * Analysis Tools - Image and Video analysis
 * Clean, modular tool definitions following SOLID principles
 */

const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Analyze Image (direct URL)
 */
const analyze_image = {
  declaration: {
    name: 'analyze_image',
    description: 'נתח תמונה ישירות מ-URL. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly" או "image_url:" - קח את ה-URL משם ישירות! השתמש בכלי הזה כשיש URL זמין (תמונה מצורפת או מצוטטת), ובלי URL השתמש ב-analyze_image_from_history.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL של התמונה לניתוח. אם זמין בפרומפט (בשורה "image_url:" או "Use this image_url parameter directly"), קח אותו משם.'
        },
        question: {
          type: 'string',
          description: 'השאלה או הבקשה לגבי התמונה (מה זה, תאר, explain, וכו\')'
        }
      },
      required: ['image_url', 'question']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] analyze_image called with image_url: ${args.image_url?.substring(0, 60)}...`);
    
    let imageBuffer = null;
    try {
      if (!args.image_url) {
        return {
          success: false,
          error: 'חסר image_url לניתוח התמונה.'
        };
      }
      
      // Download and analyze the image
      const { geminiService, greenApiService } = getServices();
      imageBuffer = await greenApiService.downloadFile(args.image_url);
      
      // Convert buffer to base64 string (geminiService expects base64, not Buffer)
      const base64Image = imageBuffer.toString('base64');
      
      const result = await geminiService.analyzeImageWithText(args.question, base64Image);
      
      // Free memory
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
      console.error('❌ Error in analyze_image tool:', error);
      // Free memory on error
      imageBuffer = null;
      return {
        success: false,
        error: `שגיאה בניתוח התמונה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Analyze Video
 */
const analyze_video = {
  declaration: {
    name: 'analyze_video',
    description: 'נתח סרטון וידאו. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description: 'URL של הוידאו לניתוח. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
        },
        question: {
          type: 'string',
          description: 'מה לנתח/לשאול על הוידאו'
        }
      },
      required: ['video_url', 'question']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] analyze_video called`);
    
    try {
      const { geminiService, greenApiService } = getServices();
      
      // CRITICAL: analyze_video needs videoBuffer, not URL!
      // Download the video first
      const videoBuffer = await greenApiService.downloadFile(args.video_url);
      const result = await geminiService.analyzeVideoWithText(args.question, videoBuffer);
      
      if (result.error) {
        return {
          success: false,
          error: `ניתוח וידאו נכשל: ${result.error}`
        };
      }
      
      return {
        success: true,
        data: result.text || 'ניתוח הושלם',
        analysis: result.text
      };
    } catch (error) {
      console.error('❌ Error in analyze_video:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = {
  analyze_image,
  analyze_video
};

