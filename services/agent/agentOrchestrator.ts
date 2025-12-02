/**
 * Agent Orchestrator
 * 
 * Orchestrates the entire agent execution flow:
 * 1. Configuration & Setup
 * 2. Planning (Multi-step vs Single-step)
 * 3. History Management
 * 4. Execution (Agent Loop or Multi-step)
 * 5. Context Management
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../../config/prompts';
import { config } from '../../config';
import { detectLanguage, extractDetectionText } from '../../utils/agentHelpers';
import { getLanguageInstruction } from './utils/languageUtils';
import { planMultiStepExecution } from '../multiStepPlanner';
import multiStepExecution from './execution/multiStep';
import agentLoop from './execution/agentLoop';
import contextManager from './execution/context';
import { allTools as agentTools } from './tools';
import logger from '../../utils/logger';
import { AgentConfig, AgentOptions, AgentResult } from '../agentService';

export class AgentOrchestrator {
    private genAI: GoogleGenerativeAI;

    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    }

    /**
     * Execute an agent query
     */
    async execute(prompt: string, chatId: string, options: AgentOptions = {}): Promise<AgentResult> {
        // 1. Detect Language & Setup Config
        const userLanguage = detectLanguage(prompt);
        const languageInstruction = getLanguageInstruction(userLanguage);
        const agentConfig: AgentConfig = {
            model: config.agent.model,
            maxIterations: config.agent.maxIterations,
            timeoutMs: config.agent.timeoutMs,
            contextMemoryEnabled: config.agent.contextMemoryEnabled
        };

        // 2. Planning
        const plan = await this.planExecution(prompt, options);

        // 3. Multi-step Execution
        if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
            // Cast to any to bypass strict Plan type check
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await multiStepExecution.execute(plan as any, chatId, options, languageInstruction, agentConfig) as unknown as AgentResult;
        }

        // 4. Single-step Execution
        return await this.executeSingleStep(prompt, chatId, options, languageInstruction, agentConfig);
    }

    /**
     * Plan execution strategy
     */
    private async planExecution(prompt: string, options: AgentOptions) {
        const input = options.input || {};
        const imageUrl = input.imageUrl || null;
        const videoUrl = input.videoUrl || null;
        const audioUrl = input.audioUrl || null;

        const detectionText = extractDetectionText(prompt);

        let plannerContext = detectionText;
        if (imageUrl) plannerContext = `[תמונה מצורפת]\n${detectionText}`;
        else if (videoUrl) plannerContext = `[וידאו מצורף]\n${detectionText}`;
        else if (audioUrl) plannerContext = `[אודיו מצורף]\n${detectionText}`;

        let plan = await planMultiStepExecution(plannerContext);

        logger.info(`🔍 [Planner] Plan result: ${JSON.stringify({
            isMultiStep: plan.isMultiStep,
            stepsLength: plan.steps?.length,
            fallback: plan.fallback
        })}`);

        if (plan.fallback) {
            logger.warn('⚠️ [Planner] Planner failed, treating as single-step');
            plan = { isMultiStep: false };
        }

        return plan;
    }

    /**
     * Execute single-step agent loop
     */
    private async executeSingleStep(
        prompt: string,
        chatId: string,
        options: AgentOptions,
        languageInstruction: string,
        agentConfig: AgentConfig
    ): Promise<AgentResult> {
        const maxIterations = options.maxIterations || agentConfig.maxIterations;
        const model = this.genAI.getGenerativeModel({ model: agentConfig.model });

        // Prepare tools
        const functionDeclarations = Object.values(agentTools).map((tool) => tool.declaration);

        // Prepare system instruction
        let systemInstruction = prompts.agentSystemInstruction(languageInstruction);

        // Load Context
        let context = contextManager.createInitialContext(chatId, options);
        context = await contextManager.loadPreviousContext(chatId, context, agentConfig.contextMemoryEnabled);

        // Load History
        const useConversationHistory = options.useConversationHistory !== false;
        const { historyStrategy } = await import('./historyStrategy');
        const historyResult = await historyStrategy.processHistory(chatId, prompt, useConversationHistory);

        if (historyResult.systemContextAddition) {
            systemInstruction += historyResult.systemContextAddition;
        }

        // Start Chat
        const chat = model.startChat({
            history: historyResult.history,
            tools: [{ functionDeclarations: functionDeclarations as never[] }],
            systemInstruction: {
                role: 'system',
                parts: [{ text: systemInstruction }]
            }
        });

        // Execute with Timeout
        const agentExecution = async (): Promise<AgentResult> => {
            return await agentLoop.execute(chat, prompt, chatId, context, maxIterations, agentConfig) as unknown as AgentResult;
        };

        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Agent timeout')), agentConfig.timeoutMs)
        );

        try {
            const result = await Promise.race([agentExecution(), timeoutPromise]) as AgentResult;

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
}

export default new AgentOrchestrator();
