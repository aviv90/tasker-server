/**
 * Poll Creation Tool
 * Clean, modular tool definition following SOLID principles
 */

import { getServices } from '../../utils/serviceLoader';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
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
    description: 'צור סקר עם שאלה ותשובות יצירתיות. תומך בסקרים עם או בלי חרוזים!',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'נושא הסקר'
        },
        with_rhyme: {
          type: 'boolean',
          description: 'האם לייצר תשובות בחרוז? true = עם חרוזים (ברירת מחדל), false = בלי חרוזים. אם המשתמש אומר "בלי חרוזים" או "without rhyme" - שלח false!'
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
          error: 'חובה לספק נושא לסקר'
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
        error: `שגיאה: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

