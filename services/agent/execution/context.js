const conversationManager = require('../../../conversationManager');

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
  createInitialContext(chatId, options = {}) {
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
  async loadPreviousContext(chatId, context, contextMemoryEnabled) {
    if (!contextMemoryEnabled) {
      console.log(`🧠 [Agent Context] Context memory disabled - starting fresh`);
      return context;
    }

    const previousContext = await conversationManager.getAgentContext(chatId);
    if (previousContext) {
      console.log(`🧠 [Agent Context] Loaded previous context from DB with ${previousContext.toolCalls.length} tool calls`);
      return {
        ...context,
        toolCalls: previousContext.toolCalls || [],
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
  async saveContext(chatId, context, contextMemoryEnabled) {
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

module.exports = new AgentContext();

