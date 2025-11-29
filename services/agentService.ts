/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../config/prompts';
import { config } from '../config';
import { detectLanguage, extractDetectionText } from '../utils/agentHelpers';
import { getLanguageInstruction } from './agent/utils/languageUtils';
import { planMultiStepExecution } from './multiStepPlanner';
import multiStepExecution from './agent/execution/multiStep';
import agentLoop from './agent/execution/agentLoop';
import contextManager from './agent/execution/context';
import { allTools as agentTools } from './agent/tools';
import logger from '../utils/logger';
import { getChatHistory } from '../utils/chatHistoryService';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Agent configuration
 */
interface AgentConfig {
  model: string;
  maxIterations: number;
  timeoutMs: number;
  contextMemoryEnabled: boolean;
}

/**
 * Agent input options
 */
interface AgentInput {
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  quotedMessageId?: string | null;
  lastCommand?: unknown;
  originalMessageId?: string;
  [key: string]: unknown;
}

/**
 * Agent execution options
 */
interface AgentOptions {
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
 * Agent execution result
 */
interface AgentResult {
  success?: boolean;
  text?: string;
  error?: string;
  toolsUsed?: string[];
  timeout?: boolean;
  toolCalls?: unknown[];
  toolResults?: Record<string, unknown>;
  multiStep?: boolean;
  alreadySent?: boolean;
  originalMessageId?: string;
  plan?: unknown;
  stepsCompleted?: number;
  totalSteps?: number;
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
  // Detect user's language
  const userLanguage = detectLanguage(prompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // ⚙️ Configuration: Use centralized config (SSOT)
  const agentConfig: AgentConfig = {
    model: config.agent.model,
    maxIterations: config.agent.maxIterations,
    timeoutMs: config.agent.timeoutMs,
    contextMemoryEnabled: config.agent.contextMemoryEnabled
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
  
  logger.info(`🔍 [Planner] Plan result: ${JSON.stringify({
    isMultiStep: plan.isMultiStep,
    stepsLength: plan.steps?.length,
    fallback: plan.fallback,
    steps: plan.steps?.map((s: { stepNumber?: number; tool?: string | null; action?: string }) => ({ 
      stepNumber: s.stepNumber, 
      tool: s.tool, 
      action: s.action?.substring(0, 50) 
    }))
  }, null, 2)}`);
  
  // If planner failed, treat as single-step (no heuristic fallback - rely on LLM only)
  if (plan.fallback) {
    logger.warn('⚠️ [Planner] Planner failed, treating as single-step');
    plan = { isMultiStep: false };
  }
  
  // 🔄 Multi-step execution - execute each step sequentially
  if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
    // Cast to any to bypass strict Plan type check (structure is compatible at runtime)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await multiStepExecution.execute(plan as any, chatId, options, languageInstruction, agentConfig) as unknown as AgentResult;
  }
  
  // Continue with single-step execution if not multi-step
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools as Record<string, { declaration: unknown }>).map((tool) => tool.declaration) as unknown[];
  
  // System prompt for the agent (SSOT - from config/prompts.ts)
  const systemInstruction = prompts.agentSystemInstruction(languageInstruction);

  // 🧠 Context for tool execution (load previous context if enabled)
  let context = contextManager.createInitialContext(chatId, options);
  context = await contextManager.loadPreviousContext(chatId, context, agentConfig.contextMemoryEnabled);

