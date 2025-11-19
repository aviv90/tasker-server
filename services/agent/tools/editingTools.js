/**
 * Editing Tools - Image and Video editing
 * Clean, modular tool definitions following SOLID principles
 */

const { formatProviderName } = require('../utils/providerUtils');
const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Edit Image
 */
const edit_image = {
  declaration: {
    name: 'edit_image',
    description: 'ערוך תמונה קיימת. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL של התמונה לעריכה. אם זמין בפרומפט (בשורה "Use this image_url parameter directly"), קח אותו משם.'
        },
        edit_instruction: {
          type: 'string',
          description: 'מה לערוך בתמונה (הוסף, הסר, שנה, etc.)'
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
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] edit_image called`);
    
    try {
      const { openaiService, geminiService, greenApiService } = getServices();
      const requestedService = args.service || null;
      const servicesToTry = requestedService ? [requestedService] : ['gemini', 'openai'];
      
      // CRITICAL: edit_image needs base64 image, not URL!
      // Download the image first and convert to base64 (reuse for all attempts)
      const imageBuffer = await greenApiService.downloadFile(args.image_url);
      const base64Image = imageBuffer.toString('base64');
      const errorStack = [];
      
      for (const service of servicesToTry) {
        try {
          console.log(`✏️ [edit_image] Trying provider: ${service}`);
          let result;
          if (service === 'openai') {
            result = await openaiService.editImageForWhatsApp(args.edit_instruction, base64Image);
          } else {
            result = await geminiService.editImageForWhatsApp(args.edit_instruction, base64Image);
          }
          
          if (result?.error) {
            const providerName = formatProviderName(service);
            const message = result.error || 'Unknown error';
            errorStack.push({ provider: providerName, message });
            console.warn(`❌ [edit_image] ${providerName} failed: ${message}`);
            continue;
          }
          
          return {
            success: true,
            data: `✅ התמונה נערכה בהצלחה עם ${formatProviderName(service)}!`,
            imageUrl: result.imageUrl,
            caption: result.description || '',
            service: service
          };
        } catch (error) {
          const providerName = formatProviderName(service);
          const message = error.message || 'Unknown error';
          errorStack.push({ provider: providerName, message });
          console.error(`❌ [edit_image] ${providerName} threw error: ${message}`);
        }
      }
      
      if (requestedService) {
        const failure = errorStack[0];
        return {
          success: false,
          error: `עריכת תמונה נכשלה עם ${failure?.provider || formatProviderName(requestedService)}: ${failure?.message || 'סיבה לא ידועה'}`
        };
      }
      
      const failureDetails = errorStack.length > 0
        ? errorStack.map(err => `• ${err.provider}: ${err.message}`).join('\n')
        : 'לא התקבל הסבר מפורט מהספקים.';
      return {
        success: false,
        error: `כל הספקים נכשלו בעריכת התמונה:\n${failureDetails}`
      };
    } catch (error) {
      console.error('❌ Error in edit_image:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Edit Video
 */
const edit_video = {
  declaration: {
    name: 'edit_video',
    description: 'ערוך סרטון וידאו קיים. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description: 'URL של הוידאו לעריכה. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
        },
        edit_instruction: {
          type: 'string',
          description: 'מה לערוך בווידאו'
        }
      },
      required: ['video_url', 'edit_instruction']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] edit_video called`);
    
    try {
      const { greenApiService } = getServices();
      const replicateService = require('../../replicateService');
      
      // CRITICAL: edit_video needs videoBuffer, not URL!
      // Download the video first
      const videoBuffer = await greenApiService.downloadFile(args.video_url);
      const result = await replicateService.generateVideoFromVideoForWhatsApp(videoBuffer, args.edit_instruction);
      
      if (result.error) {
        return {
          success: false,
          error: `עריכת וידאו נכשלה: ${result.error}`
        };
      }
      
      return {
        success: true,
        data: `✅ הוידאו נערך בהצלחה!`,
        videoUrl: result.videoUrl
      };
    } catch (error) {
      console.error('❌ Error in edit_video:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = {
  edit_image,
  edit_video
};

