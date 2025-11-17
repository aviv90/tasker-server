/**
 * Smart Execute with Fallback Tool
 * 
 * Executes tasks with intelligent fallback strategies when initial attempts fail.
 */

const { getServices } = require('../../../../utils/serviceLoader');
const { VIDEO_PROVIDER_FALLBACK_ORDER } = require('../../../../config/constants');
const { simplifyPrompt, makePromptMoreGeneric } = require('../../../../utils/promptUtils');
const helpers = require('./helpers');

const smartExecuteWithFallback = {
  declaration: {
    name: 'smart_execute_with_fallback',
    description: 'בצע משימה עם אסטרטגיות fallback חכמות. אם ניסיון ראשון נכשל, ננסה אוטומטית: לפשט את הפרומפט, לנסות ספק אחר, או לפצל למשימות קטנות יותר. השתמש בכלי הזה רק לאחר שניסיון רגיל כבר נכשל!',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          description: 'סוג המשימה: image_creation, video_creation, audio_creation',
          enum: ['image_creation', 'video_creation', 'audio_creation']
        },
        original_prompt: {
          type: 'string',
          description: 'הפרומפט המקורי שנכשל'
        },
        failure_reason: {
          type: 'string',
          description: 'למה הניסיון הראשון נכשל'
        },
        provider_tried: {
          type: 'string',
          description: 'איזה ספק כבר נוסה (gemini/openai/grok)',
          enum: ['gemini', 'openai', 'grok']
        }
      },
      required: ['task_type', 'original_prompt', 'failure_reason']
    }
  },
  execute: async (args, context) => {
    console.log(`🧠 [Agent Tool] smart_execute_with_fallback called for ${args.task_type}`);

    try {
      const { geminiService, openaiService, grokService } = getServices();
      if (args.task_type === 'video_creation') {
        context.expectedMediaType = 'video';
      }

      // Strategy 1: Try different provider
      console.log(`📊 Strategy 1: Trying different provider...`);
      const providersTried = helpers.normalizeProviders(args.providers_tried, args.provider_tried);
      const providerOrder = VIDEO_PROVIDER_FALLBACK_ORDER;
      const lastTried = providersTried.length > 0 ? providersTried[providersTried.length - 1] : null;
      const providers = helpers.getNextProviders(providersTried, providerOrder, lastTried);

      for (const provider of providers) {
        console.log(`   → Attempting with ${provider}...`);

        try {
          let result;

          if (args.task_type === 'image_creation') {
            // Image generation with different providers
            if (provider === 'openai') {
              result = await openaiService.generateImageForWhatsApp(args.original_prompt);
            } else if (provider === 'grok') {
              result = await grokService.generateImageForWhatsApp(args.original_prompt);
            } else {
              result = await geminiService.generateImageForWhatsApp(args.original_prompt);
            }

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם ${helpers.formatProviderName(provider)}!`,
                imageUrl: result.imageUrl,
                imageCaption: result.description || result.revisedPrompt || '',
                strategy_used: 'different_provider',
                provider: provider
              };
            }
          } else if (args.task_type === 'video_creation') {
            // Video generation with different providers
            const replicateService = require('../../../../replicateService');
            const videoProviderLabelMap = {
              gemini: 'veo3',
              openai: 'sora',
              grok: 'kling'
            };

            if (provider === 'gemini') {
              result = await geminiService.generateVideoForWhatsApp(args.original_prompt);
            } else if (provider === 'openai') {
              result = await openaiService.generateVideoWithSoraForWhatsApp(args.original_prompt, null, { model: 'sora-2' });
            } else if (provider === 'grok') {
              result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
            } else {
              result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
            }

            if (!result.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              const providerLabel = videoProviderLabelMap[provider] || provider;
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם ${helpers.formatProviderName(providerLabel)}! (אסטרטגיה: מודל חלופי)`,
                videoUrl: result.videoUrl || result.url,
                strategy_used: 'different_provider',
                provider: providerLabel
              };
            }
          } else if (args.task_type === 'audio_creation') {
            // Audio/TTS - only one main provider (ElevenLabs)
            const voiceService = require('../../../../voiceService');
            result = await voiceService.textToSpeechForBot(args.original_prompt);

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו! (אסטרטגיה: הגדרות משופרות)`,
                audioUrl: result.url,
                strategy_used: 'improved_settings',
                provider: 'elevenlabs'
              };
            }
          }
        } catch (e) {
          console.log(`   ✗ ${provider} failed: ${e.message}`);
        }
      }

      // Strategy 2: Simplify prompt
      console.log(`📊 Strategy 2: Simplifying prompt...`);
      const simplifiedPrompt = simplifyPrompt(args.original_prompt);

      if (simplifiedPrompt !== args.original_prompt) {
        console.log(`   → Original: "${args.original_prompt}"`);
        console.log(`   → Simplified: "${simplifiedPrompt}"`);

        try {
          let result;

          if (args.task_type === 'image_creation') {
            result = await geminiService.generateImageForWhatsApp(simplifiedPrompt);

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                imageUrl: result.imageUrl,
                caption: result.description || '',
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt
              };
            }
          } else if (args.task_type === 'video_creation') {
            const replicateService = require('../../../../replicateService');
            result = await replicateService.generateVideoWithTextForWhatsApp(simplifiedPrompt);

            if (!result.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                videoUrl: result.videoUrl || result.url,
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt
              };
            }
          } else if (args.task_type === 'audio_creation') {
            const voiceService = require('../../../../voiceService');
            result = await voiceService.textToSpeechForBot(simplifiedPrompt);

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו עם טקסט פשוט יותר! (אסטרטגיה: פישוט)`,
                audioUrl: result.url,
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt
              };
            }
          }
        } catch (e) {
          console.log(`   ✗ Simplified prompt failed: ${e.message}`);
        }
      }

      // Strategy 4: Try with relaxed parameters (less strict)
      console.log(`📊 Strategy 4: Trying with relaxed parameters...`);
      try {
        const genericPrompt = makePromptMoreGeneric(args.original_prompt);

        if (genericPrompt !== args.original_prompt) {
          console.log(`   → Generic version: "${genericPrompt}"`);

          let result;

          if (args.task_type === 'image_creation') {
            result = await openaiService.generateImageForWhatsApp(genericPrompt);

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                imageUrl: result.imageUrl,
                caption: result.description || '',
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt
              };
            }
          } else if (args.task_type === 'video_creation') {
            const replicateService = require('../../../../replicateService');
            result = await replicateService.generateVideoWithTextForWhatsApp(genericPrompt);

            if (!result.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                videoUrl: result.videoUrl || result.url,
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt
              };
            }
          } else if (args.task_type === 'audio_creation') {
            const voiceService = require('../../../../voiceService');
            result = await voiceService.textToSpeechForBot(genericPrompt);

            if (!result.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו עם טקסט כללי יותר! (אסטרטגיה: הכללה)`,
                audioUrl: result.url,
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt
              };
            }
          }
        }
      } catch (e) {
        console.log(`   ✗ Generic prompt failed: ${e.message}`);
      }

      // All strategies failed
      const failureBase = `כל האסטרטגיות נכשלו:\n1. ספקים שונים ✗\n2. פישוט פרומפט ✗\n3. פרמטרים כלליים ✗`;
      const additionalHint = args.task_type === 'video_creation'
        ? '\n\nהבקשה המקורית דורשת וידאו, לא תמונה. נסה לנסח מחדש או לציין סגנון אחר לוידאו.'
        : '\n\nאולי תנסה לנסח את הבקשה אחרת?';
      return {
        success: false,
        error: `${failureBase}${additionalHint}`
      };

    } catch (error) {
      console.error('❌ Error in smart_execute_with_fallback:', error);
      return {
        success: false,
        error: `שגיאה במנגנון החכם: ${error.message}`
      };
    }
  }
};

module.exports = smartExecuteWithFallback;

