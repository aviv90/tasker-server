import { getChatHistory } from '../../../utils/chatHistoryService';
import logger from '../../../utils/logger';
import { getServices } from '../utils/serviceLoader';
import { NOT_FOUND, ERROR } from '../../../config/messages';
import { createTool } from './base';

type GetChatHistoryArgs = {
  limit?: number;
};

type AnalyzeImageArgs = {
  image_id: number;
  question: string;
};

type SavePreferenceArgs = {
  preference_key: string;
  preference_value: string;
  description?: string;
};

type GetMemoryArgs = {
  include_summaries?: boolean;
  include_preferences?: boolean;
};

export const get_chat_history = createTool<GetChatHistoryArgs>(
  {
    name: 'get_chat_history',
    description: 'Retrieve chat history messages. Use when asking about conversation details, past messages, or group information.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of messages to retrieve (default: 50)'
        }
      },
      required: []
    }
  },
  async (args, context) => {
    const limit = args.limit || 20;
    logger.debug(`🔧 [Agent Tool] get_chat_history called with limit: ${limit}`);

    try {
      // For get_chat_history tool, use Green API with 50 messages (not DB cache)
      const effectiveLimit = limit || 50; // Default to 50 for tool usage
      const historyResult = await getChatHistory(context.chatId || '', effectiveLimit, { format: 'display', useDbCache: false });

      if (!historyResult.success) {
        return {
          success: false,
          error: historyResult.error || 'שגיאה בשליפת היסטוריית השיחה',
          messages: []
        };
      }

      return {
        success: true,
        data: historyResult.data,
        messages: historyResult.messages
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in get_chat_history tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.historyFetch(err.message)
      };
    }
  }
);

export const analyze_image_from_history = createTool<AnalyzeImageArgs>(
  {
    name: 'analyze_image_from_history',
    description: 'Analyze an image from chat history. Use this when an image was previously shared in the chat.',
    parameters: {
      type: 'object',
      properties: {
        image_id: {
          type: 'number',
          description: 'The image ID from history (e.g., from [image_id: X])'
        },
        question: {
          type: 'string',
          description: 'Question or prompt about the image'
        }
      },
      required: ['image_id', 'question']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`);

    let imageBuffer: Buffer | null = null;
    try {
      // Use helper to safely access previous results if possible, or assume context has it
      // AgentContextState defines previousToolResults as Record<string, ToolResult> | undefined
      // ToolResult in agent types has 'messages'
      const historyToolResult = context.previousToolResults?.get_chat_history as { messages?: unknown[] } | undefined;
      const history = historyToolResult?.messages;

      if (!history || !history[args.image_id]) {
        return {
          success: false,
          error: NOT_FOUND.imageById(args.image_id)
        };
      }

      const message = history[args.image_id] as { metadata?: { imageUrl?: string } };
      const imageUrl = message?.metadata?.imageUrl;

      if (!imageUrl) {
        return {
          success: false,
          error: `ההודעה ${args.image_id} לא מכילה תמונה`
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
          error: result.error || 'שגיאה בניתוח התמונה'
        };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in analyze_image_from_history tool:', { error: err.message, stack: err.stack });
      imageBuffer = null;
      return {
        success: false,
        error: ERROR.imageAnalysis(err.message)
      };
    }
  }
);

export const save_user_preference = createTool<SavePreferenceArgs>(
  {
    name: 'save_user_preference',
    description: 'Save a long-term user preference (e.g., favorites, dislikes, preferred modes).',
    parameters: {
      type: 'object',
      properties: {
        preference_key: {
          type: 'string',
          description: 'Key (e.g., "preferred_image_provider", "dislikes")'
        },
        preference_value: {
          type: 'string',
          description: 'Value of the preference'
        },
        description: {
          type: 'string',
          description: 'Short description (optional)'
        }
      },
      required: ['preference_key', 'preference_value']
    }
  },
  async (args, context) => {
    logger.debug(
      `🔧 [Agent Tool] save_user_preference called: ${args.preference_key} = ${args.preference_value}`
    );

    try {
      const { conversationManager } = getServices();
      await conversationManager.saveUserPreference(context.chatId || '', args.preference_key, args.preference_value);

      return {
        success: true,
        data: `✅ שמרתי את ההעדפה: ${args.preference_key} = ${args.preference_value}`
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in save_user_preference tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.savePreference(err.message)
      };
    }
  }
);

export const get_long_term_memory = createTool<GetMemoryArgs>(
  {
    name: 'get_long_term_memory',
    description: 'Retrieve long-term memory (summaries and preferences). Use for context on user likes/dislikes.',
    parameters: {
      type: 'object',
      properties: {
        include_summaries: {
          type: 'boolean',
          description: 'Include conversation summaries (default: true)'
        },
        include_preferences: {
          type: 'boolean',
          description: 'Include user preferences (default: true)'
        }
      },
      required: []
    }
  },
  async (args, context) => {
    logger.debug('🔧 [Agent Tool] get_long_term_memory called');

    try {
      const includeSummaries = args.include_summaries !== false;
      const includePreferences = args.include_preferences !== false;

      const result: { success: boolean; data: string; summaries?: unknown[]; preferences?: Record<string, string>;[key: string]: unknown } = {
        success: true,
        data: ''
      };

      if (includeSummaries) {
        const { conversationManager } = getServices();
        const summaries = (await conversationManager.getConversationSummaries(
          context.chatId || '',
          5
        )) as Array<{ summary: string; keyTopics?: string[] }>;

        if (summaries.length > 0) {
          result.data += '📚 סיכומי שיחות קודמות:\n\n';
          summaries.forEach((summary, idx) => {
            result.data += `${idx + 1}. ${summary.summary}\n`;
            if (summary.keyTopics && summary.keyTopics.length > 0) {
              result.data += `   נושאים: ${summary.keyTopics.join(', ')}\n`;
            }
            result.data += '\n';
          });
          result.summaries = summaries;
        } else {
          result.data += '📚 אין סיכומי שיחות קודמות\n\n';
        }
      }

      if (includePreferences) {
        const { conversationManager } = getServices();
        const preferences = (await conversationManager.getUserPreferences(
          context.chatId || ''
        )) as Record<string, string>;

        if (Object.keys(preferences).length > 0) {
          result.data += '⚙️ העדפות משתמש:\n';
          for (const [key, value] of Object.entries(preferences)) {
            result.data += `   • ${key}: ${value}\n`;
          }
          result.preferences = preferences;
        } else {
          result.data += '⚙️ אין העדפות משתמש שמורות';
        }
      }

      return result;
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in get_long_term_memory tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.longTermMemory(err.message)
      };
    }
  }
);

export default {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
};
