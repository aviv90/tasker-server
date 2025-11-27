/**
 * Multi-step execution handler
 * Executes multiple steps sequentially with proper context and result handling
 */

import { executeSingleStep } from './singleStep';
import { sendToolAckMessage, FunctionCall } from '../utils/ackUtils';
import { formatProviderError } from '../../../utils/errorHandler';
import { getServices } from '../utils/serviceLoader';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { allTools as agentTools } from '../tools';
import prompts from '../../../config/prompts';
import resultSender from './resultSender';
import { TIME } from '../../../utils/constants';
import { cleanJsonWrapper, cleanMediaDescription } from '../../../utils/textSanitizer';
import { cleanAgentText } from '../../../services/whatsapp/utils';
import logger from '../../../utils/logger';

interface Step {
    tool?: string;
    parameters?: Record<string, unknown>;
    stepNumber: number;
    action: string;
}

interface Plan {
    steps: Step[];
}

interface ExecutionOptions {
    input?: {
        originalMessageId?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface AgentConfig {
    model: string;
    maxIterations: number;
    timeoutMs: number;
    contextMemoryEnabled?: boolean;
}

interface StepResult {
    success: boolean;
    text?: string;
    imageUrl?: string | null;
    imageCaption?: string;
    caption?: string;
    videoUrl?: string | null;
    audioUrl?: string | null;
    poll?: { question: string; options: string[] } | null;
    latitude?: string | null;
    longitude?: string | null;
    locationInfo?: string | null;
    toolsUsed?: string[];
    iterations?: number;
    error?: string;
    [key: string]: unknown;
}

class MultiStepExecution {
  /**
   * Execute multi-step plan
   * @param {Object} plan - Plan from planner
   * @param {string} chatId - Chat ID
   * @param {Object} options - Execution options
   * @param {string} languageInstruction - Language instruction
   * @param {Object} agentConfig - Agent configuration
   * @returns {Promise<Object>} - Execution result
   */
  async execute(plan: Plan, chatId: string, options: ExecutionOptions, languageInstruction: string, agentConfig: AgentConfig): Promise<StepResult> {
    logger.info(`✅ [Planner] Entering multi-step execution with ${plan.steps.length} steps`);
    
    // Adjust config for multi-step
    agentConfig.maxIterations = Math.max(agentConfig.maxIterations, 15);
    agentConfig.timeoutMs = Math.max(agentConfig.timeoutMs, TIME.MULTI_STEP_MIN_TIMEOUT);
    
    const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
    
    const stepResults: StepResult[] = [];
    const accumulatedText = '';
    const finalAssets: {
        imageUrl: string | null;
        imageCaption: string;
        videoUrl: string | null;
        audioUrl: string | null;
        poll: { question: string; options: string[] } | null;
        latitude: string | null;
        longitude: string | null;
        locationInfo: string | null;
        error?: string;
    } = {
      imageUrl: null,
      imageCaption: '',
      videoUrl: null,
      audioUrl: null,
      poll: null,
      latitude: null,
      longitude: null,
      locationInfo: null
    };
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step) continue; // Safety check for TypeScript
      const toolName = step.tool || null;
      const toolParams = step.parameters || {};
      
      // Send Ack BEFORE executing the step
      if (toolName) {
        logger.debug(`📢 [Multi-step] Sending Ack for Step ${step.stepNumber}/${plan.steps.length} (${toolName}) BEFORE execution`);
        // Get quotedMessageId from options.input if available
        const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
        const ackCalls: FunctionCall[] = [{ name: toolName, args: toolParams }];
        await sendToolAckMessage(chatId, ackCalls, quotedMessageId || undefined);
      }
      
      // Build focused prompt for this step
      let stepPrompt = step.action;
      
      // Add context from previous steps
      if (stepResults.length > 0) {
        const previousContext = stepResults.map((res, idx) => {
          let summary = `Step ${idx + 1}:`;
          if (res.text) summary += ` ${res.text.substring(0, 200)}`;
          if (res.imageUrl) summary += ` [Created image]`;
          if (res.videoUrl) summary += ` [Created video]`;
          if (res.audioUrl) summary += ` [Created audio]`;
          if (res.poll) summary += ` [Created poll: "${res.poll.question}"]`;
          if (res.latitude && res.longitude) summary += ` [Sent location]`;
          return summary;
        }).join('\n');
        
        stepPrompt = `CONTEXT from previous steps:\n${previousContext}\n\nCURRENT TASK: ${step.action}`;
      }
      
      // If planner provided tool and parameters, add them to the prompt
      if (toolName && Object.keys(toolParams).length > 0) {
        const paramsStr = Object.entries(toolParams)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        stepPrompt = `${stepPrompt}\n\nTool: ${toolName}\nParameters: ${paramsStr}`;
      }
      
      // Execute this step
      try {
        logger.debug(`🔄 [Multi-step] Executing Step ${step.stepNumber}/${plan.steps.length}: ${step.action}`);
        const stepResult = await executeSingleStep(stepPrompt, chatId, {
          ...options,
          maxIterations: 5,
          languageInstruction,
          agentConfig,
          functionDeclarations,
          systemInstruction: prompts.singleStepInstruction(languageInstruction),
          expectedTool: toolName
        });
        
        logger.debug(`🔍 [Multi-step] Step ${step.stepNumber} executeSingleStep returned:`, {
          success: stepResult.success,
          hasLocation: !!(stepResult.latitude && stepResult.longitude),
          hasPoll: !!stepResult.poll,
          hasImage: !!stepResult.imageUrl,
          hasVideo: !!stepResult.videoUrl,
          hasAudio: !!stepResult.audioUrl,
          hasText: !!stepResult.text,
          toolsUsed: stepResult.toolsUsed,
          error: stepResult.error
        });
        
        if (stepResult.success) {
          stepResults.push(stepResult);
          
          // Get quotedMessageId from options.input if available
          const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
          logger.debug(`🔍 [MultiStep] quotedMessageId for step ${step.stepNumber}: ${quotedMessageId}, from options.input: ${options.input?.originalMessageId}`);
          
          // Send ALL results immediately in order
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await resultSender.sendStepResults(chatId, stepResult as any, step.stepNumber, quotedMessageId);
          
          logger.info(`✅ [Multi-step] Step ${step.stepNumber}/${plan.steps.length} completed and ALL results sent`);
        } else {
          // Step failed - try fallback
          logger.error(`❌ [Agent] Step ${step.stepNumber}/${plan.steps.length} failed:`, { error: stepResult.error });
          
          // Get quotedMessageId to pass to fallback
          const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fallbackResult = await this.tryFallback(chatId, toolName, toolParams, step, stepResult as any, quotedMessageId || null);
          if (fallbackResult) {
            stepResults.push(fallbackResult);
          } else {
            // Send error for non-creation tools
            if (!this.isCreationTool(toolName || '')) {
              await this.sendError(chatId, stepResult.error || 'Unknown error', step.stepNumber, quotedMessageId || null);
            }
          }
        }
      } catch (stepError: any) {
        logger.error(`❌ [Agent] Error executing step ${step.stepNumber}:`, { error: stepError.message });
        const quotedMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
        await this.sendError(chatId, stepError.message || stepError.toString(), step.stepNumber, quotedMessageId || null, true);
      }
    }
    
    // Clean and process final text
    let finalText = cleanJsonWrapper(accumulatedText.trim());
    const lines = finalText.split('\n').filter(line => line.trim());
    const uniqueLines: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueLines.push(line);
      }
    }
    finalText = uniqueLines.join('\n').trim();
    
    logger.info(`🏁 [Agent] Multi-step execution completed: ${stepResults.length}/${plan.steps.length} steps successful`);
    
    // Get originalMessageId from options.input for quoting
    const originalMessageId = extractQuotedMessageId({ originalMessageId: options.input?.originalMessageId });
    
    return {
      success: true,
      text: finalText,
      ...finalAssets,
      toolsUsed: stepResults.flatMap(r => r.toolsUsed || []),
      iterations: stepResults.reduce((sum, r) => sum + (r.iterations || 0), 0),
      multiStep: true,
      plan: plan, // CRITICAL: Save the original plan for retry functionality
      stepsCompleted: stepResults.length,
      totalSteps: plan.steps.length,
      alreadySent: true,
      originalMessageId: originalMessageId || undefined // Pass originalMessageId for quoting
    };
  }

  /**
   * Try fallback for creation tools
   */
  async tryFallback(chatId: string, toolName: string | null, toolParams: Record<string, unknown>, step: Step, stepResult: StepResult, quotedMessageId: string | null = null): Promise<StepResult | null> {
    
    if (!toolName || !this.isCreationTool(toolName)) {
      return null;
    }
    
    // Don't send initial error here - it's already sent by the tool itself
    // Just log it
    if (stepResult.error) {
      logger.debug(`🔍 [Multi-step Fallback] Initial error: ${stepResult.error}`);
    }
    
    logger.debug(`🔄 [Multi-step Fallback] Attempting automatic fallback for ${toolName}...`);
    
    try {
      const { greenApiService } = getServices();
      
      // Determine provider order based on what failed
      const avoidProvider = (toolParams.provider as string) || 'gemini';
      const imageProviders = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
      const videoProviders = ['veo3', 'sora', 'kling'].filter(p => p !== avoidProvider);
      
      const providersToTry = toolName.includes('image') ? imageProviders : videoProviders;
      
      // Try each provider with Ack
      for (const provider of providersToTry) {
        logger.debug(`🔄 [Multi-step Fallback] Trying ${provider}...`);
        
        // Send Ack for this fallback attempt
        const ackCalls: FunctionCall[] = [{ name: toolName, args: { provider } }];
        await sendToolAckMessage(chatId, ackCalls, quotedMessageId || undefined);
        
        try {
          const result = await this.executeFallbackTool(toolName, provider, toolParams, step, chatId);
          
            if (result && result.success) {
            logger.info(`✅ [Multi-step Fallback] ${provider} succeeded!`);
            
            // Send the result
            if (result.imageUrl) {
              const fullImageUrl = normalizeStaticFileUrl(result.imageUrl);
              
              // CRITICAL: Caption MUST be sent with the image, not in a separate message
              // Priority: imageCaption > caption > text (if text is not generic success message)
              let caption = result.caption || result.imageCaption || '';
              
              // If no caption but text exists and is not a generic success message, use text as caption
              if (!caption && result.text && typeof result.text === 'string' && result.text.trim()) {
                const textToCheck = cleanMediaDescription(result.text);
                const genericSuccessPatterns = [
                  /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
                  /^✅\s*תמונה\s*נוצרה/i,
                  /^✅\s*נוצרה\s*בהצלחה/i,
                  /^✅\s*image\s*created\s*successfully/i,
                  /^✅\s*successfully\s*created/i
                ];
                const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
                
                if (!isGenericSuccess) {
                  caption = result.text;
                }
              }
              
              const cleanCaption = cleanMediaDescription(caption || '');
              
              // Send image WITH caption (caption is always sent with media, never separately)
              await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, cleanCaption, quotedMessageId || undefined, 1000);
              logger.debug(`✅ [Multi-step Fallback] Image sent successfully with caption`);

              // Only send additional text in a separate message if:
              // 1. Text exists and is different from caption
              // 2. Text is not a generic success message
              // 3. Text is meaningfully different (more than just whitespace/formatting)
              if (result.text && typeof result.text === 'string' && result.text.trim()) {
                const textToCheck = cleanMediaDescription(result.text);
                const captionToCheck = cleanMediaDescription(caption);

                // Skip generic success messages - they're redundant when image is already sent
                const genericSuccessPatterns = [
                  /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
                  /^✅\s*תמונה\s*נוצרה/i,
                  /^✅\s*נוצרה\s*בהצלחה/i,
                  /^✅\s*image\s*created\s*successfully/i,
                  /^✅\s*successfully\s*created/i
                ];
                const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));

                if (isGenericSuccess) {
                  logger.debug(`⏭️ [Multi-step Fallback] Skipping generic success message after image`);
                }
                // Only send if text is meaningfully different from caption
                else if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
                  const additionalText = cleanAgentText(result.text);
                  if (additionalText && additionalText.trim()) {
                    logger.debug(`📝 [Multi-step Fallback] Sending additional text after image (${additionalText.length} chars)`);
                    await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
                  }
                }
              }
            }
            
            if (result.videoUrl) {
              const fullVideoUrl = normalizeStaticFileUrl(result.videoUrl);
              
              // CRITICAL: Caption MUST be sent with the video, not in a separate message
              // Priority: videoCaption > caption > text (if text is not generic success message)
              let caption = result.videoCaption || result.caption || '';
              
              // If no caption but text exists and is not a generic success message, use text as caption
              if (!caption && result.text && typeof result.text === 'string' && result.text.trim()) {
                const textToCheck = cleanMediaDescription(result.text);
                const genericSuccessPatterns = [
                  /^✅\s*וידאו\s*נוצר\s*בהצלחה/i,
                  /^✅\s*וידאו\s*נוצר/i,
                  /^✅\s*video\s*created\s*successfully/i,
                  /^✅\s*successfully\s*created/i
                ];
                const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
                
                if (!isGenericSuccess) {
                  caption = result.text;
                }
              }
              
              const cleanCaption = cleanMediaDescription(caption || '');
              
              // Send video WITH caption (caption is always sent with media, never separately)
              await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, cleanCaption, quotedMessageId || undefined, 1000);
              logger.debug(`✅ [Multi-step Fallback] Video sent successfully with caption`);

              // Only send additional text in a separate message if:
              // 1. Text exists and is different from caption
              // 2. Text is not a generic success message
              // 3. Text is meaningfully different (more than just whitespace/formatting)
              if (result.text && typeof result.text === 'string' && result.text.trim()) {
                const textToCheck = cleanMediaDescription(result.text);
                const captionToCheck = cleanMediaDescription(caption);
                
                // Skip generic success messages - they're redundant when video is already sent
                const genericSuccessPatterns = [
                  /^✅\s*וידאו\s*נוצר\s*בהצלחה/i,
                  /^✅\s*וידאו\s*נוצר/i,
                  /^✅\s*video\s*created\s*successfully/i,
                  /^✅\s*successfully\s*created/i
                ];
                const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
                
                if (isGenericSuccess) {
                  logger.debug(`⏭️ [Multi-step Fallback] Skipping generic success message after video`);
                }
                // Only send if text is meaningfully different from caption
                else if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
                  const additionalText = cleanAgentText(result.text);
                  if (additionalText && additionalText.trim()) {
                    logger.debug(`📝 [Multi-step Fallback] Sending additional text after video (${additionalText.length} chars)`);
                    await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
                  }
                }
              }
            }
            
            // Success message (optional) - only if no media was sent
            // Skip generic success messages if media was already sent
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((result as any).data && !result.imageUrl && !result.videoUrl) {
              const dataText = String((result as any).data).trim();
              // Skip generic success messages - they're redundant
              const genericSuccessPatterns = [
                /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
                /^✅\s*תמונה\s*נוצרה/i,
                /^✅\s*נוצרה\s*בהצלחה/i,
                /^✅\s*image\s*created\s*successfully/i,
                /^✅\s*successfully\s*created/i
              ];
              const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(dataText));
              
              if (!isGenericSuccess) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await greenApiService.sendTextMessage(chatId, (result as any).data, quotedMessageId || undefined, 1000);
              } else {
                logger.debug(`⏭️ [Multi-step Fallback] Skipping generic success message: ${dataText}`);
              }
            }
            
            return result;
          } else {
            const errorMsg = result?.error || 'Unknown error';
            logger.warn(`❌ [Multi-step Fallback] ${provider} failed: ${errorMsg}`);
            // Don't send error if it was already sent by ProviderFallback
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(result as any)?.errorsAlreadySent) {
              const formattedError = formatProviderError(provider, errorMsg);
              await greenApiService.sendTextMessage(chatId, formattedError, quotedMessageId || undefined, 1000);
            }
          }
        } catch (providerError: any) {
          const errorMsg = providerError.message || 'Unknown error';
          logger.error(`❌ [Multi-step Fallback] ${provider} threw error:`, { error: errorMsg });
          // Only send error if it wasn't already sent by ProviderFallback
          // (ProviderFallback sends errors in _handleProviderError)
          const formattedError = formatProviderError(provider, errorMsg);
          await greenApiService.sendTextMessage(chatId, formattedError, quotedMessageId || undefined, 1000);
        }
      }
      
      // All fallbacks failed
      logger.warn(`❌ [Multi-step Fallback] All providers failed for ${toolName}`);
      await greenApiService.sendTextMessage(chatId, `❌ כל הספקים נכשלו עבור ${toolName}`, quotedMessageId || undefined, 1000);
      return null;
    } catch (fallbackError: any) {
      logger.error(`❌ [Multi-step Fallback] Critical error during fallback:`, { error: fallbackError.message });
      return null;
    }
  }

  /**
   * Execute fallback tool with different provider
   */
  async executeFallbackTool(toolName: string, provider: string, toolParams: Record<string, unknown>, step: Step, chatId: string): Promise<StepResult | null> {
    const promptToUse = (toolParams.prompt as string) || (toolParams.text as string) || step.action;
    
    if (toolName === 'create_image') {
      if (!agentTools.create_image) return null;
      return await agentTools.create_image.execute({ prompt: promptToUse, provider }, { chatId }) as StepResult;
    } else if (toolName === 'create_video') {
      if (!agentTools.create_video) return null;
      return await agentTools.create_video.execute({ prompt: promptToUse, provider }, { chatId }) as StepResult;
    } else if (toolName === 'edit_image') {
      if (!agentTools.edit_image) return null;
      return await agentTools.edit_image.execute({
        image_url: toolParams.image_url,
        edit_instruction: promptToUse,
        service: provider
      }, { chatId }) as StepResult;
    } else if (toolName === 'edit_video') {
      if (!agentTools.edit_video) return null;
      return await agentTools.edit_video.execute({
        video_url: toolParams.video_url,
        edit_instruction: promptToUse,
        provider
      }, { chatId }) as StepResult;
    }
    
    return null;
  }

  /**
   * Check if tool is a creation tool
   */
  isCreationTool(toolName: string): boolean {
    const creationTools = ['create_image', 'create_video', 'edit_image', 'edit_video'];
    return creationTools.includes(toolName);
  }

  /**
   * Send error message to user
   */
  async sendError(chatId: string, error: string, stepNumber: number | null = null, quotedMessageId: string | null = null, isException: boolean = false): Promise<void> {
    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` שגיאה בביצוע שלב ${stepNumber}:` : '';
      const prefix = isException ? `❌${stepInfo}` : '❌';
      const errorMessage = error.startsWith('❌') ? error : `${prefix} ${error}`;
      await greenApiService.sendTextMessage(chatId, errorMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
      logger.debug(`📤 [Multi-step] Error sent to user${stepNumber ? ` for step ${stepNumber}` : ''}`);
    } catch (errorSendError: any) {
      logger.error(`❌ [Multi-step] Failed to send error message:`, { error: errorSendError.message });
    }
  }
}

export default new MultiStepExecution();
