'use strict';

/**
 * Intent Router Service
 *
 * Accepts a normalized input and decides which existing command to execute.
 * Phase 1: heuristic + random model selection to keep costs low and behavior predictable.
 * Later you can swap the heuristic with an actual LLM call without changing callers.
 */

const crypto = require('crypto');

// Helper: pick a random element from array
function pickRandom(options) {
  if (!options || options.length === 0) return null;
  const idx = crypto.randomInt(0, options.length);
  return options[idx];
}

/**
 * Normalize user request and choose an action.
 *
 * input = {
 *   userText: string | null,           // full text (already trimmed)
 *   hasImage: boolean,
 *   hasVideo: boolean,
 *   hasAudio: boolean,                 // incoming voice message without text
 *   chatType: 'private'|'group'|'unknown',
 *   language: string | null,           // e.g. 'he', 'en'
 *   authorizations: {
 *     media_creation: boolean,
 *     voice_allowed: boolean
 *   }
 * }
 *
 * Returns an object:
 * { tool: string, args: object, reason: string }
 *
 * The tool names are mapped 1:1 to existing command handlers in whatsappRoutes.
 */
async function routeIntent(input) {
  const text = (input.userText || '').trim();
  const prompt = text.replace(/^#\s+/, '').trim();

  // Voice-only case: no text, only audio (subject to allow list)
  if (!text && input.hasAudio) {
    if (!input.authorizations?.voice_allowed) {
      return { tool: 'deny_unauthorized', args: { feature: 'voice' }, reason: 'Voice not allowed' };
    }
    // For now, route to creative voice processing (current active flow)
    return { tool: 'creative_voice_processing', args: {}, reason: 'Audio message - creative flow' };
  }

  // If there is an attached image with text prompt → decide between image edit vs image→video
  if (input.hasImage && prompt) {
    if (!input.authorizations?.media_creation) {
      return { tool: 'deny_unauthorized', args: { feature: 'image_edit' }, reason: 'No media creation authorization' };
    }
    const lower = prompt.toLowerCase();
    const isVideoLike = /video|וידאו|סרט|אנימציה|animate|הנפש|להנפיש|תזיז|motion|קליפ/.test(lower);
    if (isVideoLike) {
      const toVideoTool = pickRandom(['veo3_video', 'kling_text_to_video']);
      return { tool: toVideoTool, args: { prompt }, reason: 'Image attached, video-like request' };
    }
    const service = pickRandom(['gemini', 'openai']);
    return { tool: 'image_edit', args: { service, prompt }, reason: 'Image attached with prompt' };
  }

  // If there is an attached video with text prompt → video-to-video
  if (input.hasVideo && prompt) {
    if (!input.authorizations?.media_creation) {
      return { tool: 'deny_unauthorized', args: { feature: 'video_to_video' }, reason: 'No media creation authorization' };
    }
    return { tool: 'video_to_video', args: { prompt }, reason: 'Video attached with prompt' };
  }

  // If text prompt only (no attachments) → decide among chat / image / video generation
  if (prompt) {
    // Simple keyword-based heuristic to infer intent; replace later with LLM
    const lower = prompt.toLowerCase();
    const isImageLike = /image|תמונה|ציור|תצלום|לוגו|poster|איור|illustration|render|צייר|ציירי/.test(lower);
    const isVideoLike = /video|וידאו|סרט|אנימציה|קליפ|clip|animate|motion/.test(lower);
    const isTtsLike = /קרא|הקרא|הקריא|הקראת|דיבור|speech|להשמיע/.test(lower);
    const isSummary = /סכם|סיכום|summary|לסכם/.test(lower);

    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isTtsLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'text_to_speech' }, reason: 'No media creation authorization' };
      }
      return { tool: 'text_to_speech', args: { text: prompt }, reason: 'TTS-like request' };
    }

    if (isImageLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'image_generation' }, reason: 'No media creation authorization' };
      }
      const model = pickRandom(['gemini', 'openai', 'grok']);
      return { tool: `${model}_image`, args: { prompt }, reason: 'Image-like request' };
    }

    if (isVideoLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'video_generation' }, reason: 'No media creation authorization' };
      }
      const tool = pickRandom(['veo3_video', 'kling_text_to_video']);
      return { tool, args: { prompt }, reason: 'Video-like request' };
    }

    // Default: chat. Pick random among supported chat models
    const chatTool = pickRandom(['gemini_chat', 'openai_chat', 'grok_chat']);
    return { tool: chatTool, args: { prompt }, reason: 'Default to chat' };
  }

  // No recognized pattern → ask clarification
  return { tool: 'ask_clarification', args: {}, reason: 'Unrecognized input' };
}

module.exports = {
  routeIntent
};


