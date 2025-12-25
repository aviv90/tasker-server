import { getServices } from '../../utils/serviceLoader';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { REQUIRED, ERROR } from '../../../../config/messages';
import { createTool } from '../base';
import type { CreatePollArgs } from './types';

interface PollData {
  error?: string;
  question?: string;
  options?: string[];
  [key: string]: unknown;
}

/**
 * Tool: Create Poll
 */
export const create_poll = createTool<CreatePollArgs>(
  {
    name: 'create_poll',
    description: 'Create a WhatsApp poll. STRICT RULES: Use ONLY when user says "סקר"/"poll"/"הצבעה" EXPLICITLY. Questions like "האם X?" or "Should I X?" are NOT poll requests - just answer them with text! A poll is for GROUP voting, not for answering yes/no questions.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Poll topic'
        },
        with_rhyme: {
          type: 'boolean',
          description: 'Generate rhyming answers? true = yes (default), false = no.'
        }
      },
      required: ['topic']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] create_poll called with topic: ${args.topic}, with_rhyme: ${args.with_rhyme !== false}`);

    try {
      if (!args.topic) {
        return {
          success: false,
          error: REQUIRED.POLL_TOPIC
        };
      }

      const { geminiService } = getServices();

      // Default to true (with rhyme) if not specified
      const withRhyme = args.with_rhyme !== false;
      const language = context.originalInput?.language || 'he';

      // Fix: cast pollData to expected type
      const pollData = (await geminiService.generateCreativePoll(args.topic, withRhyme, language)) as PollData;

      if (pollData.error) {
        return {
          success: false,
          error: language === 'he'
            ? `יצירת סקר נכשלה: ${pollData.error}`
            : `Poll generation failed: ${pollData.error}`
        };
      }

      // Ensure pollData matches what ToolResult expects for 'poll'
      // ToolResult expects { question: string; options: string[] }
      if (!pollData.question || !pollData.options) {
        return {
          success: false,
          error: 'Poll generation returned incomplete data'
        };
      }

      const validPoll = {
        question: pollData.question,
        options: pollData.options
      };

      return {
        success: true,
        data: language === 'he'
          ? `✅ הסקר נוצר${withRhyme ? ' עם חרוזים' : ' בלי חרוזים'}! (אין צורך לחזור על השאלות והתשובות בהודעה שלך, הן מופיעות בסקר עצמו)`
          : `✅ Poll generated${withRhyme ? ' with rhymes' : ' without rhymes'}! (Do not repeat the question and options in your message)`,
        poll: validPoll
      };
    } catch (error) {
      logger.error('❌ Error in create_poll', {
        ...formatErrorForLogging(error),
        topic: args.topic?.substring(0, 100),
        chatId: context.chatId
      });
      return {
        success: false,
        error: ERROR.generic(error instanceof Error ? error.message : String(error))
      };
    }
  }
);

