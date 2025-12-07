/**
 * Multi-step execution handler
 * Executes multiple steps sequentially with proper context and result handling
 */

import { executeSingleStep } from './singleStep';
import { sendToolAckMessage, FunctionCall } from '../utils/ackUtils';
import { getServices } from '../utils/serviceLoader';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { getToolDeclarations } from '../tools';
import prompts from '../../../config/prompts';
import resultSender from './resultSender';
import { TIME } from '../../../utils/constants';
import logger from '../../../utils/logger';
import { FallbackHandler } from './fallbackHandler';
import { processFinalText } from './resultProcessor';

export interface Step {
  tool?: string;
  parameters?: Record<string, unknown>;
  stepNumber: number;
  action: string;
}

export interface Plan {
  steps: Step[];
}

export interface ExecutionOptions {
  input?: {
    originalMessageId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AgentConfig {
  model: string;
  maxIterations: number;
  timeoutMs: number;
  contextMemoryEnabled?: boolean;
}

export interface StepResult {
  success: boolean;
  text?: string;
  imageUrl?: string | null;
  imageCaption?: string;
  caption?: string;
  videoUrl?: string | null;
  videoCaption?: string;
  audioUrl?: string | null;
  poll?: { question: string; options: string[] } | null;
  latitude?: string | null;
  longitude?: string | null;
  locationInfo?: string | null;
  toolsUsed?: string[];
  iterations?: number;
  error?: string;
  errorsAlreadySent?: boolean;
  data?: string;
  [key: string]: unknown;
}

class MultiStepExecution {
  private fallbackHandler: FallbackHandler;

  constructor() {
    this.fallbackHandler = new FallbackHandler();
  }

  /**
   * Execute multi-step plan
   * @param {Object} plan - Plan from planner
   * @param {string} chatId - Chat ID
   * @param {Object} options - Execution options
   * @param {string} languageInstruction - Language instruction
   * @param {Object} agentConfig - Agent configuration
   * @returns {Promise<Object>} - Execution result
   */
  async execute(plan: Plan, chatId: string, options: ExecutionOptions, languageInstruction: string, agentConfig: AgentConfig): Promise<StepResult> {
    logger.info(`✅ [Planner] Entering multi-step execution with ${plan.steps.length} steps`);

    // Adjust config for multi-step
    agentConfig.maxIterations = Math.max(agentConfig.maxIterations, 15);
    agentConfig.timeoutMs = Math.max(agentConfig.timeoutMs, TIME.MULTI_STEP_MIN_TIMEOUT);

    const functionDeclarations = getToolDeclarations();

    const stepResults: StepResult[] = [];
    const finalAssets: {
      imageUrl: string | null;
      imageCaption: string;
      videoUrl: string | null;
      audioUrl: string | null;
      poll: { question: string; options: string[] } | null;
      latitude: string | null;
      longitude: string | null;
      locationInfo: string | null;
      error?: string;
    } = {
      imageUrl: null,
      imageCaption: '',
      videoUrl: null,
      audioUrl: null,
      poll: null,
      latitude: null,
      longitude: null,
      locationInfo: null
    };

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step) continue; // Safety check for TypeScript
      const toolName = step.tool || null;
      const toolParams = step.parameters || {};

      // Send Ack BEFORE executing the step
      if (toolName) {
        logger.debug(`📢 [Multi-step] Sending Ack for Step ${step.stepNumber}/${plan.steps.length} (${toolName}) BEFORE execution`);
        // Get quotedMessageId from options.input if available
        const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
        // Check if audio was already transcribed (skip ACK for transcribe_audio)
        const skipToolsAck: string[] = [];
        if (options.input?.audioAlreadyTranscribed) {
          skipToolsAck.push('transcribe_audio');
        }
        const ackCalls: FunctionCall[] = [{ name: toolName, args: toolParams }];
        await sendToolAckMessage(chatId, ackCalls, { quotedMessageId, skipToolsAck });
      }

      // Build focused prompt for this step
      let stepPrompt = step.action;

      // Add context from previous steps
      if (stepResults.length > 0) {
        const previousContext = stepResults.map((res, idx) => {
          let summary = `Step ${idx + 1}:`;
          if (res.text) summary += ` ${res.text.substring(0, 200)}`;
          if (res.imageUrl) summary += ` [Created image]`;
          if (res.videoUrl) summary += ` [Created video]`;
          if (res.audioUrl) summary += ` [Created audio]`;
          if (res.poll) summary += ` [Created poll: "${res.poll.question}"]`;
          if (res.latitude && res.longitude) summary += ` [Sent location]`;
          return summary;
        }).join('\n');

        stepPrompt = `CONTEXT from previous steps:\n${previousContext}\n\nCURRENT TASK: ${step.action}`;
      }

      // If planner provided tool and parameters, add them to the prompt
      if (toolName && Object.keys(toolParams).length > 0) {
        const paramsStr = Object.entries(toolParams)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        stepPrompt = `${stepPrompt}\n\nTool: ${toolName}\nParameters: ${paramsStr}`;
      }

      // Execute this step
      try {
        logger.debug(`🔄 [Multi-step] Executing Step ${step.stepNumber}/${plan.steps.length}: ${step.action}`);
        const stepResult = await executeSingleStep(stepPrompt, chatId, {
          ...options,
          maxIterations: 5,
          languageInstruction,
          agentConfig,
          functionDeclarations,
          systemInstruction: prompts.singleStepInstruction(languageInstruction),
          expectedTool: toolName
        });

        logger.debug(`🔍 [Multi-step] Step ${step.stepNumber} executeSingleStep returned:`, {
          success: stepResult.success,
          hasLocation: !!(stepResult.latitude && stepResult.longitude),
          hasPoll: !!stepResult.poll,
          hasImage: !!stepResult.imageUrl,
          hasVideo: !!stepResult.videoUrl,
          hasAudio: !!stepResult.audioUrl,
          hasText: !!stepResult.text,
          toolsUsed: stepResult.toolsUsed,
          error: stepResult.error
        });

        if (stepResult.success) {
          stepResults.push(stepResult);

          // Get quotedMessageId from options.input if available
          const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
          logger.debug(`🔍 [MultiStep] quotedMessageId for step ${step.stepNumber}: ${quotedMessageId}, from options.input: ${options.input?.originalMessageId}`);

          // Get userText from options.input for pipeline detection
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const userText = (options.input as any)?.userText || null;

          // Send ALL results immediately in order
          await resultSender.sendStepResults(chatId, stepResult, step.stepNumber, quotedMessageId, userText);

          logger.info(`✅ [Multi-step] Step ${step.stepNumber}/${plan.steps.length} completed and ALL results sent`);
        } else {
          // Step failed - try fallback
          logger.error(`❌ [Agent] Step ${step.stepNumber}/${plan.steps.length} failed:`, { error: stepResult.error });

          // Get quotedMessageId to pass to fallback
          const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });

          const fallbackResult = await this.fallbackHandler.tryFallback(chatId, toolName, toolParams, step, stepResult, quotedMessageId || null);
          if (fallbackResult) {
            stepResults.push(fallbackResult);
          } else {
            // Send error for non-creation tools
            if (!this.fallbackHandler.isCreationTool(toolName || '')) {
              await this.sendError(chatId, stepResult.error || 'Unknown error', step.stepNumber, quotedMessageId || null);
            }
          }
        }
      } catch (stepError: any) {
        logger.error(`❌ [Agent] Error executing step ${step.stepNumber}:`, { error: stepError.message });
        const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
        await this.sendError(chatId, stepError.message || stepError.toString(), step.stepNumber, quotedMessageId || null, true);
      }
    }

    // Clean and process final text from all steps
    const finalText = processFinalText(stepResults, options);

    logger.info(`🏁 [Agent] Multi-step execution completed: ${stepResults.length}/${plan.steps.length} steps successful`);

    // Get originalMessageId from options.input for quoting
    const originalMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });

    return {
      success: true,
      text: finalText,
      ...finalAssets,
      toolsUsed: stepResults.flatMap(r => r.toolsUsed || []),
      iterations: stepResults.reduce((sum, r) => sum + (r.iterations || 0), 0),
      multiStep: true,
      plan: plan, // CRITICAL: Save the original plan for retry functionality
      stepsCompleted: stepResults.length,
      totalSteps: plan.steps.length,
      alreadySent: true,
      originalMessageId: originalMessageId || undefined // Pass originalMessageId for quoting
    };
  }

  /**
   * Send error message to user
   */
  async sendError(chatId: string, error: string, stepNumber: number | null = null, quotedMessageId: string | null = null, isException: boolean = false): Promise<void> {
    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` שגיאה בביצוע שלב ${stepNumber}:` : '';
      const prefix = isException ? `❌${stepInfo}` : '❌';
      const errorMessage = error.startsWith('❌') ? error : `${prefix} ${error}`;
      await greenApiService.sendTextMessage(chatId, errorMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
      logger.debug(`📤 [Multi-step] Error sent to user${stepNumber ? ` for step ${stepNumber}` : ''}`);
    } catch (errorSendError: any) {
      logger.error(`❌ [Multi-step] Failed to send error message:`, { error: errorSendError.message });
    }
  }
}

export default new MultiStepExecution();
