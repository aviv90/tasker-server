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
import logger from '../utils/logger';
import conversationManager from './conversationManager';

/**
 * Normalized input structure
 */
export interface NormalizedInput {
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
export interface LastCommand {
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
import { AgentResult } from './agent/types';

/**
 * Route incoming request directly to Agent
 * @param input - Normalized input from webhook
 * @param chatId - Chat ID for context
 * @returns Agent execution result
 */
export async function routeToAgent(input: NormalizedInput, chatId: string, options: { useConversationHistory?: boolean } = {}): Promise<AgentResult> {
  logger.debug('🚀 [AGENT ROUTER] Routing to Agent for intelligent tool selection');

  const userText = input.userText || '';

  // LLM-FIRST PRINCIPLE:
  // We don't guess intent - we use observable facts from the input.
  // If media is attached, the request is self-contained (analyze/edit media).
  // If no media, let LLM have full context from history.
  //
  // See: services/agent/config/toolHistoryConfig.ts for full tool-level documentation
  const hasMedia = !!(
    input.imageUrl ||
    input.videoUrl ||
    input.audioUrl ||
    (input as Record<string, unknown>).hasImage ||
    (input as Record<string, unknown>).hasVideo ||
    (input as Record<string, unknown>).hasAudio
  );

  // Use explicit option if provided, otherwise skip history for media (self-contained)
  const useHistory = options.useConversationHistory !== undefined
    ? options.useConversationHistory
    : !hasMedia;

  if (hasMedia && !useHistory) {
    logger.info('📷 [AGENT ROUTER] Media attached - skipping history (self-contained request)');
  }

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
  // NOTE: History management is handled in agentService.ts with smart detection logic
  // (self-contained requests skip history, continuations/chat load history)
  const agentResult = await executeAgentQuery(
    contextualPrompt,
    chatId,
    {
      input: {
        ...input,
        lastCommand: parsedLastCommand
      },
      lastCommand: parsedLastCommand,
      // Allow overriding useConversationHistory from options, or force false for optimizations
      useConversationHistory: useHistory
    }
  ) as AgentResult;

  // Save the last successful command for retry functionality
  await saveLastCommand(agentResult, chatId, userText, input);

  return agentResult;
}
