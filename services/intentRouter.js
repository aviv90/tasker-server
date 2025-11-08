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

/**
 * Detect if user is requesting improvement/modification of previous command
 * Examples: "לא יצא טוב", "תקן את זה", "הפיל צריך להיות גדול יותר"
 * @param {string} prompt - User's current prompt
 * @returns {boolean} - True if this looks like a refinement request
 */
function isRefinementRequest(prompt) {
  if (!prompt || prompt.length < 3) return false;
  
  const promptLower = prompt.toLowerCase();
  
  // Patterns that indicate dissatisfaction or request for improvement
  const refinementPatterns = [
    // Dissatisfaction / Problems
    /לא\s+(יצא|יצאה|יוצא|טוב|נכון|מדויק|מספיק)/i,  // "לא יצא טוב", "לא נכון"
    /didn't\s+(work|come\s+out|turn\s+out)\s+(well|good|right)/i,
    /not\s+(good|right|correct|accurate|enough)/i,
    
    // Direct requests to fix/improve/change
    /^(תקן|תקני|תקנו|תתקן|fix|correct|improve)\s+/i,  // "תקן את זה"
    /^(שפר|שפרי|שפרו|תשפר|better|enhance)\s+/i,  // "שפר את זה"
    /^(שנה|שני|תשנה|change|modify|alter)\s+/i,  // "שנה את זה"
    
    // References to "this/it" (implies previous context)
    /^(זה|את\s+זה|this|it)\s+(לא|not|isn't|doesn't)/i,  // "זה לא טוב"
    /(תקן|שפר|שנה|fix|improve|change)\s+(את\s+)?(זה|this|it)/i,  // "תקן את זה"
    
    // Comparative requests (implies current result isn't good enough)
    /(צריך|צריכה|should|needs?)\s+(להיות|to\s+be)\s+(יותר|more|less|פחות)/i,  // "צריך להיות גדול יותר"
    /(עם|with|בלי|without)\s+.+\s+(במקום|instead)/i,  // "עם כובע במקום משקפיים"
    /(אבל|but)\s+(עם|with|בלי|without|ב|in)/i,  // "אבל עם שיער ארוך"
    
    // Explicit references to previous output
    /(ה)?(תמונה|וידאו|שיר|מיקום|תוצאה|פלט)\s+(לא|not)/i,  // "התמונה לא יצאה טוב"
    /(ה)?(פיל|חתול|כלב|אדם|בנין|רכב)\s+(לא|not)\s+(יצא|נראה|טוב)/i,  // "הפיל לא יצא טוב"
    
    // "Instead" / "Rather" patterns
    /(במקום|instead\s+of)\s+/i,
    /(ולא|and\s+not|rather\s+than)\s+/i
  ];
  
  // Check if any pattern matches
  for (const pattern of refinementPatterns) {
    if (pattern.test(promptLower)) {
      return true;
    }
  }
  
  return false;
}

