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
    // All checks are case-insensitive using /i flag
    // Using \b for word boundaries to match whole words only (for English words)
    const isVideoLike = /\b(video|animate|motion|clip)\b|וידאו|סרט|אנימציה|הנפש|להנפיש|תזיז|קליפ/i.test(prompt);
    if (isVideoLike) {
      // Check if user explicitly requested Veo3 (case-insensitive, with or without space)
      const wantsVeo3 = /\bveo\s*3?\b/i.test(prompt);
      if (wantsVeo3) {
        return { tool: 'veo3_image_to_video', args: { prompt }, reason: 'Image attached, user requested Veo3' };
      }
      // Default to Kling for image-to-video
      return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, video-like request' };
    }
    // Check if user wants image analysis instead of editing
    const isAnalysisRequest = /\b(describe|what|analyze|how|why|when|where|who)\b|מה|מה\s+זה|מה\s+מופיע|תאר|ניתוח|תיאור|איך|למה|מתי|איפה|מי/i.test(prompt);
    if (isAnalysisRequest) {
      return { tool: 'gemini_chat', args: { prompt }, reason: 'Image analysis request' };
    }
    
    // Default to Gemini for image editing, unless user explicitly requests OpenAI
    const wantsOpenAI = /\b(open\s*ai|gpt|dall[\s-]*e)\b/i.test(prompt);
    const service = wantsOpenAI ? 'openai' : 'gemini';
    return { tool: 'image_edit', args: { service, prompt }, reason: 'Image attached with prompt' };
  }

  // If there is an attached video with text prompt → video-to-video
  if (input.hasVideo && prompt) {
    if (!input.authorizations?.media_creation) {
      return { tool: 'deny_unauthorized', args: { feature: 'video_to_video' }, reason: 'No media creation authorization' };
    }
    // Only Runway for video editing
    const service = 'runway';
    return { tool: 'video_to_video', args: { service, prompt }, reason: 'Video attached with prompt' };
  }

  // If there is an attached image WITHOUT prompt → ignore (no automatic analysis)
  if (input.hasImage && (!prompt || prompt.length < 3)) {
    return { tool: 'ask_clarification', args: {}, reason: 'Image attached without clear instruction' };
  }

  // If text prompt only (no attachments) → decide among chat / image / video generation
  // CRITICAL: This block should NEVER run if hasImage or hasVideo is true
  if (prompt && !input.hasImage && !input.hasVideo) {
    // Simple keyword-based heuristic to infer intent; replace later with LLM
    // Note: prompt already has # prefix removed by line 57
    // All checks are case-insensitive using /i flag
    // Using \b for word boundaries to match whole words only
    const isImageLike = /\b(image|poster|illustration|render)\b|תמונה|ציור|תצלום|לוגו|איור|צייר|ציירי/i.test(prompt);
    const isVideoLike = /\b(video|clip|animate|motion)\b|וידאו|סרט|אנימציה|קליפ/i.test(prompt);
    const isTtsLike = /\b(speech|tts)\b|קרא|הקרא|הקריא|הקראת|דיבור|להשמיע|הפוך.*לדיבור|המר.*לדיבור|text\s*to\s*speech|אמור/i.test(prompt);
    const isSummary = /\b(summary)\b|סכם|סיכום|לסכם/i.test(prompt);
    const isMusic = /\b(suno|music|song)\b|שיר|מוזיקה|שירון/i.test(prompt);
    const isHelp = /\b(commands|list|help|capabilities)\b|פקודות|רשימת|רשימה|עזרה|אילו|מה\s+אפשר|what\s+can/i.test(prompt);
    const isCreateGroup = /צור.*קבוצה|יצירת.*קבוצה|create\s*group|new\s*group|קבוצה\s*חדשה/i.test(prompt);

    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isHelp) {
      return { tool: 'show_help', args: {}, reason: 'User requested command list' };
    }

    if (isCreateGroup) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'create_group' }, reason: 'No authorization for group creation' };
      }
      return { tool: 'create_group', args: {}, reason: 'User requested group creation' };
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
      // Check for explicit provider requests (case-insensitive, space-flexible)
      const wantsOpenAI = /\b(open\s*ai|gpt|dall[\s-]*e)\b/i.test(prompt);
      const wantsGrok = /\b(grok|x\s*ai)\b/i.test(prompt);
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
      // Check if user explicitly requested Veo3 (case-insensitive, with or without space)
      const wantsVeo3 = /\bveo\s*3?\b/i.test(prompt);
      if (wantsVeo3) {
        return { tool: 'veo3_video', args: { prompt }, reason: 'Video-like request, user requested Veo3' };
      }
      // Default to Kling for text-to-video
      return { tool: 'kling_text_to_video', args: { prompt }, reason: 'Video-like request' };
    }

    // Default: chat. Check for explicit provider requests (case-insensitive, space-flexible)
    const wantsOpenAI = /\b(open\s*ai|gpt|chat\s*gpt)\b/i.test(prompt);
    const wantsGrok = /\b(grok|x\s*ai)\b/i.test(prompt);
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
    'chat_summary', 'music_generation', 'creative_voice_processing', 'show_help', 'create_group', 'deny_unauthorized', 'ask_clarification'
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
  
  return `You are a smart intent router for a WhatsApp AI bot. 
Your task: Analyze the user's request and return ONLY a valid JSON object.

🌍 LANGUAGE SUPPORT: Both Hebrew and English (treat equally, case-insensitive)
🔤 MATCHING RULES: 
   - All keyword matching is case-insensitive (VEO = veo = Veo)
   - Space-flexible (OpenAI = Open AI, ChatGPT = Chat GPT, veo3 = veo 3)
   - WHOLE WORDS ONLY (realistic ≠ list, classroom ≠ room, musician ≠ music)

🔍 INPUT CONTEXT:
${JSON.stringify(payload, null, 2)}

📋 DECISION LOGIC (follow this EXACT order):

1️⃣ **IF hasImage=true** (user sent an image):
   - Image + video keywords + Veo mention → "veo3_image_to_video"
     ✓ Veo mentions: "veo", "Veo", "VEO", "veo 3", "Veo 3", "VEO 3", "veo3", etc.
   - Image + video keywords (NO Veo) → "kling_image_to_video"
   - Image + analysis keywords (what/describe/מה/תאר) → "gemini_chat"
   - Image + edit request → "image_edit" 
   - Image alone (no text) → "ask_clarification"
   ⚠️ NEVER choose music/TTS/help when hasImage=true

2️⃣ **IF hasVideo=true** (user sent a video):
   - Always → "video_to_video"
   ⚠️ NEVER choose music/TTS/help when hasVideo=true

3️⃣ **IF hasAudio=true** (voice message):
   - If voice_allowed → "creative_voice_processing"
   - Else → "deny_unauthorized"

4️⃣ **IF text only** (no media attached):
   STEP A: Look for PRIMARY INTENT keywords (whole word, case-insensitive):
   
   🎵 **Music Generation:**
      Keywords: "שיר", "מוזיקה", "שירון", "song", "music", "suno"
      → "music_generation"
      ⚠️ False positives: "musician", "musical", "musicology" are NOT music requests
   
   🖼️ **Image Generation:**
      Keywords: "תמונה", "ציור", "צייר", "ציירי", "draw", "picture", "image", "poster", "illustration", "render"
      STEP B: Check provider preference:
        - Mentions "OpenAI"/"Open AI"/"GPT"/"DALL-E"/"DALL E"/"dalle" → "openai_image"
        - Mentions "Grok"/"xAI"/"x AI" → "grok_image"
        - Otherwise → "gemini_image" (default)
      ⚠️ False positives: "imaginative", "imagine", "drawer" are NOT image requests
      
   🎬 **Video Generation:**
      Keywords: "וידאו", "video", "סרט", "אנימציה", "קליפ", "clip", "animate", "motion"
      STEP B: Check model preference:
        - Mentions "veo"/"Veo"/"VEO"/"veo 3"/"Veo 3"/"veo3" (any case, with/without space) → "veo3_video"
        - Otherwise → "kling_text_to_video" (default)
      ⚠️ False positives: "videographer", "clipboard", "eclipse" are NOT video requests
   
   🗣️ **Text-to-Speech (TTS):**
      Keywords: "הקרא", "הקריא", "קרא", "דיבור", "speech", "TTS", "read this", "אמור", "להשמיע"
      → "text_to_speech"
      💡 Note: Extract text after colon if present
      ⚠️ False positives: "speechless", "freedom" are NOT TTS requests
   
   📝 **Chat Summary:**
      Keywords: "סכם", "סיכום", "summary", "לסכם", "summarize"
      → "chat_summary"
   
   👥 **Create Group:**
      Keywords: "צור קבוצה", "יצירת קבוצה", "create group", "new group", "קבוצה חדשה"
      → "create_group"
      ⚠️ Requires media_creation authorization
   
   ℹ️ **Help/Commands:**
      Keywords: "פקודות", "רשימת פקודות", "רשימה", "commands", "list", "help", "עזרה", "capabilities"
      → "show_help"
      ⚠️ False positives: "realistic", "playlist", "checklist" are NOT help requests
   
   💬 **DEFAULT** (anything else):
      If NO keywords matched → Check for chat provider preference:
        - Mentions "OpenAI"/"Open AI"/"GPT"/"ChatGPT"/"Chat GPT" → "openai_chat"
        - Mentions "Grok"/"xAI"/"x AI" → "grok_chat"
        - Otherwise → "gemini_chat" (default, most common)
      ✓ Includes: greetings, questions, stories, complex descriptions without keywords

🎯 **CRITICAL EXAMPLES:**

   ✅ IMAGE GENERATION:
   Input: {"userText": "# צייר פיל", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_image", "args": {"prompt": "צייר פיל"}, "reason": "Draw request"}
   
   Input: {"userText": "# צור תמונה של פיל עם Grok", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צור תמונה של פיל עם Grok"}, "reason": "Image request with Grok"}

   ✅ VIDEO GENERATION WITH VEO 3:
   Input: {"userText": "# צור וידאו עם Veo 3: A cinematic classroom scene inside a school computer lab. A student sits in front of a computer, frowning and frustrated. He raises his hand and says: המורה, האתר לא עובד! The teacher, calm but slightly tired, replies: אני יודעת, תומר. השרת נפל. Then the scene transitions into a memory flashback — a soft blur or light-flash effect marks the transition. In the flashback scene, we see the school's janitor (the server) cleaning the hallway floor. As he wipes the floor, he suddenly slips on the wet surface and dramatically falls flat to the ground, dropping his mop and bucket, water splashing around him. The fall should be clear, physical, and slightly exaggerated, emphasized. Use realistic lighting, detailed facial expressions, cinematic slow motion during the fall, and a humorous yet cinematic tone.", "hasImage": false, "hasVideo": false}
   Output: {"tool": "veo3_video", "args": {"prompt": "צור וידאו עם Veo 3: A cinematic classroom scene..."}, "reason": "Video request with Veo 3 - explicit video keyword with Veo mention"}
   
   Input: {"userText": "# הפוך את התמונה לווידאו באמצעות Veo 3", "hasImage": true, "hasVideo": false}
   Output: {"tool": "veo3_image_to_video", "args": {"prompt": "הפוך את התמונה לווידאו באמצעות Veo 3"}, "reason": "Image to video with Veo 3"}
   
   Input: {"userText": "# צור וידאו עם veo של אריה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "veo3_video", "args": {"prompt": "צור וידאו עם veo של אריה"}, "reason": "Video request with Veo"}
   
   Input: {"userText": "# Make a video with Veo 3 of a cat playing", "hasImage": false, "hasVideo": false}
   Output: {"tool": "veo3_video", "args": {"prompt": "Make a video with Veo 3 of a cat playing"}, "reason": "Video request with Veo 3"}

   ✅ VIDEO GENERATION WITHOUT VEO (default to Kling):
   Input: {"userText": "# צור וידאו של חתול רץ", "hasImage": false, "hasVideo": false}
   Output: {"tool": "kling_text_to_video", "args": {"prompt": "צור וידאו של חתול רץ"}, "reason": "Video request, default to Kling"}

   ✅ CHAT (NOT help, even with "list" in words):
   Input: {"userText": "# היי", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "היי"}, "reason": "Greeting"}
   
   Input: {"userText": "# A cinematic classroom scene with realistic lighting", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "A cinematic classroom scene with realistic lighting"}, "reason": "Complex description - chat"}

   ✅ IMAGE EDITING:
   Input: {"userText": "# הוסף כובע", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "הוסף כובע"}, "reason": "Edit image"}

   Input: {"userText": "# הוסף כובע עם OpenAI", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "openai", "prompt": "הוסף כובע עם OpenAI"}, "reason": "Edit image with OpenAI"}

   ✅ IMAGE ANALYSIS:
   Input: {"userText": "# מה זה?", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "מה זה?"}, "reason": "Image analysis"}

   ✅ MUSIC GENERATION:
   Input: {"userText": "# צור שיר על אהבה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "music_generation", "args": {"prompt": "צור שיר על אהבה"}, "reason": "Song request"}
   
   Input: {"userText": "# Create a song with Suno", "hasImage": false, "hasVideo": false}
   Output: {"tool": "music_generation", "args": {"prompt": "Create a song with Suno"}, "reason": "Music request"}

   ✅ TEXT-TO-SPEECH:
   Input: {"userText": "# הקרא: שלום עולם", "hasImage": false, "hasVideo": false}
   Output: {"tool": "text_to_speech", "args": {"text": "שלום עולם"}, "reason": "TTS request"}
   
   Input: {"userText": "# Read this: Hello world", "hasImage": false, "hasVideo": false}
   Output: {"tool": "text_to_speech", "args": {"text": "Hello world"}, "reason": "TTS request"}

   ✅ CHAT SUMMARY:
   Input: {"userText": "# סכם את השיחה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "chat_summary", "args": {"prompt": "סכם את השיחה"}, "reason": "Summary request"}
   
   Input: {"userText": "# summarize", "hasImage": false, "hasVideo": false}
   Output: {"tool": "chat_summary", "args": {"prompt": "summarize"}, "reason": "Summary request"}

   ✅ PROVIDER VARIATIONS (case-insensitive, space-flexible):
   Input: {"userText": "# Draw a cat with OPENAI", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_image", "args": {"prompt": "Draw a cat with OPENAI"}, "reason": "Image with OpenAI"}
   
   Input: {"userText": "# תמונה של כלב עם Open AI", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_image", "args": {"prompt": "תמונה של כלב עם Open AI"}, "reason": "Image with OpenAI"}
   
   Input: {"userText": "# צור תמונה עם GROK", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צור תמונה עם GROK"}, "reason": "Image with Grok"}
   
   Input: {"userText": "# היי ChatGPT", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_chat", "args": {"prompt": "היי ChatGPT"}, "reason": "Chat with OpenAI"}
   
   Input: {"userText": "# שאלה לגרוק: מה השעה?", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_chat", "args": {"prompt": "שאלה לגרוק: מה השעה?"}, "reason": "Chat with Grok"}

   ✅ EDGE CASES (should NOT trigger):
   Input: {"userText": "# This is a realistic story about a musician", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "This is a realistic story about a musician"}, "reason": "Chat - no trigger keywords (realistic≠list, musician≠music)"}
   
   Input: {"userText": "# I love listening to my playlist", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "I love listening to my playlist"}, "reason": "Chat - no trigger keywords (playlist≠list)"}
   
   Input: {"userText": "# The clipboard has a video file", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "The clipboard has a video file"}, "reason": "Chat - no PRIMARY intent (clipboard≠clip, 'video' as noun not verb)"}

   ✅ VIDEO EDITING:
   Input: {"userText": "# ערוך וידאו", "hasImage": false, "hasVideo": true}
   Output: {"tool": "video_to_video", "args": {"service": "runway", "prompt": "ערוך וידאו"}, "reason": "Video edit"}

⚠️ **CRITICAL RULES (MUST FOLLOW EXACTLY):**

1️⃣ **PRIORITY ORDER:**
   Step 1: Check hasImage/hasVideo/hasAudio flags FIRST
   Step 2: Look for PRIMARY INTENT keywords (music/image/video/etc.)
   Step 3: Check provider/model preferences (OpenAI/Grok/Veo)
   Step 4: Default to gemini_chat if nothing matches

2️⃣ **KEYWORD MATCHING:**
   - ✅ WHOLE WORDS ONLY: Match complete words, ignore substrings
   - ✅ CASE-INSENSITIVE: VEO = veo = Veo = vEo
   - ✅ SPACE-FLEXIBLE: OpenAI = Open AI, veo3 = veo 3, ChatGPT = Chat GPT
   - ❌ NO SUBSTRINGS: realistic≠list, musician≠music, clipboard≠clip, playlist≠list

3️⃣ **PROVIDER DETECTION (case-insensitive, space-flexible):**
   OpenAI triggers: "OpenAI", "Open AI", "GPT", "ChatGPT", "Chat GPT", "DALL-E", "DALL E", "dalle"
   Grok triggers: "Grok", "grok", "xAI", "x AI", "XAI"
   Veo triggers: "veo", "Veo", "VEO", "veo 3", "Veo 3", "VEO 3", "veo3"
   
4️⃣ **LANGUAGE SUPPORT:**
   - Treat Hebrew and English equally
   - Hebrew keywords: וידאו, תמונה, ציור, שיר, מוזיקה, etc.
   - English keywords: video, image, draw, song, music, etc.

5️⃣ **WHEN IN DOUBT:**
   - If unsure → choose "gemini_chat" (safest default)
   - Long descriptive prompts without explicit keywords → "gemini_chat"
   - Stories, conversations, questions → "gemini_chat"

6️⃣ **AUTHORIZATION CHECKS:**
   - If media_creation=false and user requests image/video/music/group → "deny_unauthorized"
   - If voice_allowed=false and hasAudio=true → "deny_unauthorized"

7️⃣ **OUTPUT FORMAT:**
   - Return ONLY valid JSON
   - NO markdown, NO code fences, NO extra text
   - Always include "tool", "args" with "prompt", and "reason"

📤 OUTPUT SCHEMA:
{
  "tool": "tool_name",
  "args": {"prompt": "full original user text without # prefix"},
  "reason": "brief 1-2 word explanation"
}

⚙️ AVAILABLE TOOLS:
gemini_chat, openai_chat, grok_chat, gemini_image, openai_image, grok_image, kling_text_to_video, veo3_video, kling_image_to_video, veo3_image_to_video, video_to_video, image_edit, text_to_speech, music_generation, chat_summary, creative_voice_processing, deny_unauthorized, ask_clarification, show_help, create_group`;
}


