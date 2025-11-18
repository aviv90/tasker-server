/**
 * Retry with Different Provider Tool
 * 
 * Retries image/video creation or editing with a different provider when initial attempts fail.
 */

const { getServices } = require('../../../../utils/serviceLoader');
const { VIDEO_PROVIDER_DISPLAY_MAP } = require('../../../../config/constants');
const helpers = require('./helpers');

const retryWithDifferentProvider = {
  declaration: {
    name: 'retry_with_different_provider',
    description: 'נסה ליצור/לערוך תמונה או וידאו עם ספק אחר אם הראשון נכשל או לא טוב. תומך ביצירת תמונות, עריכת תמונות, ויצירת וידאו. אל תשתמש בכלי הזה לפני שניסית!',
    parameters: {
      type: 'object',
      properties: {
        original_prompt: {
          type: 'string',
          description: 'הפרומפט המקורי ליצירה/עריכה',
        },
        reason: {
          type: 'string',
          description: 'למה לנסות ספק אחר (לדוגמה: "התמונה לא טובה", "timeout")',
        },
        task_type: {
          type: 'string',
          description: 'סוג המשימה: image (יצירה), image_edit (עריכה), או video',
          enum: ['image', 'image_edit', 'video']
        },
        avoid_provider: {
          type: 'string',
          description: 'איזה ספק לא לנסות (למשל: kling, veo3, sora, gemini, openai, grok)',
        },
        image_url: {
          type: 'string',
          description: 'URL של התמונה (רק לעריכה - task_type=image_edit)',
        }
      },
      required: ['original_prompt', 'reason']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] retry_with_different_provider called for ${args.task_type || 'image'}`);

    try {
      const taskType = args.task_type || 'image';
      const avoidProviderRaw = args.avoid_provider;
      const avoidProvider = helpers.normalizeProviderKey(avoidProviderRaw);

      const { geminiService, openaiService, greenApiService } = getServices();
      const replicateService = require('../../../../replicateService');

      const providers = helpers.getProviderOrder(taskType, avoidProvider);

      if (taskType === 'image_edit') {
        // Image editing fallback
        const errors = [];

        if (!args.image_url) {
          return {
            success: false,
            error: 'חסר image_url לעריכת תמונה. צריך לספק את ה-URL של התמונה לעריכה.'
          };
        }

        for (const provider of providers) {
          console.log(`🔄 Trying image edit provider: ${provider}`);

          const ackMessage = `🎨 מנסה לערוך עם ${helpers.formatProviderName(provider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
            // Download image and convert to base64
            const imageBuffer = await greenApiService.downloadFile(args.image_url);
            const base64Image = imageBuffer.toString('base64');

            let editResult;
            if (provider === 'openai') {
              editResult = await openaiService.editImageForWhatsApp(args.original_prompt, base64Image);
            } else {
              editResult = await geminiService.editImageForWhatsApp(args.original_prompt, base64Image);
            }

            if (editResult && !editResult.error) {
              return {
                success: true,
                data: `✅ ניסיתי לערוך עם ${helpers.formatProviderName(provider)} והצלחתי!`,
                imageUrl: editResult.imageUrl,
                caption: editResult.description || '',
                provider: provider
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(provider)} נכשל בעריכה: ${editResult?.error || 'Unknown error'}`;
            errors.push(errorMessage);
            console.log(`❌ ${provider} edit failed: ${editResult?.error}`);

            await helpers.sendFallbackError(context, errorMessage);

          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const exceptionMessage = `❌ ${helpers.formatProviderName(provider)} נכשל בעריכה: ${providerError.message}`;
            errors.push(exceptionMessage);
            console.error(`❌ ${provider} edit threw error:`, providerError);

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: `כל ספקי העריכה נכשלו:\n${errors.join('\n')}`
        };

      } else if (taskType === 'video') {
        // Video fallback
        context.expectedMediaType = 'video';
        const displayProviders = providers.map(p => helpers.getDisplayProvider(p));
        const errors = [];

        for (let i = 0; i < providers.length; i++) {
          const provider = providers[i];
          const displayProvider = displayProviders[i];
          console.log(`🔄 Trying video provider: ${displayProvider} (${provider})`);

          const ackMessage = `🎬 מנסה עם ${helpers.formatProviderName(displayProvider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
            let result;
            if (provider === 'grok') {
              result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
            } else if (provider === 'gemini') {
              result = await geminiService.generateVideoForWhatsApp(args.original_prompt);
            } else if (provider === 'openai') {
              result = await openaiService.generateVideoWithSoraForWhatsApp(args.original_prompt);
            }

            if (result && !result.error) {
              return {
                success: true,
                data: `✅ ניסיתי עם ${helpers.formatProviderName(displayProvider)} והצלחתי!`,
                videoUrl: result.videoUrl || result.url,
                caption: result.description || '',
                provider: displayProvider
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(displayProvider)} נכשל: ${result?.error || 'Unknown error'}`;
            errors.push(errorMessage);
            console.log(`❌ ${displayProvider} failed: ${result?.error}`);

            await helpers.sendFallbackError(context, errorMessage);

          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const exceptionMessage = `❌ ${helpers.formatProviderName(displayProvider)} נכשל: ${providerError.message}`;
            errors.push(exceptionMessage);
            console.error(`❌ ${displayProvider} threw error:`, providerError);

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: `כל הספקים נכשלו:\n${errors.join('\n')}`
        };

      } else {
        // Image creation fallback
        const errors = [];

        for (const provider of providers) {
          console.log(`🔄 Trying image provider: ${provider}`);

          const ackMessage = `🎨 מנסה עם ${helpers.formatProviderName(provider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
            let imageResult;
            if (provider === 'openai') {
              imageResult = await openaiService.generateImageForWhatsApp(args.original_prompt);
            } else if (provider === 'grok') {
              imageResult = await grokService.generateImageForWhatsApp(args.original_prompt);
            } else {
              imageResult = await geminiService.generateImageForWhatsApp(args.original_prompt);
            }

            if (!imageResult.error) {
              return {
                success: true,
                data: `✅ ניסיתי עם ${helpers.formatProviderName(provider)} והצלחתי!`,
                imageUrl: imageResult.imageUrl,
                caption: imageResult.description || '',
                provider: provider
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(provider)} נכשל: ${imageResult.error}`;
            errors.push(errorMessage);
            console.log(`❌ ${provider} failed: ${imageResult.error}`);

            await helpers.sendFallbackError(context, errorMessage);

          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const exceptionMessage = `❌ ${helpers.formatProviderName(provider)} נכשל: ${providerError.message}`;
            errors.push(exceptionMessage);
            console.error(`❌ ${provider} threw error:`, providerError);

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: `כל הספקים נכשלו:\n${errors.join('\n')}`
        };
      }
    } catch (error) {
      console.error('❌ Error in retry_with_different_provider tool:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = retryWithDifferentProvider;

