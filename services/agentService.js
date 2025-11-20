const { GoogleGenerativeAI } = require('@google/generative-ai');
const conversationManager = require('./conversationManager');
const prompts = require('../config/prompts');
const { detectLanguage, extractDetectionText } = require('../utils/agentHelpers');
const { getLanguageInstruction } = require('./agent/utils/languageUtils');
const { planMultiStepExecution } = require('./multiStepPlanner');

// Import execution modules
const multiStepExecution = require('./agent/execution/multiStep');
const agentLoop = require('./agent/execution/agentLoop');
const contextManager = require('./agent/execution/context');
const { allTools: agentTools } = require('./agent/tools');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 */

/**
 * Execute an agent query with autonomous tool usage
 * @param {string} prompt - User's question/request
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Additional options
 * @returns {Object} - Response with text and tool usage info
 */
async function executeAgentQuery(prompt, chatId, options = {}) {
  // Detect user's language
  const userLanguage = detectLanguage(prompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // ⚙️ Configuration: Load from env or use defaults
  const agentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-3-pro-preview',
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8,
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000, // 4 minutes
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  };
  
  // 📎 Extract media URLs from options (for planner context)
  const input = options.input || {};
  const imageUrl = input.imageUrl || null;
  const videoUrl = input.videoUrl || null;
  const audioUrl = input.audioUrl || null;
  
  // 🔍 Extract clean user text for multi-step detection (remove metadata)
  const detectionText = extractDetectionText(prompt);
  
  // 📎 Add media context for planner (so it knows about attached images/videos)
  let plannerContext = detectionText;
  if (imageUrl) {
    plannerContext = `[תמונה מצורפת]\n${detectionText}`;
  } else if (videoUrl) {
    plannerContext = `[וידאו מצורף]\n${detectionText}`;
  } else if (audioUrl) {
    plannerContext = `[אודיו מצורף]\n${detectionText}`;
  }
  
  // 🧠 Use LLM-based planner to intelligently detect and plan multi-step execution
  let plan = await planMultiStepExecution(plannerContext);
  
  console.log(`🔍 [Planner] Plan result:`, JSON.stringify({
    isMultiStep: plan.isMultiStep,
    stepsLength: plan.steps?.length,
    fallback: plan.fallback,
    steps: plan.steps?.map(s => ({ stepNumber: s.stepNumber, tool: s.tool, action: s.action?.substring(0, 50) }))
  }, null, 2));
  
  // If planner failed, treat as single-step (no heuristic fallback - rely on LLM only)
  if (plan.fallback) {
    console.log(`⚠️ [Planner] Planner failed, treating as single-step`);
    plan = { isMultiStep: false };
  }
  
  // 🔄 Multi-step execution - execute each step sequentially
  if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
    return await multiStepExecution.execute(plan, chatId, options, languageInstruction, agentConfig);
  }
  
  // Continue with single-step execution if not multi-step
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
  // System prompt for the agent (SSOT - from config/prompts.js)
  const systemInstruction = prompts.agentSystemInstruction(languageInstruction);

  // 🧠 Context for tool execution (load previous context if enabled)
  let context = contextManager.createInitialContext(chatId, options);
  context = await contextManager.loadPreviousContext(chatId, context, agentConfig.contextMemoryEnabled);

  // Conversation history for the agent
  const chat = model.startChat({
    history: [],
    tools: [{ functionDeclarations }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }]
    }
  });

  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async () => {
    return await agentLoop.execute(chat, prompt, chatId, context, maxIterations, agentConfig);
  };
  
  // ⏱️ Execute agent with timeout
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Agent timeout')), agentConfig.timeoutMs)
  );
  
  try {
    const result = await Promise.race([agentExecution(), timeoutPromise]);
    
    // Save context after execution if enabled
    if (result.success && agentConfig.contextMemoryEnabled) {
      await contextManager.saveContext(chatId, context, agentConfig.contextMemoryEnabled);
    }
    
    return result;
  } catch (error) {
    if (error.message === 'Agent timeout') {
      console.error(`⏱️ [Agent] Timeout after ${agentConfig.timeoutMs}ms`);
      return {
        success: false,
        error: `⏱️ הפעולה ארכה יותר מדי. נסה בקשה פשוטה יותר או נסה שוב מאוחר יותר.`,
        toolsUsed: Object.keys(context.previousToolResults),
        timeout: true,
        toolCalls: context.toolCalls,
        toolResults: context.previousToolResults,
        multiStep: false,
        alreadySent: false
      };
    }
    throw error;
  }
}

module.exports = {
  executeAgentQuery
};
