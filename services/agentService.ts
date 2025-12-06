/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 * 
 * Refactored to use AgentOrchestrator (Phase P1-4)
 */

import agentOrchestrator from './agent/agentOrchestrator';

/**
 * Agent configuration
 */
import { AgentResult, AgentInput } from './agent/types';

/**
 * Agent execution options
 */
export interface AgentOptions {
  input?: AgentInput;
  lastCommand?: unknown;
  maxIterations?: number;
  /**
   * Control whether to include recent chat history in the model's startChat() history.
   * Default: true. Set to false for media-only secondary calls where history may confuse the model.
   */
  useConversationHistory?: boolean;
  [key: string]: unknown;
}

/**
 * Execute an agent query with autonomous tool usage
 * @param prompt - User's question/request
 * @param chatId - Chat ID for context
 * @param options - Additional options
 * @returns Response with text and tool usage info
 */
export async function executeAgentQuery(prompt: string, chatId: string, options: AgentOptions = {}): Promise<AgentResult> {
  return await agentOrchestrator.execute(prompt, chatId, options);
}

