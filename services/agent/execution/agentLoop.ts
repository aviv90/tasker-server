import conversationManager from '../../conversationManager';
import logger from '../../../utils/logger';
import { AgentResult, AgentConfig, ToolFunctionResponse } from '../types';
import { AgentContextState as AgentContext } from './context';
import { FunctionCall } from '../utils/ackUtils';
import toolHandler from './toolHandler';
import resultProcessor from './resultProcessor';

// Type definitions (kept for local usage if needed, or moved to types.ts)
interface GeminiChatSession {
  sendMessage(prompt: string | ToolFunctionResponse[]): Promise<{
    response: {
      text(): string;
      functionCalls(): FunctionCall[] | undefined;
    };
  }>;
}



/**
 * Single-step agent execution loop
 * Handles tool calling iterations until final response is reached
 */
class AgentLoop {
  // Track tools that already received ACK to prevent duplicate ACKs
  private ackedTools: Set<string> = new Set();
  // Track creation tools that already succeeded to prevent duplicate execution
  private succeededCreationTools: Set<string> = new Set();

  /**
   * Execute agent loop
   */
  async execute(chat: GeminiChatSession, prompt: string, chatId: string, context: AgentContext, maxIterations: number, agentConfig: AgentConfig): Promise<AgentResult> {
    // Reset tracking sets for each new execution
    this.ackedTools = new Set();
    this.succeededCreationTools = new Set();

    let response = await chat.sendMessage(prompt);
    let iterationCount = 0;

    while (iterationCount < maxIterations) {
      iterationCount++;
      logger.debug(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);

      const result = response.response;
      const functionCalls = result.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        // No more function calls - final answer
        const rawText = result.text();

        logger.info(`✅ [Agent] Completed in ${iterationCount} iterations`);

        // Save context if enabled
        if (agentConfig.contextMemoryEnabled) {
          await conversationManager.saveAgentContext(chatId, {
            toolCalls: context.toolCalls,
            generatedAssets: context.generatedAssets
          });
          logger.debug(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
        }

        // Process final result using ResultProcessor
        return resultProcessor.processResult(rawText, context, iterationCount);
      }

      // Execute function calls (in parallel logic handled by ToolHandler)
      logger.debug(`🔧 [Agent] Processing ${functionCalls.length} potential function call(s)`);

      const functionResponses = await toolHandler.executeBatch(
        functionCalls,
        context,
        this.ackedTools,
        this.succeededCreationTools,
        chatId
      );

      // If no valid responses (e.g. all filtered), and ToolHandler didn't return feedback, 
      // we might need to handle it. But ToolHandler returns feedback for filtered calls now.

      // Send function responses back to Gemini
      response = await chat.sendMessage(functionResponses as any);
    }

    // Max iterations reached
    logger.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);

    // We can use ResultProcessor fallback or construct error result manually.
    // Manual construction is safer for "Max Iterations" specific error.
    return {
      success: false,
      error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
      toolsUsed: Object.keys(context.previousToolResults),
      iterations: iterationCount,
      toolCalls: context.toolCalls,
      toolResults: context.previousToolResults,
      multiStep: false,
      alreadySent: false,
    };
  }
}

export default new AgentLoop();
