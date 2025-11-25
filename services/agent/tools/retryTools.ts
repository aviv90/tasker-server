/**
 * Retry Tools - Command retry functionality
 * Clean, modular tool definitions following SOLID principles
 */

import conversationManager from '../../conversationManager';
import { getServices } from '../utils/serviceLoader';
import { getToolAckMessage } from '../utils/ackUtils';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import logger from '../../../utils/logger';
import { TIME } from '../../../utils/constants';
import { getLanguageInstruction } from '../utils/languageUtils';
import { detectLanguage } from '../../../utils/agentHelpers';

// Reference to agentTools (will be injected)
let agentTools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }> | null = null;

/**
 * Set agent tools reference (needed for retry)
 * @param tools - Agent tools object
 */
export function setAgentToolsReference(tools: Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>): void {
  agentTools = tools;
}

/**
 * Send specific ACK message for retry based on tool and provider
 * @param chatId - Chat ID
 * @param tool - Tool name being retried
 * @param provider - Provider to use (optional)
 * @param quotedMessageId - Quoted message ID (optional)
 */
async function sendRetryAck(
  chatId: string,
  tool: string,
  provider: string | null | undefined,
  quotedMessageId: string | null = null
): Promise<void> {
  try {
    // Skip ACK for location (no ACK needed)
    if (tool === 'send_location') {
      return;
    }
    
    // Use centralized ACK message function (SSOT - Single Source of Truth)
    const ackMessage = getToolAckMessage(tool, provider || undefined);
    
    if (ackMessage) {
      logger.debug(`📢 [RETRY ACK] ${ackMessage}`);
      const { greenApiService } = getServices();
      await greenApiService.sendTextMessage(chatId, ackMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
    }
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Error sending retry ACK:', { error: err.message, stack: err.stack });
    // Don't throw - ACK failure shouldn't break retry
  }
}

interface RetryArgs {
  provider_override?: string;
  modifications?: string;
  step_numbers?: number[];
  step_tools?: string[];
}

interface ToolContext {
  chatId?: string;
  originalInput?: {
    originalMessageId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LastCommand {
  tool: string;
  toolArgs?: {
    prompt?: string;
    text?: string;
    provider?: string;
    service?: string;
    edit_instruction?: string;
    image_url?: string;
    topic?: string;
    target_language?: string;
    language?: string;
    [key: string]: unknown;
  };
  args?: {
    prompt?: string;
    text?: string;
    provider?: string;
    service?: string;
    edit_instruction?: string;
    image_url?: string;
    topic?: string;
    target_language?: string;
    language?: string;
    [key: string]: unknown;
  };
  isMultiStep?: boolean;
  plan?: {
    steps: Array<{
      tool?: string;
      action?: string;
      parameters?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  prompt?: string;
  result?: {
    translation?: string;
    translatedText?: string;
    prompt?: string;
    provider?: string;
    service?: string;
    imageUrl?: string;
    target_language?: string;
    language?: string;
    originalText?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
  lastTool?: string;
  lastArgs?: Record<string, unknown>;
}

/**
 * Tool: Retry Last Command
 */
export const retry_last_command = {
  declaration: {
    name: 'retry_last_command',
    description: `חזור על הפקודה האחרונה של המשתמש (retry בלבד!). השתמש רק כשהמשתמש אומר במפורש "נסה שוב", "שוב", "תקן", "retry", "again". אם המשתמש מבקש ליצור משהו חדש (תמונה, וידאו, מוזיקה) עם ספק ספציפי (כמו "צור וידאו עם Veo 3") - זו בקשה חדשה, לא retry! השתמש ב-create_image/create_video/create_music במקום.

**תמיכה ב-retry של שלבים ספציפיים בפקודות רב-שלביות:**
- אם המשתמש אומר "נסה שוב את הפקודה השנייה" / "נסה שוב את השלב השני" / "retry step 2" → ציין step_numbers: [2]
- אם המשתמש אומר "נסה שוב את פקודת שליחת המיקום" / "retry location" → ציין step_tools: ["send_location"]
- אם המשתמש אומר "נסה שוב את הפקודה הראשונה והשלישית" / "retry steps 1 and 3" → ציין step_numbers: [1, 3]
- אם המשתמש אומר "נסה שוב את הסקר והמיקום" → ציין step_tools: ["create_poll", "send_location"]
- אם המשתמש לא ציין שלבים ספציפיים → retry את כל השלבים (step_numbers: null, step_tools: null)`,
    parameters: {
      type: 'object',
      properties: {
        provider_override: {
          type: 'string',
          enum: ['gemini', 'openai', 'grok', 'sora', 'veo3', 'kling', 'runway', 'none'],
          description: 'ספק חלופי להשתמש (אם המשתמש ביקש). none = אין שינוי'
        },
        modifications: {
          type: 'string',
          description: 'שינויים או הוראות נוספות מהמשתמש (למשל: "עם שיער ארוך", "בלי משקפיים")'
        },
        step_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'מספרי השלבים לנסות שוב (1-based). למשל: [2] לשלב השני, [1, 3] לשלב הראשון והשלישי. null = כל השלבים'
        },
        step_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'שמות הכלים של השלבים לנסות שוב. למשל: ["send_location"] לשליחת מיקום, ["create_poll", "send_location"] לסקר ומיקום. null = כל השלבים'
        }
      },
      required: []
    }
  },
  execute: async (args: RetryArgs = {}, context: ToolContext = {}): Promise<ToolResult> => {
    logger.debug(`🔧 [Agent Tool] retry_last_command called with provider: ${args.provider_override || 'none'}`);
    
    if (!agentTools) {
      return {
        success: false,
        error: 'שגיאה פנימית: לא ניתן לבצע retry כרגע.'
      };
    }
    
    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: 'לא נמצא chatId לביצוע retry'
        };
      }

      // Get last command from DB (persistent)
      const lastCommand = (await conversationManager.getLastCommand(chatId)) as LastCommand | null;
      
      if (!lastCommand) {
        return {
          success: false,
          error: 'אין פקודה קודמת לחזור עליה. זו הפעם הראשונה שאתה מבקש משהו.'
        };
      }
      
      // Map tool names to appropriate retry function
      const tool = lastCommand.tool;
      // Use toolArgs (new structure) or fallback to args (backward compatibility)
      const storedWrapper = lastCommand.toolArgs || lastCommand.args || {};
      
      logger.debug(`🔄 [Retry] Last command: ${tool}`, {
        isMultiStep: lastCommand.isMultiStep,
        hasPlan: !!(lastCommand.plan || storedWrapper.plan),
        hasToolArgs: !!lastCommand.toolArgs,
        hasArgs: !!lastCommand.args,
        lastCommandKeys: Object.keys(lastCommand)
      });
      
      // CRITICAL: Check if this is a multi-step command
      // For multi-step, plan and isMultiStep are at top level of lastCommand
      if (tool === 'multi_step' || lastCommand.isMultiStep === true || storedWrapper.isMultiStep === true) {
        // Multi-step retry: re-execute steps from the plan
        const plan = (lastCommand.plan || storedWrapper.plan) as {
          steps?: Array<{
            tool?: string;
            action?: string;
            parameters?: Record<string, unknown>;
            [key: string]: unknown;
          }>;
          [key: string]: unknown;
        } | undefined;
        if (!plan || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
          logger.error('❌ [Retry] Plan validation failed:', {
            hasPlan: !!plan,
            hasSteps: !!(plan && plan.steps),
            isArray: !!(plan && plan.steps && Array.isArray(plan.steps)),
            stepsLength: plan && plan.steps ? plan.steps.length : 0,
            planKeys: plan ? Object.keys(plan) : [],
            lastCommandKeys: Object.keys(lastCommand)
          });
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את התוכנית של הפקודה הרב-שלבית הקודמת.'
          };
        }
        
        const planSteps = plan.steps;
        logger.info(`🔄 [Retry] Found multi-step plan with ${planSteps.length} steps:`, 
          planSteps.map((s, idx) => `${idx + 1}. ${s.tool || s.action || 'unknown'}`).join(', '));
        
        // Check if user requested specific steps to retry
        const stepNumbers = args.step_numbers || null;
        const stepTools = args.step_tools || null;
        
        // Filter steps if specific steps were requested
        let stepsToRetry = planSteps;
        if (stepNumbers && Array.isArray(stepNumbers) && stepNumbers.length > 0) {
          // Retry specific step numbers (1-based)
          stepsToRetry = planSteps.filter((_step, idx) => stepNumbers.includes(idx + 1));
          logger.debug(`🔄 [Retry] Filtering by step numbers ${stepNumbers.join(', ')}: ${stepsToRetry.length} of ${planSteps.length} steps`);
        } else if (stepTools && Array.isArray(stepTools) && stepTools.length > 0) {
          // Retry steps with specific tools
          stepsToRetry = planSteps.filter(step => {
            const stepTool = step.tool || '';
            return stepTools.some(requestedTool => 
              stepTool.includes(requestedTool) || 
              requestedTool.includes(stepTool) ||
              stepTool === requestedTool
            );
          });
          logger.debug(`🔄 [Retry] Filtering by step tools ${stepTools.join(', ')}: ${stepsToRetry.length} of ${planSteps.length} steps`);
        } else {
          // Retry all steps (no filtering)
          logger.debug(`🔄 [Retry] Retrying all ${planSteps.length} steps (no filter specified)`);
        }
        
        // Validate that we have steps to retry
        if (!stepsToRetry || !Array.isArray(stepsToRetry) || stepsToRetry.length === 0) {
          logger.error('❌ [Retry] No steps to retry after filtering:', {
            originalStepsCount: planSteps.length,
            stepNumbers,
            stepTools,
            filteredStepsCount: stepsToRetry ? stepsToRetry.length : 0
          });
          return {
            success: false,
            error: `לא נמצאו שלבים תואמים. השלבים הזמינים: ${planSteps.map((s: { tool?: string; action?: string }, idx: number) => `${idx + 1}. ${s.tool || (typeof s.action === 'string' ? s.action.substring(0, 30) : 'unknown') || 'unknown'}`).join(', ')}`
          };
        }
        
        // Create a new plan with only the steps to retry
        // Explicitly type the plan object to match what multiStepExecution expects
        const filteredPlan = {
          ...plan,
          steps: stepsToRetry.map((step, idx: number) => ({
            tool: step.tool,
            action: step.action,
            parameters: step.parameters || {},
            stepNumber: idx + 1, // Renumber steps starting from 1
            ...step // Keep other properties but stepNumber overrides
          }))
        };
        
        logger.info(`🔄 Retrying multi-step command: ${filteredPlan.steps.length} of ${planSteps.length} steps`);
        
        // Get multi-step execution handler (lazy load to avoid circular dependency)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const multiStepModule = await import('../execution/multiStep');
        const multiStepExecution = multiStepModule.default || multiStepModule;
        
        // Detect language from original prompt
        // For multi-step, prompt is at top level of lastCommand
        const originalPrompt = lastCommand.prompt || storedWrapper.prompt || '';
        const userLanguage = detectLanguage(originalPrompt);
        const languageInstruction = getLanguageInstruction(userLanguage);
        
        // Agent config
        const agentConfig = {
          model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
          maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8,
          timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000,
          contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
        };
        
        // Apply modifications to filtered plan if provided
        if (args.modifications && args.modifications.trim()) {
          // Modify the first step's action to include modifications
          if (filteredPlan.steps && filteredPlan.steps.length > 0) {
            const firstStep = filteredPlan.steps[0];
            if (firstStep) {
              firstStep.action = `${firstStep.action || ''} ${args.modifications}`;
              logger.debug(`📝 Applied modifications to multi-step plan: ${args.modifications}`);
            }
          }
        }
        
        // CRITICAL: For manual retry, preserve original providers in each step
        // Only change provider if user explicitly specified provider_override
        if (args.provider_override && args.provider_override !== 'none') {
          // User explicitly requested different provider - apply to all steps that support it
          logger.debug(`🔄 [Multi-step Retry] User requested provider override: ${args.provider_override}`);
          if (filteredPlan.steps) {
            filteredPlan.steps.forEach((step, idx) => {
              if (step.parameters) {
                // Only override provider for creation tools
                const toolName = step.tool || '';
                if (toolName.includes('image') || toolName.includes('video') || toolName.includes('edit')) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (step.parameters as any).provider = args.provider_override;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (step.parameters as any).service = args.provider_override;
                  logger.debug(`🔄 [Multi-step Retry] Overriding provider for step ${idx + 1} to: ${args.provider_override}`);
                }
              }
            });
          }
        } else {
          // No provider override - keep original providers from saved plan
          // The plan already contains the original providers, so we don't need to change anything
          logger.debug(`🔄 [Multi-step Retry] Keeping original providers for all steps`);
        }
        
        // Send ACK with information about which steps are being retried
        const quotedMessageId = extractQuotedMessageId({ context });
        const { greenApiService } = getServices();
        
        let ackMessage = '';
        if (stepNumbers && stepNumbers.length > 0) {
          ackMessage = `🔄 חוזר על שלבים ${stepNumbers.join(', ')} מתוך ${planSteps.length} שלבים...`;
        } else if (stepTools && stepTools.length > 0) {
          const toolNames = stepTools.map(t => {
            // Translate tool names to Hebrew for user-friendly display
            const toolTranslations: Record<string, string> = {
              'create_poll': 'סקר',
              'send_location': 'מיקום',
              'create_image': 'תמונה',
              'create_video': 'וידאו',
              'create_music': 'מוזיקה'
            };
            return toolTranslations[t] || t;
          }).join(', ');
          ackMessage = `🔄 חוזר על ${toolNames} (${filteredPlan.steps.length} שלבים)...`;
        } else {
          ackMessage = `🔄 חוזר על כל השלבים (${filteredPlan.steps.length} שלבים)...`;
        }
        
        await greenApiService.sendTextMessage(
          chatId,
          ackMessage,
          quotedMessageId || undefined,
          1000
        );
        
        // Re-execute the filtered multi-step plan (only selected steps)
        const result = await multiStepExecution.execute(
          filteredPlan,
          chatId,
          {
            input: {
              ...context.originalInput,
              originalMessageId: quotedMessageId || undefined
            }
          },
          languageInstruction,
          agentConfig
        );
        
        return result as ToolResult;
      }
      
      // Single-step command handling
      // storedWrapper is already toolArgs (from commandSaver), or args (backward compatibility)
      // result is stored at top level of lastCommand, not inside toolArgs
      const originalArgs = storedWrapper as Record<string, unknown>;
      const storedResult = (lastCommand.result || storedWrapper?.result || {}) as Record<string, unknown>;
      
      // Build modified prompt if needed
      let modifiedPrompt = (originalArgs.prompt || originalArgs.text || storedResult.translation || storedResult.translatedText || '') as string;
      if (args.modifications && args.modifications.trim()) {
        modifiedPrompt = modifiedPrompt
          ? `${modifiedPrompt} ${args.modifications}`
          : args.modifications;
      }
      modifiedPrompt = (modifiedPrompt || '').toString().trim();
      
      // Determine provider override
      // CRITICAL: For manual retry, use the SAME provider as the original command
      // Only change provider if user explicitly specified provider_override
      let provider: string | null = args.provider_override || null;
      if (provider === 'none' || !provider) {
        // Keep original provider from the saved command
        // Try multiple sources to find the original provider
        provider = (originalArgs.provider || 
                   originalArgs.service || 
                   storedResult.provider ||
                   storedResult.service ||
                   null) as string | null; // Don't use default - keep null if not found
        
        // If we still don't have a provider, try to infer from tool name
        if (!provider) {
          if (tool.includes('openai')) provider = 'openai';
          else if (tool.includes('grok')) provider = 'grok';
          else if (tool.includes('gemini')) provider = 'gemini';
          else if (tool.includes('sora')) provider = 'sora';
          else if (tool.includes('veo')) provider = 'veo3';
          else if (tool.includes('kling')) provider = 'kling';
        }
      }
      
      // Send specific ACK based on the tool and provider being retried
      const quotedMessageIdForAck = extractQuotedMessageId({ context });
      await sendRetryAck(chatId, tool, provider, quotedMessageIdForAck || null);
      
      // Route to appropriate tool based on last command
      if (tool === 'gemini_image' || tool === 'openai_image' || tool === 'grok_image' || tool === 'create_image') {
        // Image generation retry
        const promptToUse = modifiedPrompt || (originalArgs.prompt || originalArgs.text || storedResult.prompt || '') as string;
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת.'
          };
        }
        
        const imageArgs = {
          prompt: promptToUse,
          provider: provider || 'gemini' // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider) {
          console.log(`🔄 [Retry] Using original provider: ${provider}`);
        } else {
          console.log(`⚠️ [Retry] Original provider not found, using default: gemini`);
        }
        
        logger.debug(`🎨 Retrying image generation with:`, imageArgs);
        if (!agentTools.create_image) {
          return { success: false, error: 'כלי יצירת תמונה לא זמין' };
        }
        return await agentTools.create_image.execute(imageArgs, context) as ToolResult;
        
      } else if (tool === 'veo3_video' || tool === 'sora_video' || tool === 'kling_text_to_video' || tool === 'create_video') {
        // Video generation retry
        const promptToUse = modifiedPrompt || (originalArgs.prompt || originalArgs.text || storedResult.prompt || '') as string;
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת לוידאו.'
          };
        }
        
        const videoArgs = {
          prompt: promptToUse,
          provider: provider || 'kling' // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider) {
          console.log(`🔄 [Retry] Using original provider: ${provider}`);
        } else {
          console.log(`⚠️ [Retry] Original provider not found, using default: kling`);
        }
        
        logger.debug(`🎬 Retrying video generation with:`, videoArgs);
        if (!agentTools.create_video) {
          return { success: false, error: 'כלי יצירת וידאו לא זמין' };
        }
        return await agentTools.create_video.execute(videoArgs, context) as ToolResult;
        
      } else if (tool === 'edit_image') {
        // Image editing retry
        const editInstruction = modifiedPrompt || (originalArgs.edit_instruction || originalArgs.prompt || '') as string;
        const imageUrl = (originalArgs.image_url || storedResult.imageUrl || '') as string;
        
        if (!editInstruction || !imageUrl) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הוראות העריכה או את כתובת התמונה.'
          };
        }
        
        const editArgs = {
          image_url: imageUrl,
          edit_instruction: editInstruction,
          service: provider || (originalArgs.service || 'openai') as string // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider || originalArgs.service) {
          console.log(`🔄 [Retry] Using original service: ${provider || originalArgs.service}`);
        } else {
          console.log(`⚠️ [Retry] Original service not found, using default: openai`);
        }
        
        logger.debug(`✏️ Retrying image edit with:`, editArgs);
        if (!agentTools.edit_image) {
          return { success: false, error: 'כלי עריכת תמונה לא זמין' };
        }
        return await agentTools.edit_image.execute(editArgs, context) as ToolResult;
        
      } else if (tool === 'gemini_chat' || tool === 'openai_chat' || tool === 'grok_chat') {
        // Chat retry
        const chatProvider = provider || (tool.includes('openai') ? 'openai' : tool.includes('grok') ? 'grok' : 'gemini');
        
        // For chat, we need to use the appropriate service directly
        const { geminiService, openaiService, grokService } = getServices();
        
        let result;
        if (chatProvider === 'openai') {
          result = await openaiService.generateTextResponse(modifiedPrompt, []);
        } else if (chatProvider === 'grok') {
          result = await grokService.generateTextResponse(modifiedPrompt, []);
        } else {
          result = await geminiService.generateTextResponse(modifiedPrompt, []);
        }
        
        return {
          success: !(result as { error?: string }).error,
          data: ((result as { text?: string; error?: string }).text || (result as { error?: string }).error) as string,
          error: (result as { error?: string }).error
        };
        
      } else if (tool === 'text_to_speech') {
        // TTS retry
        const textToSpeak = modifiedPrompt || (originalArgs.text || storedResult.translation || storedResult.translatedText || '') as string;
        if (!textToSpeak) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הטקסט להמרה לדיבור.'
          };
        }
        if (!agentTools.text_to_speech) {
          return { success: false, error: 'כלי TTS לא זמין' };
        }
        return await agentTools.text_to_speech.execute({
          text: textToSpeak,
          target_language: (originalArgs.target_language || originalArgs.language || 'he') as string
        }, context) as ToolResult;
        
      } else if (tool === 'music_generation' || tool === 'create_music') {
        // Music retry
        const promptToUse = modifiedPrompt || (originalArgs.prompt || storedResult.prompt || originalArgs.text || '') as string;
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט ליצירת המוזיקה.'
          };
        }
        if (!agentTools.create_music) {
          return { success: false, error: 'כלי יצירת מוזיקה לא זמין' };
        }
        return await agentTools.create_music.execute({
          prompt: promptToUse
        }, context) as ToolResult;
        
      } else if (tool === 'translate_text') {
        const translationArgs = {
          text: (originalArgs.text || storedResult.originalText || originalArgs.prompt || '') as string,
          target_language: (originalArgs.target_language || originalArgs.language || storedResult.target_language || storedResult.language || 'he') as string
        };
        
        if (!translationArgs.text || !translationArgs.target_language) {
          return {
            success: false,
            error: 'לא הצלחתי לאחזר את הטקסט או את שפת היעד של הפקודה הקודמת.'
          };
        }
        if (!agentTools.translate_text) {
          return { success: false, error: 'כלי תרגום לא זמין' };
        }
        return await agentTools.translate_text.execute(translationArgs, context) as ToolResult;
        
      } else if (tool === 'create_poll') {
        // Poll retry
        const topicToUse = modifiedPrompt || (originalArgs.topic || originalArgs.prompt || '') as string;
        if (!topicToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את נושא הסקר הקודם.'
          };
        }
        if (!agentTools.create_poll) {
          return { success: false, error: 'כלי יצירת סקר לא זמין' };
        }
        return await agentTools.create_poll.execute({
          topic: topicToUse
        }, context) as ToolResult;
        
      } else {
        // Generic retry - just return info about what was done
        return {
          success: true,
          data: `הפקודה האחרונה הייתה: ${tool}\n\nלא יכול לחזור עליה אוטומטית, אבל אתה יכול לבקש אותה שוב ישירות.`,
          lastTool: tool,
          lastArgs: originalArgs
        };
      }
      
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in retry_last_command:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: `שגיאה בביצוע חוזר: ${err.message}`
      };
    }
  }
};

export default retry_last_command;
