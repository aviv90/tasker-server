import conversationManager from '../../conversationManager';
import logger from '../../../utils/logger';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  error?: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface GeneratedAsset {
  url: string;
  caption?: string;
  prompt?: string;
  provider?: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface PollAsset {
  question: string;
  options: string[];
  topic?: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface GeneratedAssets {
  images: GeneratedAsset[];
  videos: GeneratedAsset[];
  audio: GeneratedAsset[];
  polls?: PollAsset[];
}

export type AgentContextState = {
  chatId: string;
  previousToolResults: Record<string, unknown>;
  toolCalls: ToolCall[];
  generatedAssets: GeneratedAssets;
  lastCommand?: Record<string, unknown> | null;
  originalInput?: Record<string, unknown> | null;
  quotedContext?: Record<string, unknown> | null;
  originalMessageId?: string;
  audioUrl?: string | null;
  suppressFinalResponse: boolean;
  expectedMediaType: string | null;
  [key: string]: unknown;
};

/**
 * Agent context management
 * Handles loading and saving agent context from database
 */
class AgentContext {
  /**
   * Create initial context
   * @param {string} chatId - Chat ID
   * @param {Object} options - Options
   * @returns {Object} - Initial context object
   */
  // Keep `options` as loose as possible because callers pass a wide AgentOptions structure.
  // We only read a few known properties, everything else is forwarded opaquely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createInitialContext(chatId: string, options: Record<string, any> = {}): AgentContextState {
    return {
      chatId,
      previousToolResults: {},
      toolCalls: [],
      generatedAssets: {
        images: [],
        videos: [],
        audio: [],
        polls: []
      },
      lastCommand: options.lastCommand || null,
      originalInput: options.input || null,
      quotedContext: options.input?.quotedContext || null,
      originalMessageId: options.input?.originalMessageId,
      audioUrl: options.input?.quotedContext?.audioUrl || null,
      suppressFinalResponse: false,
      expectedMediaType: null
    };
  }

  /**
   * Load previous context from database if enabled
   * @param {string} chatId - Chat ID
   * @param {Object} context - Current context
   * @param {boolean} contextMemoryEnabled - Whether context memory is enabled
   * @returns {Promise<Object>} - Updated context
   */
  async loadPreviousContext(
    chatId: string,
    context: AgentContextState,
    contextMemoryEnabled: boolean
  ): Promise<AgentContextState> {
    if (!contextMemoryEnabled) {
      logger.info(`🧠 [Agent Context] Context memory disabled - starting fresh`);
      return context;
    }

    const previousContext = (await conversationManager.getAgentContext(chatId)) as
      | Partial<AgentContextState>
      | null;
    if (previousContext) {
      logger.info(
        `🧠 [Agent Context] Loaded previous context from DB with ${previousContext.toolCalls?.length || 0} tool calls`
      );
      return {
        ...context,
        toolCalls: (previousContext.toolCalls || context.toolCalls) as ToolCall[],
        generatedAssets: (previousContext.generatedAssets || context.generatedAssets) as GeneratedAssets
      };
    } else {
      logger.info(`🧠 [Agent Context] No previous context found in DB (starting fresh)`);
      return context;
    }
  }

  /**
   * Save context to database if enabled
   * @param {string} chatId - Chat ID
   * @param {Object} context - Context to save
   * @param {boolean} contextMemoryEnabled - Whether context memory is enabled
   * @returns {Promise<void>}
   */
  async saveContext(chatId: string, context: AgentContextState, contextMemoryEnabled: boolean): Promise<void> {
    if (!contextMemoryEnabled) {
      return;
    }

    await conversationManager.saveAgentContext(chatId, {
      toolCalls: context.toolCalls,
      generatedAssets: context.generatedAssets
    });
    logger.info(
      `🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`
    );
  }
}

const agentContext = new AgentContext();
export default agentContext;
// Ensure CommonJS compatibility
module.exports = agentContext;
module.exports.default = agentContext;
