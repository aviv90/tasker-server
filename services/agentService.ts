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
import { detectLanguage, extractDetectionText } from '../utils/agentHelpers';
import { getLanguageInstruction } from './agent/utils/languageUtils';
import { planMultiStepExecution } from './multiStepPlanner';
import multiStepExecution from './agent/execution/multiStep';
import agentLoop from './agent/execution/agentLoop';
import contextManager from './agent/execution/context';
import { allTools as agentTools } from './agent/tools';

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
  
  // ⚙️ Configuration: Load from env or use defaults
  const agentConfig: AgentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
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
    steps: plan.steps?.map((s: { stepNumber?: number; tool?: string | null; action?: string }) => ({ 
      stepNumber: s.stepNumber, 
      tool: s.tool, 
      action: s.action?.substring(0, 50) 
    }))
  }, null, 2));
  
  // If planner failed, treat as single-step (no heuristic fallback - rely on LLM only)
  if (plan.fallback) {
    console.log(`⚠️ [Planner] Planner failed, treating as single-step`);
    plan = { isMultiStep: false };
  }
  
  // 🔄 Multi-step execution - execute each step sequentially
  if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
    // Cast to any to bypass strict Plan type check (structure is compatible at runtime)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await multiStepExecution.execute(plan as any, chatId, options, languageInstruction, agentConfig) as AgentResult;
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
  
  // Conversation history for the agent
  const chat = model.startChat({
    history: [],
    tools: [{ functionDeclarations: functionDeclarations as never[] }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }]
    }
  });
  
  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async (): Promise<AgentResult> => {
    return await agentLoop.execute(chat, prompt, chatId, context, maxIterations, agentConfig) as AgentResult;
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
      console.error(`⏱️ [Agent] Timeout after ${agentConfig.timeoutMs}ms`);
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
