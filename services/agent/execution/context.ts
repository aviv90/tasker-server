import conversationManager from '../../conversationManager';

type GeneratedAssets = {
  images: Array<{ url?: string; caption?: string; [key: string]: unknown }>;
  videos: Array<{ url?: string; [key: string]: unknown }>;
  audio: Array<{ url?: string; [key: string]: unknown }>;
  polls: Array<Record<string, unknown>>;
};

export type AgentContextState = {
  chatId: string;
  previousToolResults: Record<string, unknown>;
  toolCalls: Array<Record<string, unknown>>;
  generatedAssets: GeneratedAssets;
  lastCommand?: Record<string, unknown> | null;
  originalInput?: Record<string, unknown> | null;
  quotedContext?: Record<string, unknown> | null;
  audioUrl?: string | null;
  suppressFinalResponse: boolean;
  expectedMediaType: string | null;
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
      console.log(`🧠 [Agent Context] Context memory disabled - starting fresh`);
      return context;
    }

    const previousContext = (await conversationManager.getAgentContext(chatId)) as
      | Partial<AgentContextState>
      | null;
    if (previousContext) {
      console.log(
        `🧠 [Agent Context] Loaded previous context from DB with ${previousContext.toolCalls?.length || 0} tool calls`
      );
      return {
        ...context,
        toolCalls: previousContext.toolCalls || context.toolCalls,
        generatedAssets: previousContext.generatedAssets || context.generatedAssets
      };
    } else {
      console.log(`🧠 [Agent Context] No previous context found in DB (starting fresh)`);
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
    console.log(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
  }
}

const agentContext = new AgentContext();
export default agentContext;
module.exports = agentContext;

