'use strict';

/**
 * Intent Router Service
 *
 * Accepts a normalized input and decides which existing command to execute.
 * Phase 1: heuristic + random model selection to keep costs low and behavior predictable.
 * Later you can swap the heuristic with an actual LLM call without changing callers.
 */

const crypto = require('crypto');
const { generateTextResponse: geminiText } = require('./geminiService');

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
  // Optional LLM routing (config-gated). Falls back to heuristic on any failure.
  const useLLM = String(process.env.INTENT_ROUTER_USE_LLM || '').toLowerCase() === 'on';
  if (useLLM) {
    try {
      const llmDecision = await decideWithLLM(input);
      const validated = validateDecision(llmDecision);
      if (validated) {
        return validated;
      }
    } catch (err) {
      // Fall back to heuristic silently
    }
  }
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
      // Check if user explicitly requested Veo3
      const wantsVeo3 = /veo|veo3/.test(lower);
      if (wantsVeo3) {
        return { tool: 'veo3_image_to_video', args: { prompt }, reason: 'Image attached, user requested Veo3' };
      }
      // Default to Kling for image-to-video
      return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, video-like request' };
    }
    // Default to Gemini for image editing, unless user explicitly requests OpenAI
    const wantsOpenAI = /openai|gpt|dall-e|dalle/.test(lower);
    const service = wantsOpenAI ? 'openai' : 'gemini';
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
    const isMusic = /שיר|מוזיקה|שירון|suno|music|song/.test(lower);

    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isTtsLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'text_to_speech' }, reason: 'No media creation authorization' };
      }
      return { tool: 'text_to_speech', args: { text: prompt }, reason: 'TTS-like request' };
    }

    if (isMusic) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'music_generation' }, reason: 'No media creation authorization' };
      }
      return { tool: 'music_generation', args: { prompt }, reason: 'Music-like request' };
    }

    if (isImageLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'image_generation' }, reason: 'No media creation authorization' };
      }
      // Check for explicit provider requests
      const wantsOpenAI = /openai|gpt|dall-e|dalle/.test(lower);
      const wantsGrok = /grok|xai/.test(lower);
      if (wantsOpenAI) {
        return { tool: 'openai_image', args: { prompt }, reason: 'Image-like request, user requested OpenAI' };
      }
      if (wantsGrok) {
        return { tool: 'grok_image', args: { prompt }, reason: 'Image-like request, user requested Grok' };
      }
      // Default to Gemini
      return { tool: 'gemini_image', args: { prompt }, reason: 'Image-like request' };
    }

    if (isVideoLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'video_generation' }, reason: 'No media creation authorization' };
      }
      // Check if user explicitly requested Veo3
      const wantsVeo3 = /veo|veo3/.test(lower);
      if (wantsVeo3) {
        return { tool: 'veo3_video', args: { prompt }, reason: 'Video-like request, user requested Veo3' };
      }
      // Default to Kling for text-to-video
      return { tool: 'kling_text_to_video', args: { prompt }, reason: 'Video-like request' };
    }

    // Default: chat. Check for explicit provider requests
    const wantsOpenAI = /openai|gpt|chatgpt/.test(lower);
    const wantsGrok = /grok|xai/.test(lower);
    if (wantsOpenAI) {
      return { tool: 'openai_chat', args: { prompt }, reason: 'Chat request, user requested OpenAI' };
    }
    if (wantsGrok) {
      return { tool: 'grok_chat', args: { prompt }, reason: 'Chat request, user requested Grok' };
    }
    // Default to Gemini
    return { tool: 'gemini_chat', args: { prompt }, reason: 'Default to chat' };
  }

  // No recognized pattern → ask clarification
  return { tool: 'ask_clarification', args: {}, reason: 'Unrecognized input' };
}

module.exports = {
  routeIntent
};

// ---------- Internal helpers ----------

