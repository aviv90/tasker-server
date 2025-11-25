/**
 * Agent Router - Direct routing to Agent for intelligent tool selection
 * 
 * All requests are sent directly to the Agent (Gemini Function Calling),
 * which handles ALL intent detection and tool routing intelligently.
 * 
 * This is the main routing mechanism - no regex or manual intent detection required.
 */

import { executeAgentQuery } from './agentService';
import { buildContextualPrompt } from './agent/router/contextBuilder';
import { saveLastCommand } from './agent/router/commandSaver';
import type { ToolCall, AgentPlan } from './agent/router/commandSaver';
import logger from '../utils/logger';
import conversationManager from './conversationManager';

/**
 * Normalized input structure
 */
interface NormalizedInput {
  userText?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  quotedMessageId?: string | null;
  [key: string]: unknown;
}

/**
 * Last command structure
 */
interface LastCommand {
  tool: string | null;
  toolArgs?: unknown;
  args?: unknown;
  normalized?: unknown;
  prompt?: string | null;
  failed?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  isMultiStep?: boolean;
  plan?: unknown;
}

/**
 * Agent execution result
 */
interface AgentResult {
  text?: string;
  toolCalls?: ToolCall[];
  originalMessageId?: string;
  multiStep?: boolean;
  plan?: AgentPlan;
  stepsCompleted?: number;
  totalSteps?: number;
  toolResults?: Record<string, unknown>;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  [key: string]: unknown;
}

/**
 * Route incoming request directly to Agent
 * @param input - Normalized input from webhook
 * @param chatId - Chat ID for context
 * @returns Agent execution result
 */
export async function routeToAgent(input: NormalizedInput, chatId: string): Promise<AgentResult> {
  logger.debug('🚀 [AGENT ROUTER] Routing to Agent for intelligent tool selection');
  
  const userText = input.userText || '';
  
  // Build contextual prompt using the new context builder
  const contextualPrompt = await buildContextualPrompt(input, chatId);
  
  logger.debug(`🤖 [AGENT ROUTER] Sending to Agent: "${contextualPrompt.substring(0, 150)}..."`);
  
  // Get last command for context (needed for agent execution) - from DB (persistent)
  const lastCommandRaw = await conversationManager.getLastCommand(chatId);
  let parsedLastCommand: LastCommand | null = null;
  if (lastCommandRaw) {
    const raw = lastCommandRaw as LastCommand;
    parsedLastCommand = {
      tool: raw.tool,
      args: raw.toolArgs || raw.args,
      normalized: raw.normalized,
      prompt: raw.prompt,
      failed: raw.failed,
      imageUrl: raw.imageUrl,
      videoUrl: raw.videoUrl,
      audioUrl: raw.audioUrl,
      isMultiStep: raw.isMultiStep,
      plan: raw.plan
    };
  }
  
  // Execute agent query with full context
  const agentResult = await executeAgentQuery(
    contextualPrompt,
    chatId,
    {
      input: {
        ...input,
        lastCommand: parsedLastCommand
      },
      lastCommand: parsedLastCommand
    }
  ) as AgentResult;
  
  // Save the last successful command for retry functionality
  await saveLastCommand(agentResult, chatId, userText, input);
  
  return agentResult;
}

