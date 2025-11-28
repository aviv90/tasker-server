/**
 * Retry Tools - Multi-Step Retry Logic
 * Handles retry of multi-step commands with step filtering
 */

import { detectLanguage } from '../../../../utils/agentHelpers';
import { getLanguageInstruction } from '../../utils/languageUtils';
import { extractQuotedMessageId } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
import { RetryArgs, ToolContext, LastCommand, ToolResult } from './types';
import { sendMultiStepRetryAck } from './ack';

// Reference to agentTools (will be injected)
let agentTools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }> | null = null;

/**
 * Set agent tools reference (needed for retry)
 */
export function setAgentToolsReference(tools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>): void {
  agentTools = tools;
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
      error: 'לא נמצא chatId לביצוע retry'
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
      error: 'לא הצלחתי לשחזר את התוכנית של הפקודה הרב-שלבית הקודמת.'
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
    return {
      success: false,
      error: `לא נמצאו שלבים תואמים. השלבים הזמינים: ${planSteps.map((s: { tool?: string; action?: string }, idx: number) => `${idx + 1}. ${s.tool || (typeof s.action === 'string' ? s.action.substring(0, 30) : 'unknown') || 'unknown'}`).join(', ')}`
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const multiStepModule = await import('../../execution/multiStep');
  const multiStepExecution = multiStepModule.default;
  
  // Detect language from original prompt
  const originalPrompt = lastCommand.prompt || storedWrapper.prompt || '';
  const userLanguage = detectLanguage(originalPrompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // Agent config
  const agentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8,
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000,
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
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

