/**
 * Poll Creation Tool
 * Clean, modular tool definition following SOLID principles
 */

import { getServices } from '../../utils/serviceLoader';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { REQUIRED, ERROR } from '../../../../config/messages';
import type {
  AgentToolContext,
  ToolResult,
  CreatePollArgs
} from './types';

/**
 * Tool: Create Poll
 */
export const create_poll = {
  declaration: {
    name: 'create_poll',
    description: 'Create a creative poll with question and answers. Supports rhyming!',
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
  execute: async (args: CreatePollArgs = {}, context: AgentToolContext = {}): ToolResult => {
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
      const language = context?.originalInput?.language || context?.normalized?.language || 'he';

      // Fix: cast pollData to expected type
      const pollData = (await geminiService.generateCreativePoll(args.topic, withRhyme, language)) as { error?: string; question?: string; options?: string[] };

      if (pollData.error) {
        return {
          success: false,
          error: language === 'he'
            ? `יצירת סקר נכשלה: ${pollData.error}`
            : `Poll generation failed: ${pollData.error}`
        };
      }

      return {
        success: true,
        data: language === 'he'
          ? `✅ הסקר נוצר${withRhyme ? ' עם חרוזים' : ' בלי חרוזים'}!`
          : `✅ Poll generated${withRhyme ? ' with rhymes' : ' without rhymes'}!`,
        poll: pollData
      };
    } catch (error) {
      logger.error('❌ Error in create_poll', {
        ...formatErrorForLogging(error),
        topic: args.topic?.substring(0, 100),
        options: args.options,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: ERROR.generic(error instanceof Error ? error.message : String(error))
      };
    }
  }
};

