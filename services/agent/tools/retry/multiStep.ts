/**
 * Retry Tools - Multi-Step Retry Logic
 * Handles retry of multi-step commands with step filtering
 */

import { detectLanguage } from '../../../../utils/agentHelpers';
import { getLanguageInstruction } from '../../utils/languageUtils';
import { extractQuotedMessageId } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
import { config } from '../../../../config';
import { RetryArgs, ToolContext, LastCommand, ToolResult } from './types';
import { sendMultiStepRetryAck } from './ack';
import { NOT_FOUND, UNABLE } from '../../../../config/messages';

/**
 * Set agent tools reference (needed for retry)
 * Note: Currently not used in multi-step retry, but kept for consistency with single-step
 */
export function setAgentToolsReference(_tools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>): void {
  // Multi-step retry uses multiStepExecution.execute() directly, not individual tools
  // This function is kept for API consistency with single-step retry
}

/**
 * Handle multi-step command retry
 */
export async function handleMultiStepRetry(
  args: RetryArgs,
  context: ToolContext,
  lastCommand: LastCommand
): Promise<ToolResult> {
  const chatId = context.chatId;
  if (!chatId) {
    return {
      success: false,
      error: NOT_FOUND.CHAT_ID_FOR_RETRY
    };
  }

  // Use toolArgs (new structure) or fallback to args (backward compatibility)
  const storedWrapper = lastCommand.toolArgs || lastCommand.args || {};
  
  logger.debug(`🔄 [Retry] Last command: ${lastCommand.tool}`, {
    isMultiStep: lastCommand.isMultiStep,
    hasPlan: !!(lastCommand.plan || storedWrapper.plan),
    hasToolArgs: !!lastCommand.toolArgs,
    hasArgs: !!lastCommand.args,
    lastCommandKeys: Object.keys(lastCommand)
  });
  
  // Get plan from lastCommand
  const plan = (lastCommand.plan || storedWrapper.plan) as {
    steps?: Array<{
      tool?: string;
      action?: string;
      parameters?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  } | undefined;
  
  if (!plan || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    logger.error('❌ [Retry] Plan validation failed:', {
      hasPlan: !!plan,
      hasSteps: !!(plan && plan.steps),
      isArray: !!(plan && plan.steps && Array.isArray(plan.steps)),
      stepsLength: plan && plan.steps ? plan.steps.length : 0,
      planKeys: plan ? Object.keys(plan) : [],
      lastCommandKeys: Object.keys(lastCommand)
    });
    return {
      success: false,
      error: UNABLE.RESTORE_MULTI_STEP_PLAN
    };
  }
  
  const planSteps = plan.steps;
  logger.info(`🔄 [Retry] Found multi-step plan with ${planSteps.length} steps:`, 
    planSteps.map((s, idx) => `${idx + 1}. ${s.tool || s.action || 'unknown'}`).join(', '));
  
  // Check if user requested specific steps to retry
  const stepNumbers = args.step_numbers || null;
  const stepTools = args.step_tools || null;
  
  // Filter steps if specific steps were requested
  let stepsToRetry = planSteps;
  if (stepNumbers && Array.isArray(stepNumbers) && stepNumbers.length > 0) {
    // Retry specific step numbers (1-based)
    stepsToRetry = planSteps.filter((_step, idx) => stepNumbers.includes(idx + 1));
    logger.debug(`🔄 [Retry] Filtering by step numbers ${stepNumbers.join(', ')}: ${stepsToRetry.length} of ${planSteps.length} steps`);
  } else if (stepTools && Array.isArray(stepTools) && stepTools.length > 0) {
    // Retry steps with specific tools
    stepsToRetry = planSteps.filter(step => {
      const stepTool = step.tool || '';
      return stepTools.some(requestedTool => 
        stepTool.includes(requestedTool) || 
        requestedTool.includes(stepTool) ||
        stepTool === requestedTool
      );
    });
    logger.debug(`🔄 [Retry] Filtering by step tools ${stepTools.join(', ')}: ${stepsToRetry.length} of ${planSteps.length} steps`);
  } else {
    // Retry all steps (no filtering)
    logger.debug(`🔄 [Retry] Retrying all ${planSteps.length} steps (no filter specified)`);
  }
  
  // Validate that we have steps to retry
  if (!stepsToRetry || !Array.isArray(stepsToRetry) || stepsToRetry.length === 0) {
    logger.error('❌ [Retry] No steps to retry after filtering:', {
      originalStepsCount: planSteps.length,
      stepNumbers,
      stepTools,
      filteredStepsCount: stepsToRetry ? stepsToRetry.length : 0
    });
    const stepsInfo = planSteps.map((s: { tool?: string; action?: string }, idx: number) => 
      `${idx + 1}. ${s.tool || (typeof s.action === 'string' ? s.action.substring(0, 30) : 'unknown') || 'unknown'}`
    ).join(', ');
    return {
      success: false,
      error: NOT_FOUND.matchingSteps(stepsInfo)
    };
  }
  
  // Create a new plan with only the steps to retry
  const filteredPlan = {
    ...plan,
    steps: stepsToRetry.map((step, idx: number) => ({
      tool: step.tool,
      action: step.action || '',
      parameters: step.parameters || {},
      stepNumber: idx + 1,
      ...step
    }))
  };
  
  logger.info(`🔄 Retrying multi-step command: ${filteredPlan.steps.length} of ${planSteps.length} steps`);
  
  // Get multi-step execution handler (lazy load to avoid circular dependency)
   
  const multiStepModule = await import('../../execution/multiStep');
  const multiStepExecution = multiStepModule.default;
  
  // Detect language from original prompt
  const originalPrompt = lastCommand.prompt || storedWrapper.prompt || '';
  const userLanguage = detectLanguage(originalPrompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // Agent config (SSOT from centralized config)
  const agentConfig = {
    model: config.agent.model,
    maxIterations: config.agent.maxIterations,
    timeoutMs: config.agent.timeoutMs,
    contextMemoryEnabled: config.agent.contextMemoryEnabled
  };
  
  // Apply modifications to filtered plan if provided
  if (args.modifications && args.modifications.trim()) {
    if (filteredPlan.steps && filteredPlan.steps.length > 0) {
      const firstStep = filteredPlan.steps[0];
      if (firstStep) {
        firstStep.action = `${firstStep.action || ''} ${args.modifications}`;
        logger.debug(`📝 Applied modifications to multi-step plan: ${args.modifications}`);
      }
    }
  }
  
  // CRITICAL: For manual retry, preserve original providers in each step
  // Only change provider if user explicitly specified provider_override
  if (args.provider_override && args.provider_override !== 'none') {
    logger.debug(`🔄 [Multi-step Retry] User requested provider override: ${args.provider_override}`);
    if (filteredPlan.steps) {
      filteredPlan.steps.forEach((step, idx) => {
        if (step.parameters) {
          const toolName = step.tool || '';
          if (toolName.includes('image') || toolName.includes('video') || toolName.includes('edit')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (step.parameters as any).provider = args.provider_override;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (step.parameters as any).service = args.provider_override;
            logger.debug(`🔄 [Multi-step Retry] Overriding provider for step ${idx + 1} to: ${args.provider_override}`);
          }
        }
      });
    }
  } else {
    logger.debug(`🔄 [Multi-step Retry] Keeping original providers for all steps`);
  }
  
  // Send ACK with information about which steps are being retried
  const quotedMessageId = extractQuotedMessageId({ context });
  await sendMultiStepRetryAck(
    chatId,
    stepNumbers,
    stepTools,
    planSteps.length,
    filteredPlan.steps.length,
    quotedMessageId
  );
  
  // Re-execute the filtered multi-step plan (only selected steps)
  const result = await multiStepExecution.execute(
    filteredPlan,
    chatId,
    {
      input: {
        ...context.originalInput,
        originalMessageId: quotedMessageId || undefined
      }
    },
    languageInstruction,
    agentConfig
  );
  
  return result as ToolResult;
}

