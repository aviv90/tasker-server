import { Step } from './multiStep';
import { StepResult } from '../types';
import { allTools as agentTools } from '../tools';
import logger from '../../../utils/logger';

import agentContext from './context';

export class FallbackHandler {
    /**
     * Try fallback for creation tools
     */
    async tryFallback(_chatId: string, toolName: string | null, _toolParams: Record<string, unknown>, _step: Step, stepResult: StepResult, _quotedMessageId: string | null = null, _language: string = 'he'): Promise<StepResult | null> {
        if (!toolName || !this.isCreationTool(toolName) || toolName === 'create_music') {
            return null;
        }

        // Don't send initial error here - it's already sent by the tool itself
        // Just log it
        if (stepResult.error) {
            logger.debug(`🔍 [Multi-step Fallback] Initial error: ${stepResult.error}`);
        }

        // STRICT POLICY: No spontaneous switching to other providers.
        // If the requested provider fails, we stop and report the error.
        logger.info(`🛑 [Multi-step Fallback] Automatic fallback disabled by policy for ${toolName}. Stopping.`);
        return null;
    }

    /**
     * Execute fallback tool with different provider
     */
    async executeFallbackTool(toolName: string, provider: string, toolParams: Record<string, unknown>, step: Step, chatId: string): Promise<StepResult | null> {
        // This method is kept for potential future manual fallback usage, 
        // but currently unused by automatic fallback.
        const promptToUse = (toolParams.prompt as string) || (toolParams.text as string) || step.action;
        const context = agentContext.createInitialContext(chatId);

        if (toolName === 'create_image') {
            if (!agentTools.create_image) return null;
            return await agentTools.create_image.execute({ prompt: promptToUse, provider }, context) as StepResult;
        } else if (toolName === 'create_video') {
            if (!agentTools.create_video) return null;
            return await agentTools.create_video.execute({ prompt: promptToUse, provider }, context) as StepResult;
        } else if (toolName === 'edit_image') {
            if (!agentTools.edit_image) return null;
            return await agentTools.edit_image.execute({
                image_url: toolParams.image_url as string,
                edit_instruction: promptToUse,
                service: provider as 'openai' | 'gemini'
            }, context) as StepResult;
        } else if (toolName === 'image_to_video') {
            // Support fallback for image_to_video
            if (!agentTools.image_to_video) return null;
            return await agentTools.image_to_video.execute({
                image_url: toolParams.image_url as string,
                prompt: promptToUse,
                provider
            }, context) as StepResult;
        }

        return null;
    }

    /**
     * Check if tool is a creation tool
     */
    isCreationTool(toolName: string): boolean {
        const creationTools = ['create_image', 'create_video', 'edit_image', 'image_to_video'];
        return creationTools.includes(toolName);
    }
}
