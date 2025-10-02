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
    const isTtsLike = /קרא|הקרא|הקריא|הקראת|דיבור|speech|להשמיע|הפוך.*לדיבור|המר.*לדיבור|text.*to.*speech|tts/.test(lower);
    const isSummary = /סכם|סיכום|summary|לסכם/.test(lower);
    const isMusic = /שיר|מוזיקה|שירון|suno|music|song/.test(lower);

    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isTtsLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'text_to_speech' }, reason: 'No media creation authorization' };
      }
      
      // Extract the actual text to convert to speech (after colon or after TTS keywords)
      let textToSpeak = prompt;
      
      // Try to extract text after colon (e.g., "הפוך לדיבור: היי שם")
      const colonMatch = prompt.match(/[:：]\s*(.+)/);
      if (colonMatch) {
        textToSpeak = colonMatch[1].trim();
      } else {
        // Try to remove common TTS instruction patterns
        textToSpeak = prompt
          .replace(/^(הפוך|המר|תמיר|תהפוך)\s+(את\s+)?(ה)?טקסט\s+(הזה\s+)?לדיבור\s*/i, '')
          .replace(/^(קרא|הקרא|הקריא)\s+(את\s+)?(ה)?טקסט\s+(הזה\s+)?[:\s]*/i, '')
          .replace(/^(read|speak|say)\s+(this|the\s+text)?\s*[:\s]*/i, '')
          .replace(/^text\s+to\s+speech\s*[:\s]*/i, '')
          .replace(/^tts\s*[:\s]*/i, '')
          .trim();
      }
      
      return { tool: 'text_to_speech', args: { text: textToSpeak }, reason: 'TTS-like request' };
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
Available Tools and Services:
━━━━━━━━━━━━━━━━━━━━━━
🎵 MUSIC GENERATION:
- music_generation: Creates songs using Suno AI. Use for requests like "write a song", "create music", "compose", "שיר", "מוזיקה", etc.

💬 TEXT CHAT:
- gemini_chat: Conversation using Google Gemini (default for text chat)
- openai_chat: Conversation using OpenAI GPT (when user mentions "openai", "gpt", "chatgpt")
- grok_chat: Conversation using Grok/xAI (when user mentions "grok", "xai")

🖼️ IMAGE GENERATION:
- gemini_image: Generate images using Google Gemini (default for image creation)
- openai_image: Generate images using DALL-E (when user mentions "openai", "gpt", "dall-e")
- grok_image: Generate images using Grok (when user mentions "grok", "xai")

🎬 VIDEO GENERATION:
- kling_text_to_video: Create videos from text using Kling AI (default for video creation)
- veo3_video: Create videos from text using Google Veo 3 (when user mentions "veo" or "veo3")
- kling_image_to_video: Create videos from image using Kling AI (default for image-to-video)
- veo3_image_to_video: Create videos from image using Veo 3 (when user mentions "veo" or "veo3")
- video_to_video: Transform existing video using RunwayML Gen4

🖼️ IMAGE EDITING:
- image_edit: Edit images (specify service: "gemini" default, or "openai" if requested)

🗣️ VOICE & SPEECH:
- text_to_speech: Convert text to speech (TTS). Use for "read this", "הקרא", "הפוך לדיבור", "המר לדיבור", "text to speech", "TTS", etc.
  * IMPORTANT: Extract only the actual text to speak (after colon if present)
  * Example: "הפוך לדיבור: היי שם" → args.text should be "היי שם"
- creative_voice_processing: Process audio messages with voice effects (requires voice_allowed authorization)

📝 UTILITIES:
- chat_summary: Summarize conversation history. Use for "summarize", "סכם", "סיכום"
- ask_clarification: When user request is unclear or ambiguous
- deny_unauthorized: When user lacks required permissions for a feature

Routing Rules:
━━━━━━━━━━━
1. MUSIC: For any song/music requests (like "write a song", "create music", "שיר", "מוזיקה", "suno"):
   → Choose music_generation (requires media_creation authorization)

2. AUDIO INPUT: If hasAudio=true (voice message):
   → Choose creative_voice_processing only if authorizations.voice_allowed=true
   → Otherwise: deny_unauthorized {feature:"voice"}

3. IMAGE WITH PROMPT: If hasImage=true and userText exists:
   a) Video-like keywords ("video", "וידאו", "אנימציה", "animate", "הנפש", "motion", "clip"):
      → If mentions "veo" or "veo3": choose veo3_image_to_video
      → Otherwise: choose kling_image_to_video (default)
   b) Not video-like:
      → Choose image_edit with service:
         * "openai" if mentions "openai", "gpt", "dall-e"
         * "gemini" otherwise (default)

4. VIDEO WITH PROMPT: If hasVideo=true:
   → Choose video_to_video

5. TEXT ONLY: Detect intent from userText:
   a) Music/song keywords ("שיר", "מוזיקה", "song", "music", "suno", "compose", "כתוב שיר", "צור שיר"):
      → Choose music_generation (requires media_creation)
   
   b) Summary keywords ("סכם", "סיכום", "summary", "לסכם"):
      → Choose chat_summary
   
   c) TTS keywords ("קרא", "הקרא", "הקריא", "הפוך לדיבור", "המר לדיבור", "speech", "text to speech", "TTS", "read this", "להשמיע", "דיבור"):
      → Choose text_to_speech (requires media_creation)
      → MUST extract clean text from args.text (remove instruction prefixes, extract text after colon)
   
   d) Image keywords ("תמונה", "ציור", "תצלום", "image", "picture", "draw", "צייר", "ציירי", "איור", "illustration", "render", "לוגו", "poster"):
      → If mentions "openai", "gpt", "dall-e": choose openai_image
      → If mentions "grok", "xai": choose grok_image
      → Otherwise: choose gemini_image (default)
      → Requires media_creation authorization
   
   e) Video keywords ("וידאו", "video", "סרט", "אנימציה", "clip", "קליפ", "motion", "animate", "הנפש"):
      → If mentions "veo" or "veo3": choose veo3_video
      → Otherwise: choose kling_text_to_video (default)
      → Requires media_creation authorization
   
   f) Default to chat (when no other intent matches):
      → If mentions "openai", "gpt", "chatgpt": choose openai_chat
      → If mentions "grok", "xai": choose grok_chat
      → Otherwise: choose gemini_chat (default - most common case)

6. AUTHORIZATION: If media action required but missing authorization:
   → Choose deny_unauthorized with appropriate feature name

Output Format:
━━━━━━━━━━━
Return ONLY a single JSON object (no markdown, no explanation):
{ "tool": "tool_name", "args": {...}, "reason": "why this tool" }

Examples:
• Text chat: {"tool": "gemini_chat", "args": {}, "reason": "General conversation"}
• Image: {"tool": "gemini_image", "args": {"prompt": "a cat"}, "reason": "User requested image"}
• Video: {"tool": "kling_text_to_video", "args": {"prompt": "sunset"}, "reason": "User requested video"}
• TTS: {"tool": "text_to_speech", "args": {"text": "hello world"}, "reason": "User requested speech"}
• Music: {"tool": "music_generation", "args": {"prompt": "happy song"}, "reason": "User requested song"}
• Image edit: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "make it red"}, "reason": "User attached image with edit request"}
• No auth: {"tool": "deny_unauthorized", "args": {"feature": "image_generation"}, "reason": "No media_creation permission"}`;
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