function validateDecision(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const tool = obj.tool;
  const args = obj.args || {};
  const reason = typeof obj.reason === 'string' ? obj.reason : '';
  const allowedTools = new Set([
    'gemini_image', 'openai_image', 'grok_image',
    'veo3_video', 'kling_text_to_video', 'veo3_image_to_video', 'kling_image_to_video', 'video_to_video',
    'image_edit', 'text_to_speech', 'gemini_chat', 'openai_chat', 'grok_chat',
    'chat_summary', 'music_generation', 'creative_voice_processing', 'deny_unauthorized', 'ask_clarification'
  ]);
  if (!allowedTools.has(tool)) return null;
  return { tool, args, reason };
}

async function decideWithLLM(input) {
  const prompt = buildRouterPrompt(input);
  // Use a faster model and a timeout fallback to heuristic
  const llmPromise = geminiText(prompt, [], { model: 'gemini-2.5-flash' });
  const timeoutMs = Number(process.env.INTENT_ROUTER_LLM_TIMEOUT_MS || 2500);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), timeoutMs));
  const res = await Promise.race([llmPromise, timeoutPromise]);
  const raw = (res && res.text) ? res.text.trim() : '';
  // Try to extract JSON
  let jsonText = raw;
  // If wrapped in code fences, strip them
  const fenceMatch = raw.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (fenceMatch && fenceMatch[1]) jsonText = fenceMatch[1].trim();
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch (_) { parsed = null; }
  if (!parsed) throw new Error('LLM did not return valid JSON');
  return parsed;
}

function buildRouterPrompt(input) {
  const safe = (v) => (v === null || v === undefined) ? null : v;
  const schema = {
    tool: 'string // one of: gemini_image, openai_image, grok_image, veo3_video, kling_text_to_video, veo3_image_to_video, kling_image_to_video, video_to_video, image_edit, text_to_speech, gemini_chat, openai_chat, grok_chat, chat_summary, music_generation, creative_voice_processing, deny_unauthorized, ask_clarification',
    args: 'object // tool-specific args. For image_edit include { service: "gemini"|"openai", prompt: string }',
    reason: 'string'
  };
  const toolsGuidance = `
Rules:
- If hasAudio=true: choose creative_voice_processing only if authorizations.voice_allowed=true; else deny_unauthorized {feature:"voice"}.
- If hasImage=true and prompt implies video ("video", "וידאו", "אנימציה", "animate", "הנפש", "motion", "clip"): 
  * If user explicitly mentions "veo" or "veo3": choose veo3_image_to_video
  * Otherwise: choose kling_image_to_video (default)
- If hasImage=true and not video-like: choose image_edit with service:
  * If user mentions "openai", "gpt", "dall-e": service="openai"
  * Otherwise: service="gemini" (default)
- If hasVideo=true: choose video_to_video.
- If only text: detect image/video/TTS/summary intents; otherwise default to chat:
  * If user mentions "openai", "gpt", "chatgpt": choose openai_chat
  * If user mentions "grok", "xai": choose grok_chat  
  * Otherwise: choose gemini_chat (default)
- For text-to-video generation:
  * If user mentions "veo" or "veo3": choose veo3_video
  * Otherwise: choose kling_text_to_video (default)
- For image generation:
  * If user mentions "openai", "gpt", "dall-e": choose openai_image
  * If user mentions "grok", "xai": choose grok_image
  * Otherwise: choose gemini_image (default)
- If missing authorization for media actions: choose deny_unauthorized with appropriate feature.
- Output strictly a single JSON object matching the schema, with only ASCII quotes.`;
  const payload = {
    userText: safe(input.userText),
    hasImage: !!input.hasImage,
    hasVideo: !!input.hasVideo,
    hasAudio: !!input.hasAudio,
    chatType: input.chatType || 'unknown',
    language: input.language || null,
    authorizations: {
      media_creation: !!(input.authorizations && input.authorizations.media_creation),
      voice_allowed: !!(input.authorizations && input.authorizations.voice_allowed)
    }
  };
  return `You are an intent router. Choose the best tool for the user's request based on context.
Return STRICT JSON only, matching this schema (no commentary):\n${JSON.stringify(schema)}\n\nGuidance:\n${toolsGuidance}\n\nContext JSON:\n${JSON.stringify(payload, null, 2)}`;
}


