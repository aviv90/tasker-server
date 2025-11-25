/**
 * Command Saver
 * Handles saving last command for retry functionality
 *
 * Commands are saved to DB (persistent) for retry functionality.
 * All messages are retrieved from Green API.
 */

import conversationManager from '../../../services/conversationManager';
import { NON_PERSISTED_TOOLS } from '../config/constants';
import { sanitizeToolResult } from '../utils/resultUtils';
import logger from '../../../utils/logger';

export type ToolCall = {
  tool: string;
  args?: Record<string, unknown>;
  success?: boolean;
};

type PlanStep = {
  tool?: string;
  action?: string;
  [key: string]: unknown;
};

export type AgentPlan = {
  steps?: PlanStep[];
  [key: string]: unknown;
};

export type AgentResult = {
  multiStep?: boolean;
  plan?: AgentPlan;
  stepsCompleted?: number;
  totalSteps?: number;
  success?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: Record<string, unknown>;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  originalMessageId?: string;
};

export type NormalizedInput = {
  originalMessageId?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  [key: string]: unknown;
};

/**
 * Save last command for retry functionality
 * @param agentResult - Agent execution result
 * @param chatId - Chat ID
 * @param userText - Original user text
 * @param input - Normalized input
 */
export async function saveLastCommand(
  agentResult: AgentResult,
  chatId: string,
  userText: string,
  input: NormalizedInput = {}
): Promise<void> {
  const messageId = input?.originalMessageId || agentResult?.originalMessageId;
  if (!messageId) {
    logger.warn('⚠️ [AGENT ROUTER] No messageId available, cannot save command to cache');
    return;
  }

  if (agentResult.multiStep && agentResult.plan) {
    const plan = agentResult.plan;
    const planSteps = plan.steps as PlanStep[] | undefined;
    if (!planSteps || planSteps.length === 0) {
      logger.warn('⚠️ [AGENT ROUTER] Multi-step plan has invalid steps structure, not saving for retry:', {
        hasPlan: !!plan,
        hasSteps: !!planSteps,
        isArray: !!planSteps,
        stepsLength: planSteps ? planSteps.length : 0
      });
      return;
    }

    const commandMetadata = {
      tool: 'multi_step',
      isMultiStep: true,
      plan,
      prompt: userText,
      stepsCompleted: agentResult.stepsCompleted || 0,
      totalSteps: agentResult.totalSteps || planSteps.length || 0,
      failed: !agentResult.success,
      normalized: input,
      imageUrl: agentResult.imageUrl || null,
      videoUrl: agentResult.videoUrl || null,
      audioUrl: agentResult.audioUrl || null
    };

    await conversationManager.saveCommand(chatId, messageId, commandMetadata);
    logger.info(
      `💾 [AGENT ROUTER] Saved multi-step command for retry: ${planSteps.length} steps (${agentResult.stepsCompleted || 0} completed)`,
      {
        stepTools: planSteps
          .map(
            (step: PlanStep) =>
              step.tool || (typeof step.action === 'string' ? step.action.substring(0, 30) : 'unknown') || 'unknown'
          )
          .join(', ')
      }
    );
    return;
  }

  if (!agentResult.toolCalls || agentResult.toolCalls.length === 0) {
    return;
  }

  const toolResults = agentResult.toolResults || {};
  const toolCalls = agentResult.toolCalls || [];
  let commandToSave: ToolCall | null = null;

  for (let i = agentResult.toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i];
    if (!call) continue;
    if (NON_PERSISTED_TOOLS.has(call.tool)) continue;
    commandToSave = call;
    break;
  }

  if (!commandToSave) {
    logger.debug('ℹ️ [AGENT ROUTER] No eligible tool call to save as last command');
    return;
  }

  const primaryTool = commandToSave.tool;
  const rawResult = toolResults[primaryTool] as Record<string, unknown> | undefined;
  const sanitizedResult = rawResult ? sanitizeToolResult(rawResult) : null;
  const commandMetadata = {
    tool: primaryTool,
    isMultiStep: false,
    toolArgs: commandToSave.args || {},
    result: sanitizedResult || null,
    prompt: userText,
    failed: !commandToSave.success,
    normalized: input,
    imageUrl: sanitizedResult?.imageUrl || agentResult.imageUrl || null,
    videoUrl: sanitizedResult?.videoUrl || agentResult.videoUrl || null,
    audioUrl: sanitizedResult?.audioUrl || agentResult.audioUrl || null
  };

  await conversationManager.saveCommand(chatId, messageId, commandMetadata);
  logger.info(`💾 [AGENT ROUTER] Saved last command for retry: ${primaryTool} (success: ${commandToSave.success})`);
}

module.exports = {
  saveLastCommand
};

