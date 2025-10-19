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
    // Lazy evaluation: check voice authorization only when needed
    if (input.senderData) {
      const conversationManager = require('../services/conversationManager');
      const isAuthorized = await conversationManager.isAuthorizedForVoiceTranscription(input.senderData);
      if (!isAuthorized) {
        return { tool: 'deny_unauthorized', args: { feature: 'voice' }, reason: 'Voice not allowed' };
      }
    } else if (!input.authorizations?.voice_allowed) {
      // Fallback for old calls without senderData
      return { tool: 'deny_unauthorized', args: { feature: 'voice' }, reason: 'Voice not allowed' };
    }
    // For now, route to creative voice processing (current active flow)
    return { tool: 'creative_voice_processing', args: {}, reason: 'Audio message - creative flow' };
  }

  // If there is an attached image with text prompt → decide between image edit vs image→video vs analysis
  if (input.hasImage && prompt) {
    // First priority: Check if it's a video generation request
    const isVideoLike = /\b(video|animate|motion|clip)\b|וידאו|סרט|אנימציה|הנפש|להנפיש|תזיז|קליפ/i.test(prompt);
    if (isVideoLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'image_to_video' }, reason: 'No media creation authorization' };
      }
      // Check for explicit model requests (case-insensitive, with or without space, including Hebrew)
      // Supports model name anywhere in the prompt, not just at the end
      // Note: Using \b only for English words; for Hebrew, check without word boundaries
      // Supports both "veo 3" and "veo 3.1" (same for Hebrew)
      const wantsVeo3 = /\bveo\s*3(\.1)?\b|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?/i.test(prompt);
      const wantsKling = /\bkling\b|קלינג/i.test(prompt);
      
      if (wantsVeo3) {
        return { tool: 'veo3_image_to_video', args: { prompt }, reason: 'Image attached, user requested Veo3' };
      }
      if (wantsKling) {
        return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, user requested Kling' };
      }
      // Default to Kling for image-to-video
      return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, video-like request' };
    }
    
    // Second priority: Check if user wants image analysis/questions (text-only response)
    // Expanded to include more question patterns and info requests
    const isAnalysisRequest = /^(מה|איך|למה|האם|תאר|ספר|הסבר|זהה|בדוק|אמור|כמה|מתי|איפה|מי|אילו|האם.*זה|זה.*מה|יש.*ב|נמצא.*ב|רואים.*ב|מופיע.*ב|זיהוי|identify|explain|tell|is\s+(this|it|he|she|that)|are\s+(these|they|those)|does|can|could|would|should|what|how|why|when|where|who|which|describe|analyze|analysis|detect|recognize|find|show|list|count|safe|dangerous|מסוכן|בטוח)\b/i.test(prompt);
    if (isAnalysisRequest) {
      // Check if user wants to reference previous messages in the analysis
      const needsChatHistory = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
      return { tool: 'gemini_chat', args: { prompt, needsChatHistory }, reason: 'Image analysis/question' };
    }
    
    // Third priority: Check if it's an edit command (requires authorization)
    // Edit keywords: add, remove, change, make, create, replace, etc.
    const isEditRequest = /\b(add|remove|delete|change|replace|modify|edit|make|create|draw|paint|color|set|put|insert|erase|fix|adjust|enhance|improve|transform|convert)\b|הוסף|הסר|מחק|שנה|החלף|ערוך|צור|צייר|צבע|הכנס|תקן|שפר|המר|הפוך(?!.*וידאו)|עשה|תן/i.test(prompt);
    
    // Implicit edit: If prompt describes a state/appearance without being a question
    // Examples: "לבוש בקימונו", "wearing a hat", "with glasses", "as a superhero"
    // Hebrew: לבוש ב, עם, כ (כברבי, כסופרמן), בתור
    // English: wearing, dressed, as a, with, in a
    const isImplicitEdit = /^(לבוש|לבושה|לובש|לובשת|עם|כ(?!מה)|בתור|wearing|dressed|with\s+a|as\s+a|in\s+a)\b/i.test(prompt);
    
    if (isEditRequest || isImplicitEdit) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'image_edit' }, reason: 'No media creation authorization' };
      }
      // Check for explicit provider requests (including Hebrew)
      // Note: Using \b only for English words; for Hebrew, check without word boundaries
      const wantsOpenAI = /\b(open\s*ai|gpt|dall[\s-]*e)\b|דאל[\s-]*אי/i.test(prompt);
      const service = wantsOpenAI ? 'openai' : 'gemini';
      return { tool: 'image_edit', args: { service, prompt }, reason: 'Image edit request' };
    }
    
    // Default: If no clear pattern detected, treat as analysis/question
    // This is safer than defaulting to edit
    // Check if user wants to reference previous messages in the analysis
    const needsChatHistoryDefault = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, needsChatHistory: needsChatHistoryDefault }, reason: 'Image-related request (default to analysis)' };
  }

  // If there is an attached video with text prompt → decide between video analysis vs video-to-video
  if (input.hasVideo && prompt) {
    // First priority: Check if user wants video analysis/questions (text-only response)
    // Same pattern as image analysis
    const isAnalysisRequest = /^(מה|איך|למה|האם|תאר|ספר|הסבר|זהה|בדוק|אמור|כמה|מתי|איפה|מי|אילו|האם.*זה|זה.*מה|יש.*ב|נמצא.*ב|רואים.*ב|מופיע.*ב|זיהוי|identify|explain|tell|is\s+(this|it|he|she|that)|are\s+(these|they|those)|does|can|could|would|should|what|how|why|when|where|who|which|describe|analyze|analysis|detect|recognize|find|show|list|count|safe|dangerous|מסוכן|בטוח)\b/i.test(prompt);
    if (isAnalysisRequest) {
      // Check if user wants to reference previous messages in the analysis
      const needsChatHistory = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
      return { tool: 'gemini_chat', args: { prompt, needsChatHistory }, reason: 'Video analysis/question' };
    }
    
    // Second priority: Video-to-video editing (requires authorization)
    const isEditRequest = /\b(add|remove|delete|change|replace|modify|edit|make|create|draw|paint|color|set|put|insert|erase|fix|adjust|enhance|improve|transform|convert)\b|הוסף|הסר|מחק|שנה|החלף|ערוך|צור|צייר|צבע|הכנס|תקן|שפר|המר|הפוך(?!.*וידאו)|עשה|תן/i.test(prompt);
    if (isEditRequest) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'video_to_video' }, reason: 'No media creation authorization' };
      }
      // Only Runway for video editing
      const service = 'runway';
      return { tool: 'video_to_video', args: { service, prompt }, reason: 'Video edit request' };
    }
    
    // Default: If no clear pattern detected, treat as analysis/question
    // This is safer than defaulting to edit
    // Check if user wants to reference previous messages in the analysis
    const needsChatHistoryVideoDefault = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, needsChatHistory: needsChatHistoryVideoDefault }, reason: 'Video-related request (default to analysis)' };
  }

  // If there is an attached audio/voice note with text prompt → decide between creative mix, voice response, or general request
  if (input.hasAudio && prompt) {
    // First priority: Check if user wants creative audio mix
    const isCreativeMix = /\b(mix|remix|creative|effect|ערבב|מיקס|יצירתי|אפקט|רמיקס)\b/i.test(prompt);
    if (isCreativeMix) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'creative_audio' }, reason: 'No media creation authorization' };
      }
      return { tool: 'creative_voice_processing', args: { prompt }, reason: 'Audio creative mix requested' };
    }
    
    // Second priority: Check if user wants voice cloning response
    const isVoiceResponse = /\b(ענה|תגיב|תגובה|השב|תשובה|reply|respond|response|answer|react)\b.*\b(לזה|על\s*זה|קולי|בקול|to\s+this|to\s+it|voice)\b|תגובה\s+קולית|מענה\s+קולי|voice\s+response|voice\s+reply/i.test(prompt);
    if (isVoiceResponse) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'voice_cloning' }, reason: 'No media creation authorization' };
      }
      return { tool: 'voice_cloning_response', args: { prompt }, reason: 'Voice cloning response requested' };
    }
    
    // Third priority: General requests (transcription, translation, etc.) - route to gemini_chat
    // These will need transcription first, then processing
    const needsChatHistoryAudio = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, needsChatHistory: needsChatHistoryAudio, needsTranscription: true }, reason: 'Audio with general request (transcribe + process)' };
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
    const isCreateGroup = /צור.*קבוצה|יצירת.*קבוצה|פתח.*קבוצה|פתיחת.*קבוצה|הקם.*קבוצה|הקמת.*קבוצה|create.*group|new.*group|open.*group|start.*group|קבוצה.*חדשה/i.test(prompt);
    const isRetry = /^(נסה\s+שוב|שוב|עוד\s+פעם|שנית|retry|again|try\s+again|once\s+more)\b/i.test(prompt);
    const isPoll = /צור.*סקר|יצירת.*סקר|סקר.*על|סקר.*בנושא|הכן.*סקר|create.*poll|make.*poll|poll.*about|new.*poll/i.test(prompt);
    
    // Debug: log intent detection
    console.log(`🔍 Intent Router - Prompt: "${prompt.substring(0, 100)}" | Image:${isImageLike} Video:${isVideoLike} Music:${isMusic} TTS:${isTtsLike} Retry:${isRetry} Poll:${isPoll}`);
    
    if (isRetry) {
      return { tool: 'retry_last_command', args: {}, reason: 'User requested retry' };
    }
    
    if (isPoll) {
      return { tool: 'create_poll', args: { prompt }, reason: 'User requested poll creation' };
    }
    
    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isHelp) {
      return { tool: 'show_help', args: {}, reason: 'User requested command list' };
    }

    if (isCreateGroup) {
      // Lazy evaluation: check group creation authorization only when needed
      if (input.senderData) {
        const groupAuthStore = require('../store/groupAuthStore');
        const isAuthorized = await groupAuthStore.isAuthorizedForGroupCreation(input.senderData);
        if (!isAuthorized) {
          return { tool: 'deny_unauthorized', args: { feature: 'create_group' }, reason: 'No authorization for group creation' };
        }
      } else if (!input.authorizations?.group_creation) {
        // Fallback for old calls without senderData
        return { tool: 'deny_unauthorized', args: { feature: 'create_group' }, reason: 'No authorization for group creation' };
      }
      return { tool: 'create_group', args: { prompt }, reason: 'User requested group creation' };
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
      // Check for explicit provider requests (case-insensitive, space-flexible, including Hebrew)
      // Supports provider name anywhere in the prompt, not just at the end
      // Note: Using \b only for English words; for Hebrew, check without word boundaries
      const wantsOpenAI = /\b(open\s*ai|gpt|chat\s*gpt|dall[\s-]*e)\b|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי/i.test(prompt);
      const wantsGrok = /\bgrok\b|\bx\s*ai\b|גרוק/i.test(prompt);
      const wantsGemini = /\bgemini\b|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני/i.test(prompt);
      
      if (wantsOpenAI) {
        return { tool: 'openai_image', args: { prompt }, reason: 'Image-like request, user requested OpenAI' };
      }
      if (wantsGrok) {
        return { tool: 'grok_image', args: { prompt }, reason: 'Image-like request, user requested Grok' };
      }
      if (wantsGemini) {
        return { tool: 'gemini_image', args: { prompt }, reason: 'Image-like request, user requested Gemini' };
      }
      // Default to Gemini
      return { tool: 'gemini_image', args: { prompt }, reason: 'Image-like request' };
    }

    if (isVideoLike) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'video_generation' }, reason: 'No media creation authorization' };
      }
      // Check for explicit model requests (case-insensitive, with or without space, including Hebrew)
      // Supports model name anywhere in the prompt, not just at the end
      // Note: Using \b only for English words; for Hebrew, check without word boundaries
      // Supports both "veo 3" and "veo 3.1" (same for Hebrew)
      const wantsVeo3 = /\bveo\s*3(\.1)?\b|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?/i.test(prompt);
      const wantsKling = /\bkling\b|קלינג/i.test(prompt);
      
      if (wantsVeo3) {
        return { tool: 'veo3_video', args: { prompt }, reason: 'Video-like request, user requested Veo3' };
      }
      if (wantsKling) {
        return { tool: 'kling_text_to_video', args: { prompt }, reason: 'Video-like request, user requested Kling' };
      }
      // Default to Kling for text-to-video
      return { tool: 'kling_text_to_video', args: { prompt }, reason: 'Video-like request' };
    }

    // Default: chat. Check for explicit provider requests (case-insensitive, space-flexible, including Hebrew)
    // Supports provider name anywhere in the prompt, not just at the end
    // Note: Using \b only for English words; for Hebrew, check without word boundaries
    const wantsOpenAI = /\b(open\s*ai|gpt|chat\s*gpt)\b|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי/i.test(prompt);
    const wantsGrok = /\bgrok\b|\bx\s*ai\b|גרוק/i.test(prompt);
    const wantsGemini = /\bgemini\b|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני/i.test(prompt);
    
    // Check if user wants to reference previous messages in the chat/group
    // Hebrew patterns: לפי ההודעות, על סמך ההודעות, בהתייחס להודעות, על פי ההודעות, לפי השיחה, מההודעות האחרונות, etc.
    // English patterns: based on messages, according to messages, referring to messages, based on chat, from recent messages, etc.
    const needsChatHistory = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages/i.test(prompt);
    
    if (wantsOpenAI) {
      return { tool: 'openai_chat', args: { prompt, needsChatHistory }, reason: 'Chat request, user requested OpenAI' };
    }
    if (wantsGrok) {
      return { tool: 'grok_chat', args: { prompt, needsChatHistory }, reason: 'Chat request, user requested Grok' };
    }
    if (wantsGemini) {
      return { tool: 'gemini_chat', args: { prompt, needsChatHistory }, reason: 'Chat request, user requested Gemini' };
    }
    // Default to Gemini
    return { tool: 'gemini_chat', args: { prompt, needsChatHistory }, reason: 'Default to chat' };
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
    'chat_summary', 'music_generation', 'create_poll', 'creative_voice_processing', 'voice_cloning_response', 'show_help', 'create_group', 'retry_last_command', 'deny_unauthorized', 'ask_clarification'
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
      group_creation: !!(input.authorizations && input.authorizations.group_creation),
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
   PRIORITY ORDER (check in this exact sequence):
   
   A. **Video Generation** (highest priority for video keywords):
      - Image + video keywords + Veo mention → "veo3_image_to_video"
        ✓ Veo mentions: "veo", "Veo", "VEO", "veo 3", "veo 3.1", "Veo 3.1", "VEO 3.1", "veo3", "veo3.1", etc.
        ✓ Video keywords: "וידאו", "video", "סרט", "אנימציה", "הנפש", "להנפיש", "animate", "motion", "clip"
      - Image + video keywords (NO Veo) → "kling_image_to_video"
   
   B. **Analysis/Questions** (second priority - text-only response):
      ✓ Question words: "מה", "איך", "למה", "האם", "מי", "איפה", "מתי", "כמה", "what", "how", "why", "is", "are", "does", "can", "should", "could", "would", "who", "where", "when", "which"
      ✓ Info requests: "תאר", "ספר", "הסבר", "זהה", "בדוק", "describe", "explain", "tell", "identify", "analyze", "detect", "recognize"
      ✓ Safety/assessment: "בטוח", "מסוכן", "safe", "dangerous", "good", "bad"
      ✓ Pattern examples:
        - "מה זה?" → "gemini_chat"
        - "האם הכלב מסוכן?" → "gemini_chat"
        - "תאר את התמונה" → "gemini_chat"
        - "is this safe?" → "gemini_chat"
        - "can I eat this?" → "gemini_chat"
      → "gemini_chat" (text-only analysis)
      
      💡 **CHAT HISTORY**: If request mentions previous messages (e.g., "לפי ההודעות האחרונות מה זה?"), set needsChatHistory=true
   
   C. **Image Editing** (third priority - requires authorization):
      ✓ Edit keywords: "הוסף", "הסר", "מחק", "שנה", "החלף", "ערוך", "צבע", "add", "remove", "delete", "change", "replace", "edit", "make", "create", "draw", "paint", "color"
      ✓ Implicit edit patterns (describes state/appearance): "לבוש בקימונו", "עם משקפיים", "כברבי", "wearing a hat", "with glasses", "as a superhero"
      ✓ Requires media_creation authorization
      ✓ Check provider preference (OpenAI/Gemini)
      → "image_edit"
      
      💡 **IMPORTANT**: If prompt describes how person/object should look (without being a question), treat as edit request!
   
   D. **Default** (no clear pattern):
      - If unclear → "gemini_chat" (safer to analyze than edit)
   
   ⚠️ NEVER choose music/TTS/help when hasImage=true

