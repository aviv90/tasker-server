/**
 * Retry Tools - Command retry functionality
 * Clean, modular tool definitions following SOLID principles
 * 
 * This file now acts as a facade, importing from organized modules
 */

import conversationManager from '../../../conversationManager';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { ALL_PROVIDERS } from '../../config/constants';
import { RetryArgs, LastCommand } from './types';
import { handleMultiStepRetry, setAgentToolsReference as setMultiStepTools } from './multiStep';
import { handleSingleStepRetry, setAgentToolsReference as setSingleStepTools } from './singleStep';
import { NOT_FOUND, ERROR } from '../../../../config/messages';
import { createTool } from '../base';

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
export const retry_last_command = createTool<RetryArgs>(
  {
    name: 'retry_last_command',
    description: 'Retry the last command. Use ONLY when user explicitly asks to "retry", "try again", "fix it", or specific step numbers.',
    parameters: {
      type: 'object',
      properties: {
        provider_override: {
          type: 'string',
          enum: [...ALL_PROVIDERS],
          description: 'Alternative provider to use (optional)'
        },
        modifications: {
          type: 'string',
          description: 'Modifications or additional instructions (e.g., "with long hair")'
        },
        step_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Specific step numbers to retry (1-based, e.g., [2]). Null for all steps.'
        },
        step_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tool names to retry (e.g., ["send_location"]). Null for all steps.'
        }
      },
      required: []
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] retry_last_command called with provider: ${args.provider_override || 'none'}`);

    if (!agentTools) {
      return {
        success: false,
        error: ERROR.internal
      };
    }

    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: NOT_FOUND.CHAT_ID_FOR_RETRY
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
        error: ERROR.retry(error instanceof Error ? error.message : String(error))
      };
    }
  }
);

export default retry_last_command;
