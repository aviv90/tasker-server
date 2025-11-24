/**
 * Command Handler
 * 
 * Handles command persistence and provider override for retry functionality.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 * 
 * NOTE: Commands are now saved to DB (persistent) via conversationManager.saveCommand()
 * All messages are retrieved from Green API.
 */

import conversationManager from '../../services/conversationManager';
import logger from '../../utils/logger';

interface CommandOptions {
    normalized?: any;
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
    prompt?: string;
}

/**
 * Save last executed command for retry functionality (saved to DB)
 * @param {string} chatId - Chat ID
 * @param {string} messageId - Message ID from Green API
 * @param {Object} decision - Router decision object
 * @param {Object} options - Additional options (imageUrl, videoUrl, normalized)
 */
export async function saveLastCommand(chatId: string, messageId: string, decision: any, options: CommandOptions = {}) {
  // Don't save retry, clarification, or denial commands
  if (['retry_last_command', 'ask_clarification', 'deny_unauthorized'].includes(decision.tool)) {
    return;
  }
  
  if (!messageId) {
    logger.warn('⚠️ [CommandHandler] No messageId available, cannot save command to DB');
    return;
  }
  
  // Save to DB (persistent) for retry functionality
  const commandMetadata = {
    tool: decision.tool,
    toolArgs: decision.args,
    normalized: options.normalized,
    imageUrl: options.imageUrl,
    videoUrl: options.videoUrl,
    audioUrl: options.audioUrl,
    prompt: options.prompt || ''
  };
  
  await conversationManager.saveCommand(chatId, messageId, commandMetadata);
}

// Provider override helper for retry (supports Hebrew/English variants)
export function applyProviderOverride(additionalInstructions: string, currentDecision: any, _context: any = {}) {
  if (!additionalInstructions || !additionalInstructions.trim()) return null;

  const wantsOpenAI = /openai|אוופנאי|אופן איי/i.test(additionalInstructions);
  const wantsGemini = /gemini|ג׳מיני|גמיני|גימיני/i.test(additionalInstructions);
  const wantsGrok   = /grok|גרוק/i.test(additionalInstructions);
  const wantsSora   = /sora|סורה/i.test(additionalInstructions);
  const wantsVeo    = /veo\s*3?(?:\.\d+)?|veo|ויו|וֶאו/i.test(additionalInstructions);
  const wantsKling  = /kling|קלינג/i.test(additionalInstructions);

  // Sora model variants
  const wantsSoraPro = /sora\s*2\s*pro|sora-2-pro|סורה\s*2\s*פרו|סורה-?2-?פרו/i.test(additionalInstructions);
  const wantsSora2 = /sora\s*2(?!\s*pro)|sora-2(?!-pro)|סורה\s*2(?!\s*פרו)|סורה-?2(?!-?פרו)/i.test(additionalInstructions);

  // Helper to clone args safely
  const cloneArgs = (args: any) => args ? JSON.parse(JSON.stringify(args)) : {};

  // 1) Check original tool
  const originalTool = currentDecision?.tool;
  if (!originalTool) return null;

  // Image generation provider swap
  if (originalTool.endsWith('_image') && !originalTool.endsWith('_image_edit')) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Image-to-video
  if (originalTool.endsWith('_image_to_video')) {
    if (wantsSora)   return { tool: 'sora_image_to_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora image-to-video' };
    if (wantsVeo)    return { tool: 'veo3_image_to_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo image-to-video' };
    if (wantsKling)  return { tool: 'kling_image_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling image-to-video' };
  }
  
  // Text-to-video
  if (originalTool.endsWith('_video') || originalTool === 'kling_text_to_video') {
    if (wantsSora)   return { tool: 'sora_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora text-to-video' };
    if (wantsVeo)    return { tool: 'veo3_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo text-to-video' };
    if (wantsKling)  return { tool: 'kling_text_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling text-to-video' };
  }

  // Chat provider swap
  if (originalTool.endsWith('_chat')) {
    if (wantsOpenAI) return { tool: 'openai_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI chat' };
    if (wantsGemini) return { tool: 'gemini_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini chat' };
    if (wantsGrok)   return { tool: 'grok_chat',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok chat' };
  }

  return null;
}