2️⃣ **IF hasVideo=true** (user sent a video):
   PRIORITY ORDER (check in this exact sequence):
   
   A. **Video Analysis/Questions** (highest priority - text-only response):
      ✓ Question words: "מה", "איך", "למה", "האם", "מי", "איפה", "מתי", "כמה", "what", "how", "why", "is", "are", "does", "can", "should", "could", "would", "who", "where", "when", "which"
      ✓ Info requests: "תאר", "ספר", "הסבר", "זהה", "בדוק", "describe", "explain", "tell", "identify", "analyze", "detect", "recognize"
      ✓ Safety/assessment: "בטוח", "מסוכן", "safe", "dangerous", "good", "bad"
      ✓ Pattern examples:
        - "מה קורה בוידאו?" → "gemini_chat"
        - "תאר את הוידאו" → "gemini_chat"
        - "what is happening in this video?" → "gemini_chat"
      → "gemini_chat" (text-only analysis)
      
      💡 **CHAT HISTORY**: If request mentions previous messages (e.g., "לפי ההודעות בקבוצה מה קורה בוידאו?"), set needsChatHistory=true
   
   B. **Video Editing** (second priority - requires authorization):
      ✓ Edit keywords: "הוסף", "הסר", "מחק", "שנה", "החלף", "ערוך", "add", "remove", "delete", "change", "replace", "edit", "make", "create"
      ✓ Requires media_creation authorization
      → "video_to_video"
   
   C. **Default** (no clear pattern):
      - If unclear → "gemini_chat" (safer to analyze than edit)
   
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
        - Mentions "veo"/"Veo"/"VEO"/"veo 3"/"veo 3.1"/"Veo 3.1"/"veo3"/"veo3.1" (any case, with/without space) → "veo3_video"
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
   
   🔄 **Retry Last Command:**
      Keywords: "נסה שוב", "שוב", "עוד פעם", "שנית", "retry", "again", "try again", "once more"
      → "retry_last_command"
      💡 Note: Re-runs the last command executed in this chat (or quoted message command)
   
   📊 **Poll Creation:**
      Keywords: "צור סקר", "יצירת סקר", "סקר על", "סקר בנושא", "הכן סקר", "create poll", "make poll", "poll about", "new poll"
      → "create_poll"
      💡 Note: Creates a creative poll with 2 rhyming options about the given topic
   
   👥 **Group Creation:**
      Keywords: "צור קבוצה", "יצירת קבוצה", "פתח קבוצה", "פתיחת קבוצה", "הקם קבוצה", "הקמת קבוצה", "create group", "new group", "open group", "start group", "קבוצה חדשה"
      → "create_group"
      ⚠️ Requires group_creation authorization
      💡 Can include: group name, participants, and optional picture description
   
   ℹ️ **Help/Commands:**
      Keywords: "פקודות", "רשימת פקודות", "רשימה", "commands", "list", "help", "עזרה", "capabilities"
      → "show_help"
      ⚠️ False positives: "realistic", "playlist", "checklist" are NOT help requests
   
   💬 **DEFAULT** (anything else):
      If NO keywords matched → Check for chat provider preference:
        - Mentions "OpenAI"/"Open AI"/"GPT"/"ChatGPT"/"Chat GPT"/"צ'אט ג'יפיטי"/"צ׳אט ג׳יפיטי" → "openai_chat"
        - Mentions "Grok"/"grok"/"xAI"/"x AI"/"גרוק" → "grok_chat"
        - Mentions "Gemini"/"gemini"/"ג'מיני"/"ג׳מיני" → "gemini_chat" (explicit)
        - Otherwise → "gemini_chat" (default, most common)
      ✓ Includes: greetings, questions, stories, complex descriptions without keywords
      ⚠️ CRITICAL: Hebrew names like "גרוק", "ג'מיני" are FULL WORDS, match them!
      
      🔍 **CHAT HISTORY CONTEXT** (applies to ALL chat tools):
      If the user's request mentions previous messages in the chat/group, set needsChatHistory=true in args:
      Hebrew patterns: "לפי ההודעות", "על סמך ההודעות", "בהתייחס להודעות", "על פי ההודעות", "לפי השיחה", "מההודעות האחרונות", "הודעות אחרונות", "הודעות קודמות"
      English patterns: "based on messages", "according to messages", "referring to messages", "based on chat", "from recent messages", "recent messages", "previous messages"
      
      Examples with chat history:
      - "# לפי ההודעות האחרונות, מה אני צריך לעשות?" → {"tool": "gemini_chat", "args": {"prompt": "...", "needsChatHistory": true}}
      - "# על סמך השיחה, תן לי סיכום" → {"tool": "gemini_chat", "args": {"prompt": "...", "needsChatHistory": true}}
      - "# based on the recent messages, what should I do?" → {"tool": "gemini_chat", "args": {"prompt": "...", "needsChatHistory": true}}

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

   ✅ IMAGE EDITING (Explicit keywords):
   Input: {"userText": "# הוסף כובע", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "הוסף כובע"}, "reason": "Edit image"}

   Input: {"userText": "# הוסף כובע עם OpenAI", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "openai", "prompt": "הוסף כובע עם OpenAI"}, "reason": "Edit image with OpenAI"}

   ✅ IMAGE EDITING (Implicit - describes appearance):
   Input: {"userText": "# לבוש בקימונו יפני", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "לבוש בקימונו יפני"}, "reason": "Edit image"}
   
   Input: {"userText": "# כברבי", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "כברבי"}, "reason": "Edit image"}
   
   Input: {"userText": "# wearing a superhero costume", "hasImage": true, "hasVideo": false}
   Output: {"tool": "image_edit", "args": {"service": "gemini", "prompt": "wearing a superhero costume"}, "reason": "Edit image"}

   ✅ IMAGE ANALYSIS (Text-only response):
   Input: {"userText": "# מה זה?", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "מה זה?"}, "reason": "Image analysis"}
   
   Input: {"userText": "# תאר את התמונה", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "תאר את התמונה"}, "reason": "Image analysis"}
   
   Input: {"userText": "# האם הכלב מסוכן?", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "האם הכלב מסוכן?"}, "reason": "Image analysis"}
   
   Input: {"userText": "# is this safe to eat?", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "is this safe to eat?"}, "reason": "Image analysis"}
   
   Input: {"userText": "# can you tell me what breed is this dog?", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "can you tell me what breed is this dog?"}, "reason": "Image analysis"}
   
   Input: {"userText": "# זהה את הצמח בתמונה", "hasImage": true, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "זהה את הצמח בתמונה"}, "reason": "Image analysis"}

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

   ✅ POLL CREATION:
   Input: {"userText": "# צור סקר על חתולים", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_poll", "args": {"prompt": "צור סקר על חתולים"}, "reason": "Poll creation"}
   
   Input: {"userText": "# סקר בנושא פיצה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_poll", "args": {"prompt": "סקר בנושא פיצה"}, "reason": "Poll creation"}
   
   Input: {"userText": "# create poll about dogs", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_poll", "args": {"prompt": "create poll about dogs"}, "reason": "Poll creation"}

   ✅ GROUP CREATION:
   Input: {"userText": "# צור קבוצה בשם 'כדורגל' עם אבי, רועי", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_group", "args": {"prompt": "צור קבוצה בשם 'כדורגל' עם אבי, רועי"}, "reason": "Group creation"}
   
   Input: {"userText": "# פתח קבוצה עבודה עם שרה ומיכאל", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_group", "args": {"prompt": "פתח קבוצה עבודה עם שרה ומיכאל"}, "reason": "Group creation"}
   
   Input: {"userText": "# create group Project Team with John, Mike", "hasImage": false, "hasVideo": false}
   Output: {"tool": "create_group", "args": {"prompt": "create group Project Team with John, Mike"}, "reason": "Group creation"}

   ✅ PROVIDER VARIATIONS (case-insensitive, space-flexible, including Hebrew):
   Input: {"userText": "# Draw a cat with OPENAI", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_image", "args": {"prompt": "Draw a cat with OPENAI"}, "reason": "Image with OpenAI"}
   
   Input: {"userText": "# תמונה של כלב עם Open AI", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_image", "args": {"prompt": "תמונה של כלב עם Open AI"}, "reason": "Image with OpenAI"}
   
   Input: {"userText": "# צור תמונה עם GROK", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צור תמונה עם GROK"}, "reason": "Image with Grok"}
   
   Input: {"userText": "# צייר חתול עם גרוק", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צייר חתול עם גרוק"}, "reason": "Image with Grok (Hebrew)"}
   
   Input: {"userText": "# תמונה בעזרת ג'מיני של פרח", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_image", "args": {"prompt": "תמונה בעזרת ג'מיני של פרח"}, "reason": "Image with Gemini (Hebrew)"}
   
   Input: {"userText": "# היי ChatGPT", "hasImage": false, "hasVideo": false}
   Output: {"tool": "openai_chat", "args": {"prompt": "היי ChatGPT"}, "reason": "Chat with OpenAI"}
   
   Input: {"userText": "# שאלה לגרוק: מה השעה?", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_chat", "args": {"prompt": "שאלה לגרוק: מה השעה?"}, "reason": "Chat with Grok"}
   
   Input: {"userText": "# צור תמונה בעזרת גרוק של שקיעה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צור תמונה בעזרת גרוק של שקיעה"}, "reason": "Image with Grok (Hebrew)"}
   
   Input: {"userText": "# שיחה עם ג'מיני על מזג האוויר", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "שיחה עם ג'מיני על מזג האוויר"}, "reason": "Chat with Gemini (Hebrew)"}
   
   Input: {"userText": "# שאל את גרוק מה נשמע", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_chat", "args": {"prompt": "שאל את גרוק מה נשמע"}, "reason": "Chat with Grok (Hebrew)"}
   
   Input: {"userText": "# היי גרוק", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_chat", "args": {"prompt": "היי גרוק"}, "reason": "Chat with Grok (Hebrew)"}
   
   Input: {"userText": "# גרוק ספר לי בדיחה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_chat", "args": {"prompt": "גרוק ספר לי בדיחה"}, "reason": "Chat with Grok (Hebrew, provider at start)"}
   
   Input: {"userText": "# בעזרת ג'מיני תסביר לי על AI", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "בעזרת ג'מיני תסביר לי על AI"}, "reason": "Chat with Gemini (Hebrew, provider at start)"}
   
   Input: {"userText": "# צור תמונה גרוק של חתול", "hasImage": false, "hasVideo": false}
   Output: {"tool": "grok_image", "args": {"prompt": "צור תמונה גרוק של חתול"}, "reason": "Image with Grok (Hebrew, provider in middle)"}
   
   Input: {"userText": "# ויאו 3 צור וידאו של אריה", "hasImage": false, "hasVideo": false}
   Output: {"tool": "veo3_video", "args": {"prompt": "ויאו 3 צור וידאו של אריה"}, "reason": "Video with Veo3 (Hebrew, provider at start)"}

   ✅ EDGE CASES (should NOT trigger):
   Input: {"userText": "# This is a realistic story about a musician", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "This is a realistic story about a musician"}, "reason": "Chat - no trigger keywords (realistic≠list, musician≠music)"}
   
   Input: {"userText": "# I love listening to my playlist", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "I love listening to my playlist"}, "reason": "Chat - no trigger keywords (playlist≠list)"}
   
   Input: {"userText": "# The clipboard has a video file", "hasImage": false, "hasVideo": false}
   Output: {"tool": "gemini_chat", "args": {"prompt": "The clipboard has a video file"}, "reason": "Chat - no PRIMARY intent (clipboard≠clip, 'video' as noun not verb)"}

   ✅ VIDEO ANALYSIS (Text-only response):
   Input: {"userText": "# מה קורה בוידאו?", "hasImage": false, "hasVideo": true}
   Output: {"tool": "gemini_chat", "args": {"prompt": "מה קורה בוידאו?"}, "reason": "Video analysis"}
   
   Input: {"userText": "# תאר את הוידאו", "hasImage": false, "hasVideo": true}
   Output: {"tool": "gemini_chat", "args": {"prompt": "תאר את הוידאו"}, "reason": "Video analysis"}
   
   Input: {"userText": "# what is happening in this video?", "hasImage": false, "hasVideo": true}
   Output: {"tool": "gemini_chat", "args": {"prompt": "what is happening in this video?"}, "reason": "Video analysis"}
   
   Input: {"userText": "# זהה את האנשים בוידאו", "hasImage": false, "hasVideo": true}
   Output: {"tool": "gemini_chat", "args": {"prompt": "זהה את האנשים בוידאו"}, "reason": "Video analysis"}

   ✅ VIDEO EDITING:
   Input: {"userText": "# ערוך את הוידאו", "hasImage": false, "hasVideo": true}
   Output: {"tool": "video_to_video", "args": {"service": "runway", "prompt": "ערוך את הוידאו"}, "reason": "Video edit"}
   
   Input: {"userText": "# הוסף מוזיקה לוידאו", "hasImage": false, "hasVideo": true}
   Output: {"tool": "video_to_video", "args": {"service": "runway", "prompt": "הוסף מוזיקה לוידאו"}, "reason": "Video edit"}

⚠️ **CRITICAL RULES (MUST FOLLOW EXACTLY):**

1️⃣ **PRIORITY ORDER:**
   Step 1: Check hasImage/hasVideo/hasAudio flags FIRST
   Step 2: For images - distinguish between VIDEO > ANALYSIS/QUESTIONS > EDIT > DEFAULT_ANALYSIS
   Step 3: Look for PRIMARY INTENT keywords (music/image/video/etc.)
   Step 4: Check provider/model preferences (OpenAI/Grok/Veo)
   Step 5: Default to gemini_chat if nothing matches

2️⃣ **IMAGE WITH TEXT - DECISION PRIORITY:**
   When hasImage=true:
   A. **FIRST** check for video keywords → image_to_video
   B. **SECOND** check for question/analysis patterns → gemini_chat (text response)
      ✓ Questions: "מה", "איך", "למה", "האם", "what", "how", "why", "is", "are", "can", "should"
      ✓ Examples: "מה זה?", "האם מסוכן?", "is this safe?", "can I eat this?"
   C. **THIRD** check for edit keywords → image_edit
      ✓ Edit: "הוסף", "הסר", "שנה", "add", "remove", "change", "make"
   D. **DEFAULT** → gemini_chat (safer than edit)

3️⃣ **KEYWORD MATCHING:**
   - ✅ WHOLE WORDS ONLY: Match complete words, ignore substrings
   - ✅ CASE-INSENSITIVE: VEO = veo = Veo = vEo
   - ✅ SPACE-FLEXIBLE: OpenAI = Open AI, veo3 = veo 3, ChatGPT = Chat GPT
   - ❌ NO SUBSTRINGS: realistic≠list, musician≠music, clipboard≠clip, playlist≠list

4️⃣ **PROVIDER DETECTION (case-insensitive, space-flexible, including Hebrew):**
   OpenAI triggers: "OpenAI", "Open AI", "GPT", "ChatGPT", "Chat GPT", "DALL-E", "DALL E", "dalle", "דאל-אי", "צ'אט ג'יפיטי", "צ׳אט ג׳יפיטי"
   Grok triggers: "Grok", "grok", "xAI", "x AI", "XAI", "גרוק"
   Gemini triggers: "Gemini", "gemini", "ג'מיני", "ג׳מיני", "ג׳ימיני", "ג'ימיני"
   Veo triggers: "veo", "Veo", "VEO", "veo 3", "veo 3.1", "Veo 3.1", "VEO 3.1", "veo3", "veo3.1", "ויאו", "ויאו 3.1", "ווא", "וואו"
   
5️⃣ **LANGUAGE SUPPORT:**
   - Treat Hebrew and English equally
   - Hebrew keywords: וידאו, תמונה, ציור, שיר, מוזיקה, etc.
   - English keywords: video, image, draw, song, music, etc.
   - Hebrew provider names: גרוק, ג'מיני, דאל-אי, ויאו, קלינג, סונו, צ'אט ג'יפיטי
   - Connection words in Hebrew: עם, ב, באמצעות, דרך, בעזרת, ל, את
   - Connection words in English: with, using, via, by, to
   - Provider can appear ANYWHERE in prompt: start, middle, or end

6️⃣ **WHEN IN DOUBT:**
   - If unsure → choose "gemini_chat" (safest default)
   - Long descriptive prompts without explicit keywords → "gemini_chat"
   - Stories, conversations, questions → "gemini_chat"
   - Image with ambiguous text → "gemini_chat" (analysis is safer than edit)

7️⃣ **AUTHORIZATION CHECKS:**
   - If media_creation=false and user requests image/video/music → "deny_unauthorized"
   - If group_creation=false and user requests group creation → "deny_unauthorized"
   - If voice_allowed=false and hasAudio=true → "deny_unauthorized"
   - Image analysis/questions do NOT require authorization (text-only response)

8️⃣ **OUTPUT FORMAT:**
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
gemini_chat, openai_chat, grok_chat, gemini_image, openai_image, grok_image, kling_text_to_video, veo3_video, kling_image_to_video, veo3_image_to_video, video_to_video, image_edit, text_to_speech, music_generation, chat_summary, create_poll, retry_last_command, creative_voice_processing, deny_unauthorized, ask_clarification, show_help`;
}


