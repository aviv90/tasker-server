/**
 * Editing Tools - Image and Video editing
 * Clean, modular tool definitions following SOLID principles
 */

const { formatProviderName } = require('../utils/providerUtils');
const { getServices } = require('../utils/serviceLoader');
const { ProviderFallback } = require('../../../utils/providerFallback');

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
      
      // Use ProviderFallback utility for DRY code
      const fallback = new ProviderFallback({
        toolName: 'edit_image',
        providersToTry: servicesToTry,
        requestedProvider: requestedService,
        context
      });
      
      const result = await fallback.tryWithFallback(async (service, services) => {
        if (service === 'openai') {
          return await openaiService.editImageForWhatsApp(args.edit_instruction, base64Image);
        } else {
          return await geminiService.editImageForWhatsApp(args.edit_instruction, base64Image);
        }
      }, {
        onSuccess: (result, service) => {
          return {
            success: true,
            data: `✅ התמונה נערכה בהצלחה עם ${formatProviderName(service)}!`,
            imageUrl: result.imageUrl,
            caption: result.description || '',
            service: service
          };
        }
      });
      
      return result;
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
      // Download the video first (reuse for all attempts)
      const videoBuffer = await greenApiService.downloadFile(args.video_url);
      
      // Current providers for video editing (only Replicate for now, but structure ready for more)
      const providersToTry = ['replicate'];
      
      // Use ProviderFallback utility for consistent error handling and future extensibility
      const fallback = new ProviderFallback({
        toolName: 'edit_video',
        providersToTry,
        requestedProvider: null, // edit_video doesn't support provider selection yet
        context
      });
      
      const result = await fallback.tryWithFallback(async (provider, services) => {
        if (provider === 'replicate') {
          return await replicateService.generateVideoFromVideoForWhatsApp(videoBuffer, args.edit_instruction);
        }
        // Future: Add more providers here (e.g., OpenAI video editing when available)
        throw new Error(`Provider ${provider} not supported for video editing yet`);
      }, {
        onSuccess: (result, provider) => {
          return {
            success: true,
            data: `✅ הוידאו נערך בהצלחה!`,
            videoUrl: result.videoUrl,
            provider: provider
          };
        }
      });
      
      return result;
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

