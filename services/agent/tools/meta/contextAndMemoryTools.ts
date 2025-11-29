/**
 * Context & Memory Tools
 *
 * Tools for accessing chat history, analyzing images from history,
 * saving user preferences, and accessing long-term memory.
 *
 * Extracted from metaTools.js (Phase 5.2)
 */

import conversationManager from '../../../conversationManager';
import { getServices } from '../../utils/serviceLoader';
import logger from '../../../../utils/logger';
import { NOT_FOUND, REQUIRED, ERROR } from '../../../../config/messages';

type ToolContext = {
  chatId?: string;
  previousToolResults?: {
    get_chat_history?: {
      messages?: Array<{
        [key: string]: unknown;
        metadata?: {
          imageUrl?: string;
          [key: string]: unknown;
        };
      }>;
    };
  };
};

type AnalyzeImageArgs = {
  image_id?: number;
  question?: string;
};

type SavePreferenceArgs = {
  preference_key?: string;
  preference_value?: string;
  description?: string;
};

type GetLongTermMemoryArgs = {
  include_summaries?: boolean;
  include_preferences?: boolean;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
  [key: string]: unknown;
}>;

type ConversationSummary = {
  summary: string;
  keyTopics?: string[];
};

const contextAndMemoryTools = {
  analyze_image_from_history: {
    declaration: {
      name: 'analyze_image_from_history',
      description:
        'נתח תמונה מהיסטוריית ההודעות. השתמש בכלי הזה אחרי ששלפת את היסטוריית ההודעות וראית שיש תמונה רלוונטית.',
      parameters: {
        type: 'object',
        properties: {
          image_id: {
            type: 'number',
            description: 'מזהה התמונה מההיסטוריה (המספר שמופיע ב-[image_id: X])'
          },
          question: {
            type: 'string',
            description: 'השאלה או הבקשה לגבי התמונה'
          }
        },
        required: ['image_id', 'question']
      }
    },
    execute: async (args: AnalyzeImageArgs = {}, context: ToolContext = {}): ToolResult => {
      logger.debug(
        `🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`
      );

      let imageBuffer: Buffer | null = null;
      try {
        const history = context.previousToolResults?.get_chat_history?.messages;
        if (!history || typeof args.image_id !== 'number' || !history[args.image_id]) {
          return {
            success: false,
            error: NOT_FOUND.imageById(args.image_id || 0)
          };
        }

        const message = history[args.image_id];
        if (!message) {
          return {
            success: false,
            error: NOT_FOUND.imageById(args.image_id)
          };
        }
        const imageUrl = message.metadata?.imageUrl;

        if (!imageUrl) {
          return {
            success: false,
            error: `ההודעה ${args.image_id} לא מכילה תמונה`
          };
        }

        if (!args.question) {
          return {
            success: false,
            error: REQUIRED.IMAGE_QUESTION
          };
        }

        const { geminiService, greenApiService } = getServices();
        imageBuffer = await greenApiService.downloadFile(imageUrl);
        const base64Image = imageBuffer.toString('base64');

        const result = (await geminiService.analyzeImageWithText(
          args.question,
          base64Image
        )) as { success: boolean; text?: string; error?: string };

        imageBuffer = null;

        if (result.success) {
          return {
            success: true,
            data: result.text || ''
          };
        }

        return {
          success: false,
          error: result.error || 'שגיאה בניתוח התמונה'
        };
      } catch (error) {
        const err = error as Error;
        logger.error('❌ Error in analyze_image_from_history tool:', err);
        imageBuffer = null;
        return {
          success: false,
          error: ERROR.imageAnalysis(err.message)
        };
      }
    }
  },

  save_user_preference: {
    declaration: {
      name: 'save_user_preference',
      description:
        'שמור העדפת משתמש לטווח ארוך. השתמש כשמשתמש אומר "תמיד...", "אני מעדיף...", "בפעם הבאה...", "זכור ש...". דוגמאות: "תמיד צור תמונות עם OpenAI", "אני מעדיף וידאו קצרים", "זכור שאני לא אוהב חתולים".',
      parameters: {
        type: 'object',
        properties: {
          preference_key: {
            type: 'string',
            description: 'מפתח ההעדפה (למשל: "preferred_image_provider", "video_style", "dislikes")'
          },
          preference_value: {
            type: 'string',
            description: 'ערך ההעדפה'
          },
          description: {
            type: 'string',
            description: 'תיאור קצר של ההעדפה (אופציונלי)'
          }
        },
        required: ['preference_key', 'preference_value']
      }
    },
    execute: async (args: SavePreferenceArgs = {}, context: ToolContext = {}): ToolResult => {
      logger.debug(
        `🔧 [Agent Tool] save_user_preference called: ${args.preference_key} = ${args.preference_value}`
      );

      try {
        if (!context.chatId) {
          return {
            success: false,
            error: NOT_FOUND.CHAT_ID_FOR_PREFERENCE
          };
        }

        if (!args.preference_key || !args.preference_value) {
          return {
            success: false,
            error: REQUIRED.PREFERENCE_KEY_VALUE
          };
        }

        await conversationManager.saveUserPreference(
          context.chatId,
          args.preference_key,
          args.preference_value
        );

        return {
          success: true,
          data: `✅ שמרתי את ההעדפה: ${args.preference_key} = ${args.preference_value}`
        };
      } catch (error) {
        const err = error as Error;
        logger.error('❌ Error in save_user_preference tool:', err);
        return {
          success: false,
          error: ERROR.savePreference(err.message)
        };
      }
    }
  },

  get_long_term_memory: {
    declaration: {
      name: 'get_long_term_memory',
      description:
        'קרא זיכרון ארוך טווח - סיכומי שיחות קודמות והעדפות משתמש. השתמש כשצריך להבין הקשר רחב יותר או לבדוק מה המשתמש אוהב/לא אוהב.',
      parameters: {
        type: 'object',
        properties: {
          include_summaries: {
            type: 'boolean',
            description: 'האם לכלול סיכומי שיחות קודמות (ברירת מחדל: true)'
          },
          include_preferences: {
            type: 'boolean',
            description: 'האם לכלול העדפות משתמש (ברירת מחדל: true)'
          }
        },
        required: []
      }
    },
    execute: async (args: GetLongTermMemoryArgs = {}, context: ToolContext = {}): ToolResult => {
      logger.debug(`🔧 [Agent Tool] get_long_term_memory called`);

      try {
        if (!context.chatId) {
          return {
            success: false,
            error: NOT_FOUND.CHAT_ID_FOR_MEMORY
          };
        }

        const includeSummaries = args.include_summaries !== false;
        const includePreferences = args.include_preferences !== false;

        const result: {
          success: boolean;
          data: string;
          summaries?: Array<{ summary: string; keyTopics?: string[] }>;
          preferences?: Record<string, unknown>;
        } = {
          success: true,
          data: ''
        };

        if (includeSummaries) {
          const summaries = (await conversationManager.getConversationSummaries(
            context.chatId,
            5
          )) as ConversationSummary[];

          if (summaries && summaries.length > 0) {
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
          const preferences = await conversationManager.getUserPreferences(context.chatId);
          if (preferences && Object.keys(preferences).length > 0) {
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
        logger.error('❌ Error in get_long_term_memory tool:', err);
        return {
          success: false,
          error: ERROR.longTermMemory(err.message)
        };
      }
    }
  }
};

export default contextAndMemoryTools;
// For CommonJS compatibility if needed
// module.exports = contextAndMemoryTools;
