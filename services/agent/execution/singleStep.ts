/**
 * Single Step Execution - Execute a single step in a workflow
 * 
 * Handles execution of individual steps in both single-step and multi-step workflows.
 * - Manages tool execution with context
 * - Enforces expected tool restrictions in multi-step mode
 * - Extracts assets (images, videos, audio, etc.) from tool results
 * - Prevents tool confusion by isolating each step
 * 
 * Extracted from agentService.js (Phase 4.2)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../../../config/prompts';
import { cleanThinkingPatterns } from '../utils/agentHelpers';
import { allTools as agentTools } from '../tools';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';
import logger from '../../../utils/logger';
import { StepResult, ToolResult } from '../types';
import agentContext from './context';
import { sendToolAckMessage, FunctionCall } from '../utils/ackUtils';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

type SingleStepFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: unknown;
};

interface SingleStepOptions {
  maxIterations?: number;
  languageInstruction?: string;
  agentConfig?: { model: string };
  functionDeclarations?: SingleStepFunctionDeclaration[];
  systemInstruction?: string;
  expectedTool?: string | null;
  input?: Record<string, unknown>;
}

/**
 * Execute a single step in a multi-step workflow
 * @param {string} stepPrompt - Prompt for this specific step
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Step execution result
 */
export async function executeSingleStep(stepPrompt: string, chatId: string, options: SingleStepOptions = {}): Promise<StepResult> {
  const {
    maxIterations = 5,
    languageInstruction,
    agentConfig = { model: 'gemini-3-flash-preview' },
    functionDeclarations,
    systemInstruction,
    expectedTool = null  // In multi-step, restrict execution to this tool only
  } = options;

  const model = genAI.getGenerativeModel({ model: agentConfig.model });

  // Shorter system instruction for single steps
  const stepSystemInstructionText = systemInstruction || prompts.singleStepInstruction(languageInstruction || 'he');

  // NO HISTORY for single steps - each step is isolated and focused on its specific task only

  const chat = model.startChat({
    history: [], // Empty history to prevent confusion between steps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ functionDeclarations: functionDeclarations as any }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: stepSystemInstructionText }]
    }
  });

  let iterations = 0;
  const currentPrompt = stepPrompt;
  const toolsUsed: string[] = [];
  let textResponse = '';

  const assets: {
    imageUrl: string | null;
    imageCaption: string;
    videoUrl: string | null;
    videoCaption: string;
    audioUrl: string | null;
    poll: { question: string; options: string[] } | null;
    latitude: number | null;
    longitude: number | null;
    locationInfo: string | null;
    error?: string;
    text?: string;
  } = {
    imageUrl: null,
    imageCaption: '',
    videoUrl: null,
    videoCaption: '',
    audioUrl: null,
    poll: null,
    latitude: null,
    longitude: null,
    locationInfo: null,
    text: undefined
  };

  // Agent execution loop
  while (iterations < maxIterations) {
    iterations++;

    try {
      const result = await chat.sendMessage(currentPrompt);
      const response = result.response;

      // Check for function calls
      const functionCalls = response.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        // No more tool calls - get text response and finish
        textResponse = response.text();
        break;
      }

      // Execute function calls FIRST (don't send Ack yet - wait until step completes)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const functionResponses: any[] = [];
      let targetToolExecuted = false;

      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args;

        // CRITICAL: In multi-step execution, only execute the target tool for this step
        // Prevent calling additional tools like get_chat_history that are not in the plan
        if (expectedTool && toolName !== expectedTool) {
          logger.warn(`⚠️ [Multi-step] Blocking unexpected tool call: ${toolName} (expected: ${expectedTool})`);
          functionResponses.push({
            name: toolName,
            response: {
              error: `This tool is not part of the current step. Please execute only: ${expectedTool}`,
              blocked: true
            }
          });
          continue;
        }

        // If we already executed the target tool, stop (prevent multiple calls)
        if (expectedTool && targetToolExecuted && toolName === expectedTool) {
          logger.warn(`⚠️ [Multi-step] Target tool ${expectedTool} already executed, stopping`);
          break;
        }

        toolsUsed.push(toolName);

        // Send Ack if not handled by multi-step planner (i.e., expectedTool is not set)
        if (!expectedTool) {
          const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId as string | undefined });
          const ackCalls: FunctionCall[] = [{ name: toolName, args: toolArgs as object }];

          // Check if audio was already transcribed (skip ACK for transcribe_audio)
          const skipToolsAck: string[] = [];
          if (options.input?.audioAlreadyTranscribed) {
            skipToolsAck.push('transcribe_audio');
          }

          await sendToolAckMessage(chatId, ackCalls, { quotedMessageId, skipToolsAck });
        }

        // Execute the tool
        const toolFunction = agentTools[toolName];
        if (!toolFunction || !toolFunction.execute) {
          functionResponses.push({
            name: toolName,
            response: { error: `Tool ${toolName} not found or not executable` }
          });
          continue;
        }


        // Execute with proper context
        const stepContext = agentContext.createInitialContext(chatId, { input: options.input });
        const toolResult = await toolFunction.execute(toolArgs, stepContext) as ToolResult;
        functionResponses.push({
          name: toolName,
          response: toolResult
        });

        // Mark target tool as executed
        if (expectedTool && toolName === expectedTool) {
          targetToolExecuted = true;
        }

        // Extract assets from tool result
        if (toolResult.imageUrl) {
          assets.imageUrl = toolResult.imageUrl;
          assets.imageCaption = toolResult.caption || toolResult.imageCaption || '';
        }
        if (toolResult.videoUrl) {
          assets.videoUrl = toolResult.videoUrl;
          assets.videoCaption = toolResult.videoCaption || toolResult.caption || '';
        }
        if (toolResult.audioUrl) assets.audioUrl = toolResult.audioUrl;
        if (toolResult.poll) assets.poll = toolResult.poll;
        if (toolResult.latitude) assets.latitude = toolResult.latitude;
        if (toolResult.longitude) assets.longitude = toolResult.longitude;
        if (toolResult.locationInfo) {
          assets.locationInfo = cleanJsonWrapper(toolResult.locationInfo);
        }
        // Fallback: if no text response yet and tool returned textual data, use it
        if (!textResponse && typeof toolResult.data === 'string' && toolResult.data.trim()) {
          assets.text = toolResult.data.trim();
        }

        // If tool failed and returned error, save it for return

        if (toolResult.error && toolResult.success === false) {
          assets.error = toolResult.error;
        }
      }

      // If target tool executed, get final text response and stop (don't continue with more tools)
      if (expectedTool && targetToolExecuted) {
        // Send function results back to get final text response
        const functionResponseParts = functionResponses
          .filter(fr => !fr.response.blocked)
          .map(fr => ({
            functionResponse: {
              name: fr.name,
              response: fr.response
            }
          }));

        if (functionResponseParts.length > 0) {
          const finalResult = await chat.sendMessage(functionResponseParts);
          textResponse = finalResult.response.text() || textResponse;
        }
        break; // Stop here - target tool executed, no need for more iterations
      }

      // Send function results back to the model (for non-multi-step or when no expected tool)
      const functionResponseParts = functionResponses
        .filter(fr => !fr.response.blocked)
        .map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response
          }
        }));

      if (functionResponseParts.length === 0) {
        // All tools were blocked, stop
        break;
      }

      const continueResult = await chat.sendMessage(functionResponseParts);
      textResponse = continueResult.response.text();

      // Check if model wants to continue with more tools
      const nextCalls = continueResult.response.functionCalls();
      if (!nextCalls || nextCalls.length === 0) {
        break;
      }

    } catch (error: any) {
      logger.error(`  ❌ [Step Error]:`, { error: error.message });
      return {
        success: false,
        error: error.message,
        iterations,
        toolsUsed
      };
    }
  }

  // Clean up text response
  if (textResponse) {
    textResponse = cleanThinkingPatterns(textResponse);
  }

  // Check if any tool failed
  const hasError = assets.error !== undefined;

  return {
    success: !hasError,
    text: textResponse,
    imageUrl: assets.imageUrl || undefined, // Types compatibility
    imageCaption: assets.imageCaption || undefined,
    videoUrl: assets.videoUrl || undefined,
    videoCaption: assets.videoCaption || undefined,
    audioUrl: assets.audioUrl || undefined,
    poll: assets.poll || undefined,
    latitude: assets.latitude || undefined,
    longitude: assets.longitude || undefined,
    locationInfo: assets.locationInfo || undefined,
    error: assets.error,
    toolsUsed,
    iterations
  };
}
