/**
 * Context Tools - Chat history, image analysis, preferences, and long-term memory
 */

import { getChatHistory } from '../../../utils/chatHistoryService';
import logger from '../../../utils/logger';
import { getServices } from '../utils/serviceLoader';
import conversationManager from '../../../services/conversationManager';

export interface ToolContext {
  chatId?: string;
  previousToolResults?: Record<string, unknown>;
}

type ToolResult<T = unknown> = Promise<{
  success: boolean;
  data?: T;
  messages?: unknown[];
  error?: string;
  [key: string]: unknown;
}>;

export const get_chat_history = {
  declaration: {
    name: 'get_chat_history',
    description: `קבל את היסטוריית ההודעות מהשיחה. 

**מתי להשתמש בכלי הזה (חובה!):**
• המשתמש מבקש מידע על השיחה/קבוצה (דוגמאות: "מתי כל חבר קבוצה יכול להיפגש", "מה דיברנו על X", "מי אמר Y", "מתי נקבעה הפגישה", "איזה מידע יש על X בשיחה")
• המשתמש מתייחס להודעות קודמות או מבקש מידע שהיה בשיחה
• אתה צריך קונטקסט נוסף מהשיחה כדי לענות על שאלה
• המשתמש שואל על מידע שקשור לקבוצה/שיחה ואין לך את המידע - חובה להשתמש בכלי הזה!
• המשתמש מבקש לסכם/לנתח/לחפש משהו בהיסטוריית השיחה

**חשוב מאוד:**
- אם המשתמש מבקש מידע על השיחה/קבוצה ואין לך את המידע - אל תגיד "אין לי גישה" או "אני לא יכול לדעת"! יש לך את הכלי הזה!
- תמיד קרא ל-get_chat_history לפני שתגיד שאין לך מידע על השיחה/קבוצה
- הכלי מחזיר את כל ההודעות הקודמות מהשיחה, כולל טקסט, תמונות, וידאו, אודיו`,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'מספר ההודעות האחרונות לשלוף (ברירת מחדל: 20)'
        }
      },
      required: []
    }
  },
  execute: async (args: { limit?: number }, context: ToolContext): ToolResult => {
    const limit = args.limit || 20;
    logger.debug(`🔧 [Agent Tool] get_chat_history called with limit: ${limit}`);

    try {
      const historyResult = await getChatHistory(context.chatId || '', limit, { format: 'display' });

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
        error: `שגיאה בשליפת היסטוריה: ${err.message}`
      };
    }
  }
};

export const analyze_image_from_history = {
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
  execute: async (args: { image_id: number; question: string }, context: ToolContext): ToolResult => {
    logger.debug(`🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`);

    let imageBuffer: Buffer | null = null;
    try {
      const history = (context.previousToolResults?.get_chat_history as { messages?: unknown[] })?.messages;
      if (!history || !history[args.image_id]) {
        return {
          success: false,
          error: `לא נמצאה תמונה עם המזהה ${args.image_id}`
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
        error: `שגיאה בניתוח תמונה: ${err.message}`
      };
    }
  }
};

export const save_user_preference = {
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
  execute: async (args: { preference_key: string; preference_value: string }, context: ToolContext): ToolResult => {
    logger.debug(
      `🔧 [Agent Tool] save_user_preference called: ${args.preference_key} = ${args.preference_value}`
    );

    try {
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
        error: `שגיאה בשמירת העדפה: ${err.message}`
      };
    }
  }
};

export const get_long_term_memory = {
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
  execute: async (
    args: { include_summaries?: boolean; include_preferences?: boolean },
    context: ToolContext
  ): ToolResult => {
    logger.debug('🔧 [Agent Tool] get_long_term_memory called');

    try {
      const includeSummaries = args.include_summaries !== false;
      const includePreferences = args.include_preferences !== false;

      const result: { success: boolean; data: string; summaries?: unknown[]; preferences?: Record<string, string>; [key: string]: unknown } = {
        success: true,
        data: ''
      };

      if (includeSummaries) {
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
        error: `שגיאה בגישה לזיכרון ארוך טווח: ${err.message}`
      };
    }
  }
};

export default {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
};
