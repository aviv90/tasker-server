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

  // If there is an attached image WITHOUT prompt (or prompt is very generic) → image-to-text / analyze image
  if (input.hasImage && (!prompt || prompt.length < 3)) {
    // User sent image without meaningful caption - treat as "what's in this image?"
    return { tool: 'gemini_chat', args: { prompt: 'מה מופיע בתמונה הזו?' }, reason: 'Image attached without prompt - analyze image' };
  }

  // If text prompt only (no attachments) → decide among chat / image / video generation
  // CRITICAL: This block should NEVER run if hasImage or hasVideo is true
  if (prompt && !input.hasImage && !input.hasVideo) {
    // Simple keyword-based heuristic to infer intent; replace later with LLM
    const lower = prompt.toLowerCase();
    const isImageLike = /image|תמונה|ציור|תצלום|לוגו|poster|איור|illustration|render|צייר|ציירי/.test(lower);
    const isVideoLike = /video|וידאו|סרט|אנימציה|קליפ|clip|animate|motion/.test(lower);
    const isTtsLike = /קרא|הקרא|הקריא|הקראת|דיבור|speech|להשמיע|הפוך.*לדיבור|המר.*לדיבור|text.*to.*speech|tts|אמור/.test(lower);
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
  
  return `You are a smart intent router for a WhatsApp AI bot. Analyze the user's request and return ONLY a JSON object.

🔍 INPUT CONTEXT:
${JSON.stringify(payload, null, 2)}

📋 DECISION LOGIC (follow this order):

1️⃣ **IF hasImage=true** (user sent an image):
   - Image + video keywords → "kling_image_to_video"
   - Image + edit request → "image_edit" 
   - Image alone (no text) → "gemini_chat" (analyze)
   ⚠️ NEVER choose music/TTS when hasImage=true

2️⃣ **IF hasVideo=true** (user sent a video):
   - Always → "video_to_video"
   ⚠️ NEVER choose music/TTS when hasVideo=true

3️⃣ **IF hasAudio=true** (voice message):
   - If voice_allowed → "creative_voice_processing"
   - Else → "deny_unauthorized"

4️⃣ **IF text only** (no media attached):
   Check userText for keywords:
   
   🎵 Music: "שיר", "מוזיקה", "song", "music", "suno"
      → "music_generation"
   
   🖼️ Image: "תמונה", "ציור", "צייר", "draw", "picture", "image"
      → "gemini_image" (default) or "openai_image" if mentions OpenAI
      
   🎬 Video: "וידאו", "video", "סרט", "אנימציה", "clip"
      → "kling_text_to_video" (default) or "veo3_video" if mentions Veo
   
   🗣️ TTS: "הקרא", "קרא", "דיבור", "speech", "TTS", "read this", "אמור"
      → "text_to_speech" + extract text after colon
   
   📝 Summary: "סכם", "summary"
      → "chat_summary"
   
   💬 **DEFAULT** (greeting, question, conversation):
      → "gemini_chat"

🎯 **CRITICAL EXAMPLES:**

Input: {"userText": "# צייר פיל", "hasImage": false, "hasVideo": false}
Output: {"tool": "gemini_image", "args": {"prompt": "פיל"}, "reason": "Draw request"}

Input: {"userText": "# היי", "hasImage": false, "hasVideo": false}
Output: {"tool": "gemini_chat", "args": {}, "reason": "Greeting/conversation"}

Input: {"userText": "# הוסף כובע", "hasImage": true, "hasVideo": false}
Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "הוסף כובע"}, "reason": "Edit image"}

Input: {"userText": "# צור שיר על אהבה", "hasImage": false, "hasVideo": false}
Output: {"tool": "music_generation", "args": {"prompt": "שיר על אהבה"}, "reason": "Song request"}

⚠️ **RULES:**
- ALWAYS check hasImage/hasVideo FIRST
- If media attached, ONLY route to media-related tools
- For generic text/greetings → gemini_chat (most common)
- Return ONLY valid JSON, no markdown, no extra text

📤 OUTPUT SCHEMA:
{"tool": "tool_name", "args": {}, "reason": "brief explanation"}

Available tools: gemini_chat, openai_chat, grok_chat, gemini_image, openai_image, grok_image, kling_text_to_video, veo3_video, kling_image_to_video, veo3_image_to_video, video_to_video, image_edit, text_to_speech, music_generation, chat_summary, creative_voice_processing, deny_unauthorized, ask_clarification`;
}


