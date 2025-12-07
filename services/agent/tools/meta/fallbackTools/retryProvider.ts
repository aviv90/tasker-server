/**
 * Retry with Different Provider Tool
 * 
 * Retries image/video creation or editing with a different provider when initial attempts fail.
 */

import { getServices } from '../../../utils/serviceLoader';
import * as helpers from './helpers';
import replicateService from '../../../../replicateService';
import logger from '../../../../../utils/logger';
import { FAILED, ERROR } from '../../../../../config/messages';

type TaskType = 'image' | 'image_edit' | 'video';

interface RetryProviderArgs {
  original_prompt: string;
  reason: string;
  task_type?: TaskType;
  avoid_provider?: string;
  image_url?: string;
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
  imageUrl?: string;
}

interface VideoResult {
  error?: string;
  videoUrl?: string;
  url?: string;
  description?: string;
}

interface EditResult {
  error?: string;
  imageUrl?: string;
  description?: string;
}

interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  provider?: string;
  suppressFinalResponse?: boolean;
}

const retryWithDifferentProvider = {
  declaration: {
    name: 'retry_with_different_provider',
    description: 'Retry image/video creation or editing with a different provider. Use ONLY after a failure with the first provider.',
    parameters: {
      type: 'object',
      properties: {
        original_prompt: {
          type: 'string',
          description: 'Original prompt for creation/editing',
        },
        reason: {
          type: 'string',
          description: 'Reason for retry (e.g., "bad quality", "timeout")',
        },
        task_type: {
          type: 'string',
          description: 'Task type: image, image_edit, or video',
          enum: ['image', 'image_edit', 'video']
        },
        avoid_provider: {
          type: 'string',
          description: 'Provider to avoid (e.g., gemini, openai, grok)',
        },
        image_url: {
          type: 'string',
          description: 'Image URL (only for task_type=image_edit)',
        }
      },
      required: ['original_prompt', 'reason']
    }
  },
  execute: async (args: RetryProviderArgs, context: AgentToolContext = {}): Promise<ToolResult> => {
    logger.debug(`🔧 [Agent Tool] retry_with_different_provider called for ${args.task_type || 'image'}`);

    try {
      const taskType = args.task_type || 'image';
      const avoidProviderRaw = args.avoid_provider;
      const avoidProvider = helpers.normalizeProviderKey(avoidProviderRaw);

      const { geminiService, openaiService, greenApiService, grokService } = getServices();

      const providers = helpers.getProviderOrder(taskType, avoidProvider);

      if (taskType === 'image_edit') {
        // Image editing fallback
        const errors: string[] = [];

        if (!args.image_url) {
          return {
            success: false,
            error: 'חסר image_url לעריכת תמונה. צריך לספק את ה-URL של התמונה לעריכה.'
          };
        }

        for (const provider of providers) {
          logger.debug(`🔄 Trying image edit provider: ${provider}`);

          const ackMessage = `🎨 מנסה לערוך עם ${helpers.formatProviderName(provider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
            // Download image and convert to base64
            const imageBuffer = await greenApiService.downloadFile(args.image_url);
            const base64Image = imageBuffer.toString('base64');

            let editResult: EditResult | undefined;
            if (provider === 'openai') {
              editResult = (await openaiService.editImageForWhatsApp(
                args.original_prompt,
                base64Image,
                null
              )) as EditResult;
            } else {
              editResult = (await geminiService.editImageForWhatsApp(
                args.original_prompt,
                base64Image,
                null
              )) as EditResult;
            }

            if (editResult && !editResult.error) {
              return {
                success: true,
                data: `✅ ניסיתי לערוך עם ${helpers.formatProviderName(provider)} והצלחתי!`,
                imageUrl: editResult.imageUrl,
                caption: editResult.description || '',
                provider: provider,
                suppressFinalResponse: true
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(provider)} נכשל בעריכה: ${editResult?.error || 'Unknown error'}`;
            errors.push(errorMessage);
            logger.warn(`❌ ${provider} edit failed: ${editResult?.error}`);

            await helpers.sendFallbackError(context, errorMessage);
          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const error = providerError as Error;
            const exceptionMessage = `❌ ${helpers.formatProviderName(provider)} נכשל בעריכה: ${error.message}`;
            errors.push(exceptionMessage);
            logger.error(`❌ ${provider} edit threw error:`, { error: error.message, stack: error.stack });

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: FAILED.ALL_EDIT_PROVIDERS(errors.join('\n'))
        };
      } else if (taskType === 'video') {
        // Video fallback
        context.expectedMediaType = 'video';
        const displayProviders = providers.map((p: string) => helpers.getDisplayProvider(p));
        const errors: string[] = [];

        for (let i = 0; i < providers.length; i++) {
          const provider = providers[i];
          const displayProvider = displayProviders[i];
          logger.debug(`🔄 Trying video provider: ${displayProvider} (${provider})`);

          const ackMessage = `🎬 מנסה עם ${helpers.formatProviderName(displayProvider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
            let result: VideoResult | undefined;
            if (provider === 'grok') {
              result = (await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt)) as VideoResult;
            } else if (provider === 'gemini') {
              result = (await geminiService.generateVideoForWhatsApp(args.original_prompt)) as VideoResult;
            } else if (provider === 'openai') {
              result = (await openaiService.generateVideoWithSoraForWhatsApp(args.original_prompt, null)) as VideoResult;
            }

            if (result && !result.error) {
              return {
                success: true,
                data: `✅ ניסיתי עם ${helpers.formatProviderName(displayProvider)} והצלחתי!`,
                videoUrl: result.videoUrl || result.url,
                caption: result.description || '',
                provider: displayProvider,
                suppressFinalResponse: true
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(displayProvider)} נכשל: ${result?.error || 'Unknown error'}`;
            errors.push(errorMessage);
            logger.warn(`❌ ${displayProvider} failed: ${result?.error}`);

            await helpers.sendFallbackError(context, errorMessage);
          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const error = providerError as Error;
            const exceptionMessage = `❌ ${helpers.formatProviderName(displayProvider)} נכשל: ${error.message}`;
            errors.push(exceptionMessage);
            logger.error(`❌ ${displayProvider} threw error:`, { error: error.message, stack: error.stack });

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: FAILED.ALL_PROVIDERS(errors.join('\n'))
        };
      } else {
        // Image creation fallback
        const errors: string[] = [];

        for (const provider of providers) {
          logger.debug(`🔄 Trying image provider: ${provider}`);

          const ackMessage = `🎨 מנסה עם ${helpers.formatProviderName(provider)}...`;
          await helpers.sendFallbackAck(context, ackMessage);

          try {
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
                provider: provider,
                suppressFinalResponse: true
              };
            }

            if (imageResult && !imageResult.error) {
              return {
                success: true,
                data: `✅ ניסיתי עם ${helpers.formatProviderName(provider)} והצלחתי!`,
                imageUrl: imageResult.imageUrl,
                caption: imageResult.description || '',
                provider: provider,
                suppressFinalResponse: true
              };
            }

            // Send error message to user as-is (Rule 2)
            const errorMessage = `❌ ${helpers.formatProviderName(provider)} נכשל: ${imageResult?.error || 'Unknown error'}`;
            errors.push(errorMessage);
            logger.warn(`❌ ${provider} failed: ${imageResult?.error}`);

            await helpers.sendFallbackError(context, errorMessage);
          } catch (providerError) {
            // Send exception error to user as-is (Rule 2)
            const error = providerError as Error;
            const exceptionMessage = `❌ ${helpers.formatProviderName(provider)} נכשל: ${error.message}`;
            errors.push(exceptionMessage);
            logger.error(`❌ ${provider} threw error:`, { error: error.message, stack: error.stack });

            await helpers.sendFallbackError(context, exceptionMessage);
          }
        }

        return {
          success: false,
          error: FAILED.ALL_PROVIDERS(errors.join('\n'))
        };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in retry_with_different_provider tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
};

export default retryWithDifferentProvider;
