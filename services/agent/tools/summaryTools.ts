/**
 * Summary Tools - Chat summarization
 * Clean, modular tool definitions following SOLID principles
 */

import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import { getRawChatHistory } from '../../../utils/chatHistoryService';
import { NOT_FOUND, FAILED, ERROR } from '../../../config/messages';
import { createTool } from './base';

type ChatSummaryArgs = {
  count?: number;
};

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
export const chat_summary = createTool<ChatSummaryArgs>(
  {
    name: 'chat_summary',
    description: 'Summarize the current chat conversation. Useful for quick overview.',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent messages to summarize (default: 50)'
        }
      },
      required: []
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] chat_summary called`);

    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: NOT_FOUND.CHAT_ID_FOR_SUMMARY
        };
      }

      const { geminiService } = getServices();
      const messageCount = Number(args.count) > 0 ? Number(args.count) : 50;

      logger.debug(`📜 Fetching last ${messageCount} messages for summary: ${chatId}`);

      // Use SSOT to get raw Green API format (needed for generateChatSummary)
      let history: GreenApiMessage[];
      try {
        history = (await getRawChatHistory(chatId, messageCount, false)) as GreenApiMessage[];
      } catch (apiError) {
        const err = apiError as Error;
        logger.error('❌ Error fetching chat history for summary:', {
          error: err.message,
          chatId
        });
        return {
          success: false,
          error: ERROR.whatsappHistory(err.message)
        };
      }

      if (!history || history.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום. נסה לשלוח כמה הודעות קודם.'
        };
      }

      logger.debug(`✅ Retrieved ${history.length} messages from Green API (via SSOT)`);

      const textMessages = history.filter(
        msg =>
          msg.textMessage ||
          msg.caption ||
          msg.typeMessage === 'textMessage' ||
          (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text)
      ).length;
      const mediaMessages = history.length - textMessages;

      logger.debug(
        `📝 Including ${history.length} messages for summary (${textMessages} text, ${mediaMessages} media)`
      );

      const summary = (await geminiService.generateChatSummary(history)) as {
        text?: string;
        error?: string;
      };

      if (summary?.error) {
        return {
          success: false,
          error: FAILED.SUMMARY_CREATION(summary.error)
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
        error: ERROR.generic(err.message)
      };
    }
  }
);