  // 🧵 Conversation history for the agent (natural chat continuity)
  // CRITICAL: Smart history management - send history only when it helps, not when it confuses
  const useConversationHistory = options.useConversationHistory !== false;
  let history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (useConversationHistory) {
    try {
      const trimmedPrompt = prompt.trim();
      
      // =============================================================================
      // STEP 1: Check if this is a SELF-CONTAINED request (doesn't need history)
      // These are clear, complete requests that work better WITHOUT history context
      // =============================================================================
      const selfContainedPatterns = [
        // Media creation: צור תמונה, צור וידאו, צור שיר
        /^#?\s*(צור|create|generate|ייצר|צייר|draw|make)\s+(תמונה|image|וידאו|video|שיר|song|מוזיקה|music)/i,
        /^#?\s*(תמונה|image|וידאו|video|שיר|song)\s+(של|of|about)\s+/i,
        
        // Send links/location: שלח קישור, שלח מיקום
        /^#?\s*(שלח|send|שלחי|שלחו)\s+(קישור|link|לינק|מיקום|location)/i,
        /^#?\s*(קישור|link|לינק|מיקום|location)\s+(ל|to|של|of|ב|in|באזור)/i,
        
        // Web search: חפש באינטרנט, מצא מידע על
        /^#?\s*(חפש|search|find|מצא)\s+(באינטרנט|מידע|information|לינק|link|קישור)/i,
        /^#?\s*(חפש|search|find|מצא)\s+.{3,}/i, // Any search with content
        
        // Translation: תרגם ל-X
        /^#?\s*(תרגם|translate)\s+(ל|to)\s*/i,
        
        // Text-to-speech: אמור X, תשמיע X
        /^#?\s*(אמור|say|תשמיע|speak|תקרא|read)\s+.{3,}/i,
        
        // Time/date queries: מה השעה, מה התאריך
        /^#?\s*(מה השעה|what time|מה התאריך|what date|מה היום|what day)/i,
        
        // Google Drive search (explicit)
        /^#?\s*(חפש|search).*(במסמכים|בקבצים|ב-?drive|in\s*drive|in\s*documents)/i,
        
        // Direct media requests with clear content
        /^#?\s*(שלח|send)\s+(תמונה|image|וידאו|video)\s+(של|of)\s+/i
      ];
      
      // =============================================================================
      // STEP 2: Check if this is a CONTINUATION that NEEDS history
      // Short responses, follow-ups, and references to previous conversation
      // =============================================================================
      const needsHistoryPatterns = [
        // Short responses (likely answering a question)
        /^(כן|לא|אוקיי|בסדר|טוב|נכון|yes|no|ok|okay|sure|right|exactly|בדיוק)\.?$/i,
        
        // Continuations and follow-ups
        /^(עוד|תמשיך|continue|more|another|אחד נוסף|עוד אחד|תן עוד|give me more)$/i,
        /^(מה עוד|what else|ומה עוד|and what else)/i,
        
        // Thanks/feedback (might be end of conversation or continuation)
        /^(תודה|thanks|thank you|מעולה|great|awesome|יופי|נהדר)\.?$/i,
        
        // References to previous conversation
        /(מה (ש)?אמרתי|what i said|מה (ש)?ציינתי|מה (ש)?דיברנו|מה (ש)?שאלתי)/i,
        /(קודם|earlier|before|לפני|previous|את זה|this one|אותו|the same)/i,
        /(כמו (ש)?|like (the)?|דומה ל|similar to)/i,
        
        // Questions about the conversation
        /(מתי|when|איפה|where|למה|why|איך|how).*(אמרת|said|ציינת|mentioned|דיברנו|discussed)/i,
        
        // Retry/repeat requests
        /(שוב|again|נסה שוב|try again|חזור|repeat)/i,
        
        // Clarifications
        /(מה התכוונת|what do you mean|לא הבנתי|didn't understand|תסביר|explain)/i
      ];
      
      const isSelfContained = selfContainedPatterns.some(p => p.test(trimmedPrompt));
      const needsHistory = needsHistoryPatterns.some(p => p.test(trimmedPrompt));
      
      // =============================================================================
      // STEP 3: Decision logic
      // - If explicitly needs history → load history
      // - If self-contained → skip history
      // - Otherwise (regular chat) → load history for natural conversation
      // =============================================================================
      let shouldLoadHistory = false;
      
      if (needsHistory) {
        // Explicit continuation/reference - always load history
        shouldLoadHistory = true;
        logger.debug('🧠 [Agent] Continuation/reference detected - loading history for context');
      } else if (isSelfContained) {
        // Self-contained request - skip history to avoid confusion
        shouldLoadHistory = false;
        logger.debug('🧠 [Agent] Self-contained request detected - skipping history');
      } else {
        // Regular message (chat) - load history for natural conversation
        shouldLoadHistory = true;
        logger.debug('🧠 [Agent] Regular message - loading history for natural conversation');
      }
      
      if (shouldLoadHistory) {
        // Use DB cache for fast retrieval (10 messages for agent context)
        const historyResult = await getChatHistory(chatId, 10, { format: 'internal', useDbCache: true });
        if (historyResult.success && historyResult.messages.length > 0) {
          // Convert to Gemini format
          const rawHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = historyResult.messages.map(msg => ({
            role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
            parts: [{ text: msg.content }]
          }));
          
          // CRITICAL: Gemini requires history to start with 'user' role
          // If history starts with 'model', remove leading model messages
          let validHistory = rawHistory;
          while (validHistory.length > 0 && validHistory[0] && validHistory[0].role === 'model') {
            logger.debug(`🧠 [Agent] Removing leading 'model' message from history (Gemini requirement)`);
            validHistory = validHistory.slice(1);
          }
          
          // Also ensure history ends with 'user' (current message will be added)
          // If last message is 'model', that's OK - current user message will follow
          
          history = validHistory;
          logger.debug(`🧠 [Agent] Using ${history.length} previous messages as conversation history`);
        } else {
          logger.debug('🧠 [Agent] No previous messages found for conversation history');
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn('⚠️ [Agent] Failed to load chat history for context (continuing without it)', {
        chatId,
        error: errorMessage
      });
    }
  } else {
    logger.info('🧠 [Agent] Conversation history disabled for this request (useConversationHistory=false)');
  }

  // Conversation history for the agent
  const chat = model.startChat({
    history,
    tools: [{ functionDeclarations: functionDeclarations as never[] }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }]
    }
  });

  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async (): Promise<AgentResult> => {
    return await agentLoop.execute(chat, prompt, chatId, context, maxIterations, agentConfig) as unknown as AgentResult;
  };
  
  // ⏱️ Execute agent with timeout
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Agent timeout')), agentConfig.timeoutMs)
  );
  
  try {
    const result = await Promise.race([agentExecution(), timeoutPromise]) as AgentResult;
    
    // Save context after execution if enabled
    if (result.success && agentConfig.contextMemoryEnabled) {
      await contextManager.saveContext(chatId, context, agentConfig.contextMemoryEnabled);
    }
    
    return result;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Agent timeout') {
      logger.error(`⏱️ [Agent] Timeout after ${agentConfig.timeoutMs}ms`);
      return {
        success: false,
        error: `⏱️ הפעולה ארכה יותר מדי. נסה בקשה פשוטה יותר או נסה שוב מאוחר יותר.`,
        toolsUsed: Object.keys((context.previousToolResults as Record<string, unknown>) || {}),
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
