/**
 * Smart Execute with Fallback Tool
 * 
 * Executes tasks with intelligent fallback strategies when initial attempts fail.
 */

import { getServices } from '../../../utils/serviceLoader';
import { VIDEO_PROVIDER_FALLBACK_ORDER } from '../../../config/constants';
import { simplifyPrompt, makePromptMoreGeneric } from '../../../utils/promptUtils';
import * as helpers from './helpers';
import replicateService from '../../../../replicateService';
import voiceService from '../../../../voiceService';

type TaskType = 'image_creation' | 'video_creation' | 'audio_creation';
type Provider = 'gemini' | 'openai' | 'grok';

interface SmartFallbackArgs {
  task_type: TaskType;
  original_prompt: string;
  failure_reason: string;
  provider_tried?: Provider;
  providers_tried?: string[];
}

interface AgentToolContext {
  chatId?: string;
  expectedMediaType?: string | null;
  [key: string]: unknown;
}

interface ImageResult {
  textOnly?: boolean;
  error?: string;
  description?: string;
  revisedPrompt?: string;
  imageUrl?: string;
}

interface VideoResult {
  error?: string;
  videoUrl?: string;
  url?: string;
}

interface AudioResult {
  error?: string;
  url?: string;
  audioUrl?: string;
}

interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
  strategy_used?: string;
  provider?: string;
  imageUrl?: string;
  imageCaption?: string;
  caption?: string;
  videoUrl?: string;
  audioUrl?: string;
  original_prompt?: string;
  simplified_prompt?: string;
  generic_prompt?: string;
}

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
  execute: async (args: SmartFallbackArgs, context: AgentToolContext = {}): Promise<ToolResult> => {
    console.log(`🧠 [Agent Tool] smart_execute_with_fallback called for ${args.task_type}`);

    try {
      const { geminiService, openaiService, grokService } = getServices();
      if (args.task_type === 'video_creation') {
        context.expectedMediaType = 'video';
      }

      // Strategy 1: Try different provider
      console.log(`📊 Strategy 1: Trying different provider...`);
      // Fix: normalizeProviders accepts readonly array for first argument
      const providersTried = helpers.normalizeProviders(
        args.providers_tried || (args.provider_tried ? [args.provider_tried] : []), 
        null
      );
      const providerOrder = VIDEO_PROVIDER_FALLBACK_ORDER;
      const lastTried = providersTried.length > 0 ? providersTried[providersTried.length - 1] : null;
      const providers = helpers.getNextProviders(providersTried, providerOrder, lastTried);

      for (const provider of providers) {
        console.log(`   → Attempting with ${provider}...`);

        try {
          if (args.task_type === 'image_creation') {
            // Image generation with different providers
            let imageResult: ImageResult | undefined;
            if (provider === 'openai') {
              imageResult = (await openaiService.generateImageForWhatsApp(args.original_prompt, null)) as ImageResult;
            } else if (provider === 'grok') {
              imageResult = (await grokService.generateImageForWhatsApp(args.original_prompt)) as ImageResult;
            } else {
              imageResult = (await geminiService.generateImageForWhatsApp(args.original_prompt)) as ImageResult;
            }

            // Handle text-only response (no image but text returned)
            if (imageResult?.textOnly) {
              return {
                success: true,
                data: imageResult.description || '',
                strategy_used: 'different_provider',
                provider: provider
              };
            }

            if (imageResult && !imageResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם ${helpers.formatProviderName(provider)}!`,
                imageUrl: imageResult.imageUrl,
                imageCaption: imageResult.description || imageResult.revisedPrompt || '',
                strategy_used: 'different_provider',
                provider: provider
              };
            }
          } else if (args.task_type === 'video_creation') {
            // Video generation with different providers
            const videoProviderLabelMap: Record<string, string> = {
              gemini: 'veo3',
              openai: 'sora',
              grok: 'kling'
            };

            let videoResult: VideoResult | undefined;
            if (provider === 'gemini') {
              videoResult = (await geminiService.generateVideoForWhatsApp(args.original_prompt)) as VideoResult;
            } else if (provider === 'openai') {
              videoResult = (await openaiService.generateVideoWithSoraForWhatsApp(
                args.original_prompt,
                null,
                { model: 'sora-2' }
              )) as VideoResult;
            } else {
              videoResult = (await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt)) as VideoResult;
            }

            if (videoResult && !videoResult.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              const providerLabel = videoProviderLabelMap[provider] || provider;
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם ${helpers.formatProviderName(providerLabel)}! (אסטרטגיה: מודל חלופי)`,
                videoUrl: videoResult.videoUrl || videoResult.url,
                strategy_used: 'different_provider',
                provider: providerLabel
              };
            }
          } else if (args.task_type === 'audio_creation') {
            // Audio/TTS - only one main provider (ElevenLabs)
            const audioResult = (await voiceService.textToSpeechForBot(args.original_prompt)) as AudioResult;

            if (audioResult && !audioResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו! (אסטרטגיה: הגדרות משופרות)`,
                audioUrl: audioResult.url || audioResult.audioUrl,
                strategy_used: 'improved_settings',
                provider: 'elevenlabs'
              };
            }
          }
        } catch (e) {
          const error = e as Error;
          console.log(`   ✗ ${provider} failed: ${error.message}`);
        }
      }

      // Strategy 2: Simplify prompt
      console.log(`📊 Strategy 2: Simplifying prompt...`);
      const simplifiedPrompt = simplifyPrompt(args.original_prompt);

      if (simplifiedPrompt && simplifiedPrompt !== args.original_prompt) {
        console.log(`   → Original: "${args.original_prompt}"`);
        console.log(`   → Simplified: "${simplifiedPrompt}"`);

        try {
          if (args.task_type === 'image_creation') {
            const imageResult = (await geminiService.generateImageForWhatsApp(simplifiedPrompt)) as ImageResult;

            if (imageResult && !imageResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                imageUrl: imageResult.imageUrl,
                caption: imageResult.description || '',
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt || undefined
              };
            }
          } else if (args.task_type === 'video_creation') {
            const videoResult = (await replicateService.generateVideoWithTextForWhatsApp(simplifiedPrompt || '')) as VideoResult;

            if (videoResult && !videoResult.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                videoUrl: videoResult.videoUrl || videoResult.url,
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt
              };
            }
          } else if (args.task_type === 'audio_creation') {
            const audioResult = (await voiceService.textToSpeechForBot(simplifiedPrompt || '')) as AudioResult;

            if (audioResult && !audioResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו עם טקסט פשוט יותר! (אסטרטגיה: פישוט)`,
                audioUrl: audioResult.url || audioResult.audioUrl,
                strategy_used: 'simplified_prompt',
                original_prompt: args.original_prompt,
                simplified_prompt: simplifiedPrompt || undefined
              };
            }
          }
        } catch (e) {
          const error = e as Error;
          console.log(`   ✗ Simplified prompt failed: ${error.message}`);
        }
      }

      // Strategy 4: Try with relaxed parameters (less strict)
      console.log(`📊 Strategy 4: Trying with relaxed parameters...`);
      try {
        const genericPrompt = makePromptMoreGeneric(args.original_prompt);

        if (genericPrompt && genericPrompt !== args.original_prompt) {
          console.log(`   → Generic version: "${genericPrompt}"`);

          if (args.task_type === 'image_creation') {
            const imageResult = (await openaiService.generateImageForWhatsApp(genericPrompt, null)) as ImageResult;

            if (imageResult && !imageResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                imageUrl: imageResult.imageUrl,
                caption: imageResult.description || '',
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt || undefined
              };
            }
          } else if (args.task_type === 'video_creation') {
            const videoResult = (await replicateService.generateVideoWithTextForWhatsApp(genericPrompt || '')) as VideoResult;

            if (videoResult && !videoResult.error) {
              if (args.task_type === 'video_creation') {
                context.expectedMediaType = null;
              }
              return {
                success: true,
                data: `✅ הצלחתי ליצור וידאו עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                videoUrl: videoResult.videoUrl || videoResult.url,
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt || undefined
              };
            }
          } else if (args.task_type === 'audio_creation') {
            const audioResult = (await voiceService.textToSpeechForBot(genericPrompt || '')) as AudioResult;

            if (audioResult && !audioResult.error) {
              return {
                success: true,
                data: `✅ הצלחתי ליצור אודיו עם טקסט כללי יותר! (אסטרטגיה: הכללה)`,
                audioUrl: audioResult.url || audioResult.audioUrl,
                strategy_used: 'generic_prompt',
                original_prompt: args.original_prompt,
                generic_prompt: genericPrompt || undefined
              };
            }
          }
        }
      } catch (e) {
        const error = e as Error;
        console.log(`   ✗ Generic prompt failed: ${error.message}`);
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
      const err = error as Error;
      console.error('❌ Error in smart_execute_with_fallback:', err);
      return {
        success: false,
        error: `שגיאה במנגנון החכם: ${err.message}`
      };
    }
  }
};

export default smartExecuteWithFallback;
