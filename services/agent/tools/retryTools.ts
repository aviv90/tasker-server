/**
 * Retry Tools - Command retry functionality
 * Clean, modular tool definitions following SOLID principles
 * 
 * This file now acts as a facade, importing from organized modules
 */

import conversationManager from '../../conversationManager';
import logger from '../../../utils/logger';
import { formatErrorForLogging } from '../../../utils/errorHandler';
import { ALL_PROVIDERS } from '../../config/constants';
import { RetryArgs, ToolContext, LastCommand, ToolResult } from './retry/types';
import { handleMultiStepRetry, setAgentToolsReference as setMultiStepTools } from './retry/multiStep';
import { handleSingleStepRetry, setAgentToolsReference as setSingleStepTools } from './retry/singleStep';

// Reference to agentTools (will be injected)
let agentTools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }> | null = null;

/**
 * Set agent tools reference (needed for retry)
 * @param tools - Agent tools object
 */
export function setAgentToolsReference(tools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>): void {
  agentTools = tools;
  // Propagate to all retry modules
  setMultiStepTools(tools);
  setSingleStepTools(tools);
}

/**
 * Tool: Retry Last Command
 */
export const retry_last_command = {
  declaration: {
    name: 'retry_last_command',
    description: `חזור על הפקודה האחרונה של המשתמש (retry בלבד!). השתמש רק כשהמשתמש אומר במפורש "נסה שוב", "שוב", "תקן", "retry", "again". 

**CRITICAL: DO NOT use retry_last_command for natural follow-ups!**
- If your last message asked "רוצה עוד מידע?" / "תרצה שאפרט יותר?" / "want more details?" and user says "כן" → This is a NATURAL FOLLOW-UP, NOT a retry! Just continue the conversation with more details. DO NOT use retry_last_command!
- Only use retry_last_command when user explicitly says "נסה שוב", "שוב", "retry", "again", "תקן", or when you asked about RETRYING and user confirmed.

אם המשתמש מבקש ליצור משהו חדש (תמונה, וידאו, מוזיקה) עם ספק ספציפי (כמו "צור וידאו עם Veo 3") - זו בקשה חדשה, לא retry! השתמש ב-create_image/create_video/create_music במקום.

**תמיכה ב-retry של שלבים ספציפיים בפקודות רב-שלביות:**
- אם המשתמש אומר "נסה שוב את הפקודה השנייה" / "נסה שוב את השלב השני" / "retry step 2" → ציין step_numbers: [2]
- אם המשתמש אומר "נסה שוב את פקודת שליחת המיקום" / "retry location" → ציין step_tools: ["send_location"]
- אם המשתמש אומר "נסה שוב את הפקודה הראשונה והשלישית" / "retry steps 1 and 3" → ציין step_numbers: [1, 3]
- אם המשתמש אומר "נסה שוב את הסקר והמיקום" → ציין step_tools: ["create_poll", "send_location"]
- אם המשתמש לא ציין שלבים ספציפיים → retry את כל השלבים (step_numbers: null, step_tools: null)`,
    parameters: {
      type: 'object',
      properties: {
        provider_override: {
          type: 'string',
          enum: [...ALL_PROVIDERS],
          description: 'ספק חלופי להשתמש (אם המשתמש ביקש). none = אין שינוי'
        },
        modifications: {
          type: 'string',
          description: 'שינויים או הוראות נוספות מהמשתמש (למשל: "עם שיער ארוך", "בלי משקפיים")'
        },
        step_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'מספרי השלבים לנסות שוב (1-based). למשל: [2] לשלב השני, [1, 3] לשלב הראשון והשלישי. null = כל השלבים'
        },
        step_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'שמות הכלים של השלבים לנסות שוב. למשל: ["send_location"] לשליחת מיקום, ["create_poll", "send_location"] לסקר ומיקום. null = כל השלבים'
        }
      },
      required: []
    }
  },
  execute: async (args: RetryArgs = {}, context: ToolContext = {}): Promise<ToolResult> => {
    logger.debug(`🔧 [Agent Tool] retry_last_command called with provider: ${args.provider_override || 'none'}`);
    
    if (!agentTools) {
      return {
        success: false,
        error: 'שגיאה פנימית: לא ניתן לבצע retry כרגע.'
      };
    }
    
    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: 'לא נמצא chatId לביצוע retry'
        };
      }

      // Get last command from DB (persistent)
      const lastCommand = (await conversationManager.getLastCommand(chatId)) as LastCommand | null;
      
      if (!lastCommand) {
        return {
          success: false,
          error: 'אין פקודה קודמת לחזור עליה. זו הפעם הראשונה שאתה מבקש משהו.'
        };
      }
      
      // Map tool names to appropriate retry function
      const tool = lastCommand.tool;
      // Use toolArgs (new structure) or fallback to args (backward compatibility)
      const storedWrapper = lastCommand.toolArgs || lastCommand.args || {};
      
      logger.debug(`🔄 [Retry] Last command: ${tool}`, {
        isMultiStep: lastCommand.isMultiStep,
        hasPlan: !!(lastCommand.plan || storedWrapper.plan),
        hasToolArgs: !!lastCommand.toolArgs,
        hasArgs: !!lastCommand.args,
        lastCommandKeys: Object.keys(lastCommand)
      });
      
      // CRITICAL: Check if this is a multi-step command
      // For multi-step, plan and isMultiStep are at top level of lastCommand
      if (tool === 'multi_step' || lastCommand.isMultiStep === true || storedWrapper.isMultiStep === true) {
        // Multi-step retry: delegate to multiStep module
        return await handleMultiStepRetry(args, context, lastCommand);
      }
      
      // Single-step command handling: delegate to singleStep module
      return await handleSingleStepRetry(args, context, lastCommand);
      
    } catch (error) {
      logger.error('❌ Error in retry_last_command:', formatErrorForLogging(error));
      return {
        success: false,
        error: `שגיאה בביצוע חוזר: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default retry_last_command;
