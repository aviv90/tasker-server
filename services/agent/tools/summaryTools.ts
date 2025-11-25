/**
 * Summary Tools - Chat summarization
 * Clean, modular tool definitions following SOLID principles
 */

import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import { getChatHistory } from '../../../utils/chatHistoryService';

type AgentToolContext = {
  chatId?: string;
  originalInput?: {
    language?: string;
  };
  normalized?: {
    language?: string;
  };
};

type ChatSummaryArgs = {
  count?: number;
};

type ChatSummaryResult = Promise<{
  success: boolean;
  data?: string | unknown;
  summary?: string | unknown;
  error?: string;
}>;

type GreenApiMessage = {
  typeMessage?: string;
  type?: string;
  textMessage?: string;
  caption?: string;
  extendedTextMessage?: {
    text?: string;
  };
  [key: string]: unknown;
};

/**
 * Tool: Chat Summary
 *
 * IMPORTANT: Uses Green API getChatHistory to get actual WhatsApp messages
 * instead of our DB, because generateChatSummary expects Green API format
 * with textMessage/caption fields, not our DB format with content/metadata.
 */
export const chat_summary = {
  declaration: {
    name: 'chat_summary',
    description: 'צור סיכום של השיחה הנוכחית. שימושי למשתמש שרוצה סיכום מהיר.',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'מספר ההודעות האחרונות לסכם (ברירת מחדל: 50)'
        }
      },
      required: []
    }
  },
  execute: async (args: ChatSummaryArgs = {}, context: AgentToolContext = {}): ChatSummaryResult => {
    logger.debug(`🔧 [Agent Tool] chat_summary called`);

    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: 'לא נמצא chatId עבור יצירת הסיכום'
        };
      }

      const { geminiService, greenApiService } = getServices();
      const messageCount = Number(args.count) > 0 ? Number(args.count) : 50;

      logger.debug(`📜 Fetching last ${messageCount} messages for summary: ${chatId}`);

      const historyResult = await getChatHistory(chatId, messageCount, { format: 'internal' });

      if (!historyResult.success) {
        return {
          success: false,
          error: historyResult.error || 'שגיאה בשליפת היסטוריית השיחה'
        };
      }

      let history: GreenApiMessage[];
      try {
        history = (await greenApiService.getChatHistory(chatId, messageCount)) as GreenApiMessage[];
      } catch (apiError) {
        const err = apiError as Error;
        logger.error('❌ Error fetching raw Green API history for summary:', {
          error: err.message,
          chatId
        });
        return {
          success: false,
          error: `שגיאה בשליפת היסטוריית השיחה מ-WhatsApp: ${err.message}`
        };
      }

      if (!history || history.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום. נסה לשלוח כמה הודעות קודם.'
        };
      }

      logger.debug(`✅ Retrieved ${history.length} messages from Green API`);

      const filteredHistory = history.filter(msg => {
        const isSystemMessage =
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (typeof msg.textMessage === 'string' && msg.textMessage.startsWith('System:'));
        return !isSystemMessage;
      });

      if (filteredHistory.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום. נסה לשלוח כמה הודעות קודם.'
        };
      }

      const textMessages = filteredHistory.filter(
        msg =>
          msg.textMessage ||
          msg.caption ||
          msg.typeMessage === 'textMessage' ||
          (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text)
      ).length;
      const mediaMessages = filteredHistory.length - textMessages;

      logger.debug(
        `📝 Including ${filteredHistory.length} messages for summary (${textMessages} text, ${mediaMessages} media)`
      );

      const summary = (await geminiService.generateChatSummary(filteredHistory)) as {
        text?: string;
        error?: string;
      };

      if (summary?.error) {
        return {
          success: false,
          error: `יצירת סיכום נכשלה: ${summary.error}`
        };
      }

      const summaryText =
        typeof summary === 'string'
          ? summary
          : (summary?.text ?? '');

      return {
        success: true,
        data: summaryText,
        summary: summaryText
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in chat_summary:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

module.exports = {
  chat_summary
};