async function routeIntent(input) {
  // Optional LLM routing (config-gated). Falls back to heuristic on any failure.
  const useLLM = String(process.env.INTENT_ROUTER_USE_LLM || '').toLowerCase() === 'on';
  
  // IMPORTANT: Check if this is a refinement request BEFORE general routing
  // This allows users to refine previous commands without explicit "retry" keyword
  const prompt = (input.userText || '').trim().replace(/^#\s+/, '');
  
  // ⚙️ Configuration: Should LLM detect refinement?
  const llmRefinementEnabled = useLLM && 
    String(process.env.INTENT_ROUTER_REFINEMENT_USE_LLM || 'true').toLowerCase() === 'true';
  
  // 🔄 REFINEMENT CHECK: If LLM is enabled for refinement, let it detect
  // Otherwise, use heuristic patterns
  if (!llmRefinementEnabled && isRefinementRequest(prompt)) {
    console.log(`🔄 [Heuristic] Detected refinement request: "${prompt.substring(0, 50)}..."`);
    return {
      tool: 'retry_last_command',
      args: { prompt },
      reason: 'Auto-detected refinement request (heuristic)'
    };
  }
  
  // 🤖 LLM ROUTING (PRIORITY): If enabled, let LLM decide everything
  // (including agent routing AND refinement detection if enabled)
  if (useLLM) {
    try {
      const llmDecision = await decideWithLLM(input, { checkRefinement: llmRefinementEnabled });
      const validated = validateDecision(llmDecision);
      if (validated) {
        console.log(`🧠 [LLM Router] Decision: ${validated.tool} - ${validated.reason}`);
        return validated;
      }
    } catch (err) {
      console.log(`⚠️ [LLM Router] Failed (${err.message}), falling back to heuristic`);
      // Fall back to heuristic refinement check if LLM failed
      if (llmRefinementEnabled && isRefinementRequest(prompt)) {
        console.log(`🔄 [Heuristic Fallback] Detected refinement request`);
        return {
          tool: 'retry_last_command',
          args: { prompt },
          reason: 'Auto-detected refinement request (fallback)'
        };
      }
      // Fall back to heuristic routing
    }
  }
  
  // 🤖 HEURISTIC AGENT CHECK (FALLBACK): Only if LLM is off or failed
  // Agent can fetch history, analyze media, search web, etc.
  const { shouldUseAgent } = require('./agentService');
  if (shouldUseAgent(prompt, input)) {
    console.log(`🤖 [Heuristic Router] Detected complex query, routing to agent`);
    return {
      tool: 'agent_query',
      args: { prompt },
      reason: 'Complex query requiring autonomous agent with tools'
    };
  }
  const text = (input.userText || '').trim();
  // Note: prompt already defined at line 100 for refinement check

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
    // Includes common typos: וידיאו, וודאו, ווידאו (Hebrew); vidio, vedio, vidoe (English)
    const isVideoLike = /\b(video|vidio|vedio|vidoe|animate|motion|clip)\b|וידאו|וידיאו|וודאו|ווידאו|וידיו|סרט|אנימציה|הנפש|להנפיש|תזיז|קליפ/i.test(prompt);
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
      // Check for Sora 2 Pro first (more specific), then regular Sora 2
      const wantsSoraPro = /\bsora\s*2?\s*pro\b|סורה\s*2?\s*פרו|סורה\s*2?\s*pro/i.test(prompt);
      const wantsSora = /\bsora\s*2?\b|סורה\s*2?/i.test(prompt);
      
      if (wantsVeo3) {
        return { tool: 'veo3_image_to_video', args: { prompt }, reason: 'Image attached, user requested Veo3' };
      }
      if (wantsSoraPro) {
        return { tool: 'sora_image_to_video', args: { prompt, model: 'sora-2-pro' }, reason: 'Image attached, user requested Sora 2 Pro' };
      }
      if (wantsSora) {
        return { tool: 'sora_image_to_video', args: { prompt, model: 'sora-2' }, reason: 'Image attached, user requested Sora 2' };
      }
      if (wantsKling) {
        return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, user requested Kling' };
      }
      // Default to Kling for image-to-video
      return { tool: 'kling_image_to_video', args: { prompt }, reason: 'Image attached, video-like request' };
    }
    
    // Second priority: Check if it's an edit command (requires authorization)
    // IMPORTANT: Check edit BEFORE analysis to catch edit imperatives like "תוריד", "תסיר"
    // Edit keywords: add, remove, change, make, create, replace, etc.
    // Hebrew imperatives with ALL conjugations (male/female/plural): תוריד/תורידי/תורידו, מחק/מחקי/מחקו...
    const isEditRequest = /\b(add|remove|delete|change|replace|modify|edit|make|create|draw|paint|color|set|put|insert|erase|fix|adjust|enhance|improve|transform|convert)\b|הוסף|הוסיפ|תוסיפ|סיר|תסיר|הסר|תסירי|תסירו|מחק|מחקי|מחקו|תמחק|תמחקי|תמחקו|הורד|הורידי|הורידו|תוריד|תורידי|תורידו|שנה|שני|תשנה|תשני|תשנו|החלף|החליפ|תחליף|תחליפי|תחליפו|ערוך|ערכי|תערוך|תערכי|תערכו|צור|צרי|תצור|תצרי|תצרו|צייר|צירי|תצייר|תצירי|תצירו|צבע|צבעי|תצבע|תצבעי|תצבעו|הכנס|הכניס|תכניס|תכניסי|תכניסו|תקן|תקני|תתקן|תתקני|תתקנו|שפר|שפרי|תשפר|תשפרי|תשפרו|המר|המירי|תמיר|תמירי|תמירו|הפוך(?!.*וידאו)|עשה|עשי|תעשה|תעשי|תעשו|תן/i.test(prompt);
    
    // Implicit edit: If prompt describes a state/appearance without being a question
    // Examples: "לבוש בקימונו", "wearing a hat", "with glasses", "as a superhero"
    // Hebrew: לבוש ב, עם, כ (כברבי, כסופרמן), בתור
    // English: wearing, dressed, as a, with, in a
    // Note: Don't use \b after Hebrew words - it doesn't work in JavaScript
    const isImplicitEdit = /^(לבוש|לבושה|לובש|לובשת|עם|כ(?!מה)|בתור)|^\b(wearing|dressed|with\s+a|as\s+a|in\s+a)\b/i.test(prompt);
    
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
    
    // Third priority: Check if user wants image analysis/questions (text-only response)
    // Expanded to include more question patterns and info requests
    // Note: Don't use \b after Hebrew words - it doesn't work in JavaScript
    const isAnalysisRequest = /^(מה|איך|למה|האם|תאר|ספר|הסבר|זהה|בדוק|אמור|כמה|מתי|איפה|מי|אילו|האם.*זה|זה.*מה|יש.*ב|נמצא.*ב|רואים.*ב|מופיע.*ב|זיהוי|מסוכן|בטוח)|^\b(identify|explain|tell|is\s+(this|it|he|she|that)|are\s+(these|they|those)|does|can|could|would|should|what|how|why|when|where|who|which|describe|analyze|analysis|detect|recognize|find|show|list|count|safe|dangerous)\b/i.test(prompt);
    if (isAnalysisRequest) {
      // Note: needsChatHistory removed - agent handles history automatically
      // Check for Google Search request
      const needsGoogleSearch = /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|תן\s+לי\s+לינק|שלח\s+לינק|לינקים\s+ל|links?\s+to|give\s+me\s+links?|send\s+(me\s+)?links?/i.test(prompt);
      return { tool: 'gemini_chat', args: { prompt, useGoogleSearch: needsGoogleSearch }, reason: 'Image analysis/question' };
    }
    
    // Default: If no clear pattern detected, treat as analysis/question
    // This is safer than defaulting to edit
    // Note: needsChatHistory removed - agent handles history automatically
    // Check for Google Search request
    const needsGoogleSearchDefault = /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|תן\s+לי\s+לינק|שלח\s+לינק|לינקים\s+ל|links?\s+to|give\s+me\s+links?|send\s+(me\s+)?links?/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, useGoogleSearch: needsGoogleSearchDefault }, reason: 'Image-related request (default to analysis)' };
  }

  // If there is an attached video with text prompt → decide between video analysis vs video-to-video
  if (input.hasVideo && prompt) {
    // First priority: Check if user wants video analysis/questions (text-only response)
    // IMPORTANT: Check analysis BEFORE edit - questions like "האם גמד מעורב?" should be analysis, not edit
    // Same pattern as image analysis
    // Note: Don't use \b after Hebrew words - it doesn't work in JavaScript
    const isAnalysisRequest = /^(מה|איך|למה|האם|תאר|ספר|הסבר|זהה|בדוק|אמור|כמה|מתי|איפה|מי|אילו|האם.*זה|זה.*מה|יש.*ב|נמצא.*ב|רואים.*ב|מופיע.*ב|זיהוי|מסוכן|בטוח)|^\b(identify|explain|tell|is\s+(this|it|he|she|that)|are\s+(these|they|those)|does|can|could|would|should|what|how|why|when|where|who|which|describe|analyze|analysis|detect|recognize|find|show|list|count|safe|dangerous)\b/i.test(prompt);
    if (isAnalysisRequest) {
      // Note: needsChatHistory removed - agent handles history automatically
      // Check for Google Search request
      const needsGoogleSearch = /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|תן\s+לי\s+לינק|שלח\s+לינק|לינקים\s+ל|links?\s+to|give\s+me\s+links?|send\s+(me\s+)?links?/i.test(prompt);
      return { tool: 'gemini_chat', args: { prompt, useGoogleSearch: needsGoogleSearch }, reason: 'Video analysis/question' };
    }
    
    // Second priority: Video-to-video editing (requires authorization)
    // Edit keywords: add, remove, change, make, create, replace, etc.
    // Hebrew imperatives with ALL conjugations (male/female/plural): תוריד/תורידי/תורידו, מחק/מחקי/מחקו...
    const isEditRequest = /\b(add|remove|delete|change|replace|modify|edit|make|create|draw|paint|color|set|put|insert|erase|fix|adjust|enhance|improve|transform|convert)\b|הוסף|הוסיפ|תוסיפ|סיר|תסיר|הסר|תסירי|תסירו|מחק|מחקי|מחקו|תמחק|תמחקי|תמחקו|הורד|הורידי|הורידו|תוריד|תורידי|תורידו|שנה|שני|תשנה|תשני|תשנו|החלף|החליפ|תחליף|תחליפי|תחליפו|ערוך|ערכי|תערוך|תערכי|תערכו|צור|צרי|תצור|תצרי|תצרו|צייר|צירי|תצייר|תצירי|תצירו|צבע|צבעי|תצבע|תצבעי|תצבעו|הכנס|הכניס|תכניס|תכניסי|תכניסו|תקן|תקני|תתקן|תתקני|תתקנו|שפר|שפרי|תשפר|תשפרי|תשפרו|המר|המירי|תמיר|תמירי|תמירו|הפוך(?!.*וידאו)|עשה|עשי|תעשה|תעשי|תעשו|תן/i.test(prompt);
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
    // Note: needsChatHistory removed - agent handles history automatically
    // Check for Google Search request
    const needsGoogleSearchVideoDefault = /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|תן\s+לי\s+לינק|שלח\s+לינק|לינקים\s+ל|links?\s+to|give\s+me\s+links?|send\s+(me\s+)?links?/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, useGoogleSearch: needsGoogleSearchVideoDefault }, reason: 'Video-related request (default to analysis)' };
  }

  // If there is an attached audio/voice note with text prompt → decide between creative mix, voice response, or general request
  if (input.hasAudio && prompt) {
    console.log(`🎤 Audio routing - Prompt: "${prompt}"`);
    
    // First priority: Check if user wants creative audio mix
    // Note: Don't use \b for Hebrew words - it doesn't work in JavaScript
    const isCreativeMix = /\b(mix|remix|creative|effect)\b|ערבב|מיקס|יצירתי|אפקט|רמיקס/i.test(prompt);
    console.log(`   Creative Mix: ${isCreativeMix}`);
    
    if (isCreativeMix) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'creative_audio' }, reason: 'No media creation authorization' };
      }
      return { tool: 'creative_voice_processing', args: { prompt }, reason: 'Audio creative mix requested' };
    }
    
    // Second priority: Check if user wants voice cloning response
    // Must explicitly mention voice/קול (not just "ענה לזה" which is text response)
    // Note: Don't use \b for Hebrew words - it doesn't work in JavaScript
    const isVoiceResponse = /(ענה|תגיב|תגובה|השב|תשובה).*(קולי|בקול)|תגובה\s+קולית|מענה\s+קולי|השב.*בקול|ענה.*בקול|\b(reply|respond|response|answer|react)\b.*\bvoice\b|voice\s+response|voice\s+reply/i.test(prompt);
    console.log(`   Voice Response: ${isVoiceResponse}`);
    
    if (isVoiceResponse) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'voice_cloning' }, reason: 'No media creation authorization' };
      }
      return { tool: 'voice_cloning_response', args: { prompt }, reason: 'Voice cloning response requested' };
    }
    
    // Third priority: General requests (transcription, translation, etc.) - route to gemini_chat
    // These will need transcription first, then processing
    // Note: needsChatHistory removed - agent handles history automatically
    // Check for Google Search request
    const needsGoogleSearchAudio = /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|תן\s+לי\s+לינק|שלח\s+לינק|לינקים\s+ל|links?\s+to|give\s+me\s+links?|send\s+(me\s+)?links?/i.test(prompt);
    return { tool: 'gemini_chat', args: { prompt, needsTranscription: true, useGoogleSearch: needsGoogleSearchAudio }, reason: 'Audio with general request (transcribe + process)' };
  }

  // If there is an attached image WITHOUT prompt → ignore (no automatic analysis)
  if (input.hasImage && (!prompt || prompt.length < 3)) {
    return { tool: 'ask_clarification', args: {}, reason: 'Image attached without clear instruction' };
  }

  // If text prompt only (no attachments) → decide among chat / image / video generation
  // CRITICAL: This block should NEVER run if hasImage, hasVideo, or hasAudio is true
  if (prompt && !input.hasImage && !input.hasVideo && !input.hasAudio) {
    // Simple keyword-based heuristic to infer intent; replace later with LLM
    // Note: prompt already has # prefix removed by line 57
    // All checks are case-insensitive using /i flag
    // Using \b for word boundaries to match whole words only
    // Includes common typos for better UX
    
    // Image detection: Must have creation verbs OR be at start of prompt
    // ✅ "צור תמונה של", "תמונה של חתול", "picture of a cat", "draw a dog"
    // ❌ "בתמונה שלהלן", "in the picture", "מה יש בתמונה", "שלמעשה" (not a verb!)
    // Note: Using (^|\s) and (\s|$) for Hebrew word boundaries to avoid false matches like "שלמעשה"
    const hasImageCreationVerbs = /(^|\s)(צור|צרי|צרו|תצור|תצרי|תצרו|עשה|עשי|עשו|תעשה|תעשי|תעשו|צייר|ציירי|צוירו|תצייר|תצירי|תצירו|הכן|הכני|הכינו|תכין|תכיני|תכינו|יצור|תיצור|ייצר|תייצר|תן|תני|תנו|הראה|הראי|הראו|תראה|תראי|תראו)(\s|$)|\b(create|make|generate|draw|paint|design|render|produce|show\s+me)\b/i.test(prompt);
    const hasImageNounAtStart = /^(תמונה|תמונא|תמונת|ציור|צייור|תצלום|לוגו|איור|poster|illustration|picture|pic|photo|image|imge|imagee)/i.test(prompt);
    const hasImageOf = /(תמונה|תמונא|תמונת|ציור|צייור|picture|pic|image)\s+(של|שלי|שלך|שלו|שלה|שלנו|שלהם|שלהן|of|with)\s+/i.test(prompt);
    const isImageLike = hasImageCreationVerbs || hasImageNounAtStart || hasImageOf;
    
    // Video detection: Same logic as image - must have creation verbs OR be at start
    // ✅ "צור וידאו של", "וידאו של כלב", "video of a cat", "animate this"
    // ❌ "בווידאו הזה", "in the video", "מה יש בוידאו", "שלמעשה" (not a verb!)
    const hasVideoCreationVerbs = /(^|\s)(צור|צרי|צרו|תצור|תצרי|תצרו|עשה|עשי|עשו|תעשה|תעשי|תעשו|הכן|הכני|הכינו|תכין|תכיני|תכינו|יצור|תיצור|ייצר|תייצר|הנפש|הנפישי|הנפישו|תנפיש|תנפישי|תנפישו|הראה|הראי|הראו|תראה|תראי|תראו)(\s|$)|\b(create|make|generate|animate|produce|show\s+me)\b/i.test(prompt);
    const hasVideoNounAtStart = /^(וידאו|וידיאו|וודאו|ווידאו|וידיו|סרט|סרטון|אנימציה|קליפ|video|vidio|vedio|vidoe|clip|movie|film)/i.test(prompt);
    const hasVideoOf = /(וידאו|וידיאו|סרט|סרטון|video|clip|movie)\s+(של|שלי|שלך|שלו|שלה|שלנו|שלהם|שלהן|of|with|about)\s+/i.test(prompt);
    const isVideoLike = hasVideoCreationVerbs || hasVideoNounAtStart || hasVideoOf;
    // Note: Don't use \b after Hebrew words - it doesn't work in JavaScript
    // Support ALL Hebrew conjugations (male/female/plural) per rule 7
    
    // IMPORTANT: Check text-only translation BEFORE TTS
    // "# תרגם ל..." → text translation only (no voice)
    // "# אמור ב..." → translation + TTS voice
    const hasTranslateKeywords = /תרגם|תרגמי|תרגמו|תתרגם|תתרגמי|תתרגמו|תרגום|\b(translate|translation)\b/i.test(prompt);
    // Note: For Hebrew words that can be both verbs and nouns (like דבר), use stricter matching:
    // - ^word or \sword ensures the word is at start or after whitespace
    // - word$ or word\s ensures the word is at end or before whitespace
    const hasTTSKeywords = /אמור|אמרי|אמרו|תאמר|תאמרי|תאמרו|הקרא|הקראי|הקראו|תקרא|תקראי|תקראו|הקריא|הקריאי|הקריאו|תקריא|תקריאי|תקריאו|(^|\s)(דבר|דברי|דברו|תדבר|תדברי|תדברו)(\s|$)|בקול|קולית|\b(say|speak|tell|voice|read\s+aloud)\b/i.test(prompt);
    
    // Text-only translation: has translate keywords but NO TTS keywords
    const isTranslateOnly = hasTranslateKeywords && !hasTTSKeywords;
    
    // TTS includes: explicit TTS keywords OR read aloud requests
    // Note: Using stricter matching for Hebrew nouns that might be part of other words
    const isTtsLike = /\b(speech|speach|tts|read\s+this|read\s+aloud|say\s+this)\b|^(קרא|קראי|קראו|תקרא|תקראי|תקראו|הקרא|הקראי|הקראו|הקריא|הקריאי|הקריאו|הקראת)\b|(^|\s)(דיבור)(\s|$)|להשמיע|הפוך.*לדיבור|המר.*לדיבור|text\s*to\s*speech/i.test(prompt) || hasTTSKeywords;
    
    const isSummary = /\b(summary|summery|sumary|summarize|sum\s+up)\b|סכם|סיכום|לסכם|סכום|תמצת|תמצה|תמצה.*את|תמצת.*את|תמצה.*מה|תמצת.*מה/i.test(prompt);
    
    // Check if user wants a link (any link request should trigger Google Search)
    // Note: Don't use \b for Hebrew words (word boundaries don't work well with Hebrew in JavaScript)
    const isLinkRequest = /\b(link|links|url)\b|לינק|לינקים|קישור|קישורים/i.test(prompt);
    
    // Check for Google Search request (explicit search or link requests)
    // IMPORTANT: ANY link request should use Google Search to find real links
    // Hebrew: חפש באינטרנט, עשה חיפוש, תחפש ברשת, תן לי לינקים, שלח לינקים ל, לינק ל, מצא לי
    // English: search the web, search online, search google, give me links, send links to, link to, find me
    const needsGoogleSearch = isLinkRequest || /חפש\s+(באינטרנט|ברשת|בגוגל|בגוגל|ב-google)|עשה\s+חיפוש|תחפש\s+(באינטרנט|ברשת|בגוגל)|מצא\s+(לי\s+)?|תמצא\s+(לי\s+)?|search\s+(the\s+)?(web|internet|online|google)|google\s+(search|this)|find\s+(me\s+)?/i.test(prompt);
    
    // Check if user wants music generation (Suno) vs just text/lyrics
    // CRITICAL DISTINCTION:
    // 1. "כתוב שיר" = Gemini (text/lyrics only)
    // 2. "צור שיר" / "שיר עם מנגינה" = Suno (music with melody)
    
    // Check for "write" verbs (text only - Gemini)
    const isWriteSong = /כתוב.*שיר|כתבי.*שיר|כתבו.*שיר|תכתוב.*שיר|תכתבי.*שיר|תכתבו.*שיר|write.*song|compose.*lyrics/i.test(prompt);
    
    // Check for "create" verbs OR melody/tune keywords (music generation - Suno)
    const isMusicGeneration = !isLinkRequest && !isWriteSong && (
      /\b(suno|music\s+with|melody|tune)\b/i.test(prompt) ||
      /שיר.*עם.*(מנגינה|לחן|צליל|מוזיקה|מוסיקה|קול)|מנגינה|לחן|מוזיקה|מוסיקה.*עם|שירה.*עם.*לחן/i.test(prompt) ||
      /צור.*שיר|צרי.*שיר|צרו.*שיר|תצור.*שיר|תצרי.*שיר|תצרו.*שיר|יצור.*שיר|create.*song|generate.*song|make.*song/i.test(prompt)
    );
    
    // If just mentions "song" without specific verb - treat as lyrics (Gemini)
    const isSongLyrics = !isLinkRequest && !isMusicGeneration && /\b(song|musik)\b|שיר|שירה|זמר|זמרה|שירון|שיירון/i.test(prompt);
    
    const isHelp = /\b(commands|comands|list|help|capabilities)\b|פקודות|פיקודות|רשימת|רשימה|עזרה|אילו|מה\s+אפשר|what\s+can/i.test(prompt);
    const isCreateGroup = /צור.*קבוצה|צרי.*קבוצה|צרו.*קבוצה|תצור.*קבוצה|תצרי.*קבוצה|תצרו.*קבוצה|יצירת.*קבוצה|פתח.*קבוצה|פתחי.*קבוצה|פתחו.*קבוצה|תפתח.*קבוצה|תפתחי.*קבוצה|תפתחו.*קבוצה|פתיחת.*קבוצה|הקם.*קבוצה|הקימי.*קבוצה|הקימו.*קבוצה|תקים.*קבוצה|תקימי.*קבוצה|תקימו.*קבוצה|הקמת.*קבוצה|create.*group|creat.*group|new.*group|open.*group|start.*group|קבוצה.*חדשה/i.test(prompt);
    const isRetry = /^(נסה\s+שוב|נסא\s+שוב|שוב|עוד\s+פעם|שנית|retry|again|try\s+again|once\s+more)|^#\s*(נסה\s+שוב|נסא\s+שוב|שוב|עוד\s+פעם|שנית|retry|again|try\s+again|once\s+more)/i.test(prompt);
    const isPoll = /צור.*סקר|צרי.*סקר|צרו.*סקר|תצור.*סקר|תצרי.*סקר|תצרו.*סקר|יצירת.*סקר|סקר.*על|סקר.*בנושא|הכן.*סקר|הכני.*סקר|הכנו.*סקר|תכין.*סקר|תכיני.*סקר|תכינו.*סקר|create.*poll|creat.*poll|make.*poll|poll.*about|new.*poll/i.test(prompt);
    const isRandomLocation = /שלח\s+מיקום|שלחי\s+מיקום|שלחו\s+מיקום|תשלח\s+מיקום|תשלחי\s+מיקום|תשלחו\s+מיקום|מיקום\s+אקראי|מיקום\s+רנדומלי|location\s+random|random\s+location|send\s+location|send\s+random\s+location/i.test(prompt);
    
    // Debug: log intent detection
    console.log(`🔍 Intent Router - Prompt: "${prompt.substring(0, 100)}" | Image:${isImageLike} Video:${isVideoLike} WriteSong:${isWriteSong} MusicGen:${isMusicGeneration} Lyrics:${isSongLyrics} TranslateOnly:${isTranslateOnly} TTS:${isTtsLike} Retry:${isRetry} Poll:${isPoll} Location:${isRandomLocation} LinkReq:${isLinkRequest} GoogleSearch:${needsGoogleSearch}`);
    
    if (isRetry) {
      return { tool: 'retry_last_command', args: {}, reason: 'User requested retry' };
    }
    
    if (isPoll) {
      return { tool: 'create_poll', args: { prompt }, reason: 'User requested poll creation' };
    }
    
    if (isRandomLocation) {
      return { tool: 'send_random_location', args: {}, reason: 'User requested random location' };
    }
    
    if (isSummary) {
      return { tool: 'chat_summary', args: {}, reason: 'User requested summary' };
    }

    if (isHelp) {
      return { tool: 'show_help', args: {}, reason: 'User requested command list' };
    }

    // Check text-only translation BEFORE TTS (higher priority)
    if (isTranslateOnly) {
      return { tool: 'translate_text', args: { prompt }, reason: 'Text-only translation requested (no TTS)' };
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

    if (isMusicGeneration) {
      if (!input.authorizations?.media_creation) {
        return { tool: 'deny_unauthorized', args: { feature: 'music_generation' }, reason: 'No media creation authorization' };
      }
      return { tool: 'music_generation', args: { prompt }, reason: 'Music generation with melody/Suno' };
    }
    
    if (isSongLyrics) {
      // Just text/lyrics - route to Gemini chat
      return { tool: 'gemini_chat', args: { prompt, needsChatHistory: false, useGoogleSearch: false }, reason: 'Song lyrics/text request (not music generation)' };
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
      // Check for Sora 2 Pro first (more specific), then regular Sora 2
      const wantsSoraPro = /\bsora\s*2?\s*pro\b|סורה\s*2?\s*פרו|סורה\s*2?\s*pro/i.test(prompt);
      const wantsSora = /\bsora\s*2?\b|סורה\s*2?/i.test(prompt);
      
      if (wantsVeo3) {
        return { tool: 'veo3_video', args: { prompt }, reason: 'Video-like request, user requested Veo3' };
      }
      if (wantsSoraPro) {
        return { tool: 'sora_video', args: { prompt, model: 'sora-2-pro' }, reason: 'Video-like request, user requested Sora 2 Pro' };
      }
      if (wantsSora) {
        return { tool: 'sora_video', args: { prompt, model: 'sora-2' }, reason: 'Video-like request, user requested Sora 2' };
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
    // EXPANDED: Now detects implicit context needs like "what did I say?", "continuing from...", "as we discussed"
    // Hebrew patterns: לפי ההודעות, מה אמרתי, מה כתבתי, על מה דיברנו, במה עסקנו, בהמשך ל, כפי שאמרת, etc.
    // English patterns: based on messages, what did I say, what did we discuss, as we talked, continuing from, as you said, etc.
    const needsChatHistory = /לפי\s+(ה)?(הודעות|שיחה|צ'אט|קבוצה)|על\s+סמך\s+(ה)?(הודעות|שיחה)|בהתייחס\s+ל(הודעות|שיחה)|על\s+פי\s+(ה)?(הודעות|שיחה)|מ(ה)?(הודעות|שיחה)\s+(האחרונות|האחרונה|הקודמות|הקודמת)|הודעות\s+אחרונות|הודעות\s+קודמות|מה\s+(אמרתי|אמרת|כתבתי|כתבת|שלחתי|שלחת|דיברתי|דיברת)\s+(קודם|לפני|בהודעה|בשיחה)?|על\s+מה\s+(דיברנו|עסקנו|שוחחנו)|כפי\s+ש(אמרת|כתבת|ציינת)|כמו\s+ש(אמרת|כתבת)|בהמשך\s+ל|בהתאם\s+ל(שיחה|דיון)|ממה\s+שאמר|based\s+on\s+(the\s+)?(messages|chat|conversation)|according\s+to\s+(the\s+)?(messages|chat)|referring\s+to\s+(the\s+)?(messages|chat)|from\s+(the\s+)?(recent|previous|last)\s+(messages|chat)|recent\s+messages|previous\s+messages|what\s+(did\s+)?(I|we|you)\s+(say|said|write|wrote|mention|talk|discuss)|as\s+(I|we|you)\s+(said|mentioned|discussed)|continuing\s+(from|the)|as\s+we\s+(talked|discussed|mentioned)|like\s+(I|you)\s+said/i.test(prompt);
    
    if (wantsOpenAI) {
      return { tool: 'openai_chat', args: { prompt, needsChatHistory, useGoogleSearch: needsGoogleSearch }, reason: 'Chat request, user requested OpenAI' };
    }
    if (wantsGrok) {
      return { tool: 'grok_chat', args: { prompt, needsChatHistory, useGoogleSearch: needsGoogleSearch }, reason: 'Chat request, user requested Grok' };
    }
    if (wantsGemini) {
      return { tool: 'gemini_chat', args: { prompt, needsChatHistory, useGoogleSearch: needsGoogleSearch }, reason: 'Chat request, user requested Gemini' };
    }
    // Default to Gemini
    return { tool: 'gemini_chat', args: { prompt, needsChatHistory, useGoogleSearch: needsGoogleSearch }, reason: 'Default to chat' };
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
    'agent_query',  // 🤖 Autonomous agent for complex queries
    'gemini_image', 'openai_image', 'grok_image',
    'veo3_video', 'sora_video', 'kling_text_to_video', 'veo3_image_to_video', 'sora_image_to_video', 'kling_image_to_video', 'video_to_video',
    'image_edit', 'text_to_speech', 'gemini_chat', 'openai_chat', 'grok_chat',
    'chat_summary', 'music_generation', 'create_poll', 'send_random_location', 'creative_voice_processing', 'voice_cloning_response', 'show_help', 'create_group', 'retry_last_command', 'deny_unauthorized', 'ask_clarification'
  ]);
  if (!allowedTools.has(tool)) return null;
  return { tool, args, reason };
}

async function decideWithLLM(input, options = {}) {
  const prompt = buildRouterPrompt(input, options);
  // ⚙️ Configuration: Load from env or use defaults
  const routerModel = process.env.INTENT_ROUTER_MODEL || 'gemini-2.5-flash';
  const timeoutMs = Number(process.env.INTENT_ROUTER_LLM_TIMEOUT_MS || 2500);
  
  // Use a faster model and a timeout fallback to heuristic
  const llmPromise = geminiText(prompt, [], { model: routerModel });
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

function buildRouterPrompt(input, options = {}) {
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
  
  // Refinement detection (optimized)
  const refinementSection = options.checkRefinement ? `
REFINEMENT CHECK (Priority 1):
User expressing dissatisfaction/requesting improvement → "retry_last_command"
Patterns: "not good", "fix", "improve", "change", "but with X", "should be bigger"
NOT refinement: new requests ("create new image"), questions
` : '';
  
  return `Intent router for WhatsApp AI bot. Return JSON only.

RULES: Case-insensitive, space-flexible, whole words, accept typos.

INPUT:
${JSON.stringify(payload, null, 2)}
${refinementSection}
ROUTING LOGIC (in order):

0️⃣ AGENT (use for complex queries):
Use "agent_query" for:
• History refs: "what did I say", "show me images from chat"
• Multi-step: "create and analyze", "search then create"
• Conditional: "if fails use OpenAI"
• NOT for: single actions, basic questions

→ Complex? { "tool": "agent_query", "args": { "prompt": "<text>" }, "reason": "..." }
→ Simple? Continue ↓

1️⃣ hasImage=true:
A. Video keywords + service mention → [service]_image_to_video (veo3/sora/kling)
B. Questions ("what", "how", "is this") → "gemini_chat"
C. Edit verbs (all conjugations: remove/change/edit/create/draw/add) → "image_edit" (needs auth, check OpenAI/Gemini pref)
D. Default unclear → "gemini_chat"

2️⃣ hasVideo=true:
A. Questions ("what", "describe") → "gemini_chat"
B. Edit verbs → "video_to_video" (needs auth)
C. Default → "gemini_chat"

3️⃣ hasAudio=true:
A. Mix keywords ("mix", "remix", "creative") → "creative_voice_processing" (needs auth)
B. Voice response ("reply with voice", "ענה בקול") → "voice_cloning_response" (needs auth)
C. Default → "gemini_chat" (needsTranscription=true)

4️⃣ text only:
Music: "write song" → gemini_chat | "create song" or "suno" → music_generation
Image: creation verb + image noun → [provider]_image (openai/grok/gemini default), avoid false positives
Video: creation verb + video noun → [provider]_video (veo3/sora/kling default), avoid false positives
TTS: "read", "speech", "הקרא" → text_to_speech
Summary: "summary", "סיכום" → chat_summary
Retry: "again", "שוב" → retry_last_command
Poll: "create poll", "צור סקר" (all conjugations) → create_poll
Location: "send location", "מיקום אקראי" → send_random_location
Group: "create group", "צור קבוצה" (all conjugations, needs auth) → create_group
Help: "commands", "פקודות" → show_help


DEFAULT: No keywords → check provider (openai/grok/gemini default)
Auto-set needsChatHistory=true for history refs ("what did I say", "based on messages")
Auto-set useGoogleSearch=true for web search requests ("search web", "give me links")



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
gemini_chat, openai_chat, grok_chat, gemini_image, openai_image, grok_image, kling_text_to_video, veo3_video, kling_image_to_video, veo3_image_to_video, video_to_video, image_edit, text_to_speech, music_generation, chat_summary, create_poll, retry_last_command, creative_voice_processing, voice_cloning_response, deny_unauthorized, ask_clarification, show_help`;
}


