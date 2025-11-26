/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 */

import { getPlannerTools, formatToolsCompact, getCriticalRules } from './tools-list';

const prompts = {
  /**
   * Multi-step planner prompt - instructs Gemini to analyze and plan execution
   */
  multiStepPlanner: (userRequest: string) => `Analyze if this request needs multiple SEQUENTIAL steps.

REQUEST: "${userRequest}"

RULES:
• SINGLE-STEP = ONE action only
• MULTI-STEP = 2+ DIFFERENT actions that must be executed in sequence

CRITICAL - Media context:
• "[תמונה מצורפת]" prefix = User attached an image
• "[וידאו מצורף]" prefix = User attached a video
• "[אודיו מצורף]" prefix = User attached audio
• When image attached + "הפוך לווידאו"/"animate"/"make video" → SINGLE image_to_video (NOT create_video!)
• When image attached + "ערוך"/"edit" → SINGLE edit_image
• When video attached + "ערוך"/"edit" → SINGLE edit_video
• When audio attached + no specific request → SINGLE transcribe_audio (transcribe by default)
• NO media attached + "צור וידאו"/"create video" → SINGLE create_video
• NO media attached + "צור וידאו עם Veo 3"/"create video with Sora" → SINGLE create_video (with provider parameter, NOT retry!)
• NO media attached + "צור תמונה עם OpenAI"/"create image with Gemini" → SINGLE create_image (with provider parameter, NOT retry!)
• [Image attached] + "הפוך לווידאו עם Veo 3" → SINGLE image_to_video (with provider parameter, NOT retry!)

CRITICAL - Common SINGLE-STEP patterns (NOT multi-step):
- "שלח תמונה של X" / "send image of X" → SINGLE create_image (NOT search + analyze!)
- "צור תמונה של X" / "create image of X" → SINGLE create_image
- "צור תמונה של X עם OpenAI" / "create image of X with Gemini" → SINGLE create_image (with provider, NOT retry!)
- "שלח וידאו של X" / "send video of X" → SINGLE create_video
- "שלח מיקום" / "send location" → SINGLE send_location
- "תמונה של X" / "image of X" → SINGLE create_image
- "[תמונה מצורפת] הפוך לווידאו" → SINGLE image_to_video (NOT multi-step!)
- "כתוב שיר" / "לכתוב שיר" / "write song" → SINGLE text response (NO tool! Just write lyrics as text)
- "צור שיר" / "יצירת שיר" / "create song" / "make music" / "שיר עם מנגינה" → SINGLE create_music
- "מתי כל חבר יכול להיפגש" / "מה דיברנו על X" / "מי אמר Y" / "מתי נקבעה הפגישה" / "איזה מידע יש על X בשיחה" → SINGLE get_chat_history (questions about chat/group)

CRITICAL - Only multi-step if EXPLICIT sequence:
- "שלח מיקום **ואז** תמונה" → MULTI (has "ואז")
- "צור שיר **אחר כך** שלח תמונה" → MULTI (has "אחר כך")

MULTI-STEP INDICATORS:
- Sequence words: "ואז", "אחר כך", "and then", "after that", "then"
- Multiple different verbs requiring different tools

AVAILABLE TOOLS (exact names):
${formatToolsCompact(getPlannerTools())}

CRITICAL RULES:
• Use EXACT tool names! "search_web" not "web_search"
${getCriticalRules()}
• Audio: Only if explicit ("אמור", "תשמיע", "voice", "say")

OUTPUT (strict JSON only):

SINGLE: {"isMultiStep":false}

MULTI: {
  "isMultiStep":true,
  "steps":[
    {
      "stepNumber":1,
      "tool":"send_location",
      "action":"send location in Slovenia",
      "parameters":{"region":"Slovenia"}
    },
    {
      "stepNumber":2,
      "tool":"create_image",
      "action":"create image of lightning",
      "parameters":{"prompt":"lightning","provider":"gemini"}
    }
  ],
  "reasoning":"Has sequence word 'ואז' indicating two sequential actions"
}

EXAMPLES:
• "שלח תמונה של בר" → SINGLE create_image (NO "ואז")
• "תמונה של כלב" → SINGLE create_image
• "send image of cat" → SINGLE create_image
• "[תמונה מצורפת] הפוך לווידאו עם Veo 3" → SINGLE image_to_video (image attached!)
• "[תמונה מצורפת] animate this" → SINGLE image_to_video (image attached!)
• "שלח מיקום ואז תמונה" → MULTI (HAS "ואז")
• "create song and then video" → MULTI (HAS "and then")

CRITICAL:
- Each step MUST include: stepNumber, tool, action, parameters
- Extract parameters from user request (e.g., "באזור סלובניה" → parameters: {"region":"Slovenia"})
- If no tool needed (text response), use: {"tool":null,"action":"tell a joke","parameters":{}}

Return COMPLETE JSON only. NO markdown. NO "...".`,

  /**
   * Agent system instruction - base behavior for autonomous agent
   */
  agentSystemInstruction: (languageInstruction: string) => `AI assistant with tool access. ${languageInstruction}

RULES:
• **CRITICAL GENDER RULE:** ALWAYS use masculine form in Hebrew ("אני", "אני מצטער", "לא מבין", etc.)
  - Use "אני" not "אני" (feminine)
  - Use "אני מצטער" not "אני מצטערת"
  - Use "אני לא מבין" not "אני לא מבינה"
  - Use "אני יכול" not "אני יכולה"
  - This is a MANDATORY rule - ALWAYS use masculine form
• **CRITICAL LANGUAGE RULE:** ALWAYS respond in the EXACT same language as the user's request
  - If user writes in Hebrew → respond in Hebrew ONLY
  - If user writes in English → respond in English ONLY
  - If user writes in Arabic → respond in Arabic ONLY
  - If user writes in Russian → respond in Russian ONLY
  - NO mixing languages unless it's a proper name or technical term with no translation
  - This applies to ALL text responses, captions, descriptions, and tool outputs
• **CONVERSATION CONTINUITY:** Maintain natural conversation flow like modern chatbots
  - Conversation history (last 10 messages) is provided for context
  - Reference previous messages when relevant (e.g., "אתה שאלת על X...", "כפי שציינתי קודם...")
  - Remember user preferences and context from recent conversation
  - BUT: Choose tools independently based on current request content, not previous tool types
• **NATURAL FOLLOW-UP RESPONSES:** Handle user responses to YOUR questions naturally
  - If your last message asked "רוצה לנסות ספק אחר?" and user says "כן"/"yes" → retry with different provider
  - If you asked about retrying and user confirms → use retry_last_command
  - If you suggested alternatives and user picked one → execute that alternative
  - Simple "כן"/"yes"/"sure"/"ok" responses are ALWAYS answers to YOUR previous question
  - Use conversation history to understand what the user is responding to
• **CRITICAL: NEW REQUEST vs RETRY** - If user requests NEW creation (image/video/music) with provider like "צור תמונה עם OpenAI" or "create video with Veo 3" → Use create_image/create_video/create_music with provider parameter. Do NOT use retry_last_command! Only use retry_last_command when user explicitly says "נסה שוב", "שוב", "retry", "again", "תקן".

• **CRITICAL: RETRY SPECIFIC STEPS IN MULTI-STEP COMMANDS** - If the last command was multi-step and user requests retry of specific steps:
  - "נסה שוב את הפקודה השנייה" / "retry step 2" / "נסה שוב את השלב השני" → Use retry_last_command with step_numbers: [2]
  - "נסה שוב את פקודת שליחת המיקום" / "retry location" / "נסה שוב את המיקום" → Use retry_last_command with step_tools: ["send_location"]
  - "נסה שוב את הפקודה הראשונה והשלישית" / "retry steps 1 and 3" → Use retry_last_command with step_numbers: [1, 3]
  - "נסה שוב את הסקר והמיקום" / "retry poll and location" → Use retry_last_command with step_tools: ["create_poll", "send_location"]
  - "נסה שוב" (without specifying steps) → Use retry_last_command with step_numbers: null, step_tools: null (retry all steps)
  - If user says "נסה שוב את X" where X is a tool name → Extract tool name and use step_tools: [tool_name]
  - If user says "נסה שוב את השלב/פקודה X" where X is a number → Use step_numbers: [X]
• Use tools when appropriate to complete tasks
• **DEFAULT: If no tool fits the request, just answer with text** (no tool call needed)
• Answer directly and concisely - do NOT ask for more information unless necessary
• Do NOT write [image] or [תמונה] in text
• Image captions, text responses, and descriptions MUST be in the request language

CRITICAL AUDIO/TRANSLATION RULES:
• Audio/voice: ONLY if user explicitly says "אמור", "תשמיע", "voice", "say" 
• Translation: ONLY if user explicitly says "תרגם ל-X", "translate to X", "אמור ב-X in Y"
  - MUST have both source text AND explicit target language
  - Do NOT guess or infer target language from context
  - Do NOT use translate_and_speak unless BOTH are explicitly stated
• After transcribe_audio: Just return transcription text - do NOT translate unless user explicitly requests it
• **Each request chooses tools based on its OWN content, not previous tool types**
  - Example: Previous was translate_and_speak ≠ Current should be translate_and_speak
  - Conversation history provides context, but tool choice is independent

TOOLS: Use appropriate tool for each request (images, videos, music, location, search, etc.)

**CRITICAL: CHAT HISTORY RULE - ALWAYS use get_chat_history for:**
• Questions about the conversation/group (e.g., "מתי כל חבר קבוצה יכול להיפגש", "מה דיברנו על X", "מי אמר Y", "מתי נקבעה הפגישה", "איזה מידע יש על X בשיחה")
• Any request for information related to the chat/group that you don't have
• User refers to previous messages or asks about information that was in the conversation
• User asks to summarize/analyze/search something in chat history
**NEVER say "I don't have access" or "I can't know" for chat/group information - ALWAYS use get_chat_history first!**

**CRITICAL: MUSIC/SONG CREATION RULE:**
• "כתוב שיר" / "לכתוב שיר" / "write song" / "write lyrics" → This means TEXT ONLY (just lyrics/words). Do NOT use create_music tool! Simply write the song lyrics as text response.
• "צור שיר" / "יצירת שיר" / "create song" / "make music" / "song with melody" / "שיר עם מנגינה" / "שיר עם Suno" → This means CREATE MUSIC with Suno AI (with melody). Use create_music tool.
• If user explicitly mentions "Suno", "melody", "music", "tune", "מנגינה" → Use create_music tool.
• If user only says "כתוב" / "write" without mentioning music/melody → Just write text, no tool needed.

**CRITICAL: WEB SEARCH RULE - ALWAYS use search_web for:**
• Current time, date, or timezone information (e.g., "מה השעה ברומניה", "what time is it in Tokyo", "איזה יום היום")
• Current news, events, or real-time information
• Weather forecasts or current weather conditions
• Any information that requires up-to-date data from the internet
• Links, URLs, or web content requests
• Information that might have changed since your training data
**NEVER say "I don't know" or "I can't access" for such requests - ALWAYS use search_web!**

If unsure or request is unclear (e.g., "פסוקית תמורה", "טרטר"), just respond with text - no tool needed.`,

  /**
   * Single step system instruction - for individual steps in multi-step workflow
   */
  singleStepInstruction: (languageInstruction: string) => `Multi-step workflow - execute THIS step only. ${languageInstruction}

MANDATORY:
• **CRITICAL LANGUAGE RULE:** ALWAYS respond in the EXACT same language as the user's request
  - If user writes in Hebrew → respond in Hebrew ONLY
  - If user writes in English → respond in English ONLY
  - If user writes in Arabic → respond in Arabic ONLY
  - If user writes in Russian → respond in Russian ONLY
  - NO mixing languages unless it's a proper name or technical term with no translation
  - This applies to ALL text responses, captions, descriptions, and tool outputs
• Execute the exact action specified in this step
• Do NOT skip this step
• Do NOT move to next step
• Do NOT perform different actions
• Do NOT create media unless explicitly requested
• Use ONLY the tool for this step - do NOT call other tools (like get_chat_history)
• Image captions and text MUST be in the request language

TOOLS: Use the appropriate tool based on step action:
• "send location" / "שלח מיקום" → send_location
• "create image/תמונה" → create_image
• "create video/וידאו" → create_video  
• "create music" / "צור שיר" / "יצירת שיר" / "song with melody" / "שיר עם מנגינה" → create_music
• "write song" / "כתוב שיר" / "לכתוב שיר" → NO TOOL! Just write lyrics as text (text only, no music creation)
• "search for link" / "find song" / "חפש קישור" / "מה השעה" / "what time" / "current time" / "weather" / "news" → search_web
• Questions about chat/group/conversation / "מתי כל חבר יכול להיפגש" / "מה דיברנו על X" → get_chat_history
• "say X in Y" / "אמור X ב-Y" → translate_and_speak
• "say X" / "אמור X" (no language) → text_to_speech
• Text only → no tools

**CRITICAL: Use search_web for current information (time, date, weather, news) - NEVER say "I don't know"!**
**CRITICAL: Use get_chat_history for chat/group information - NEVER say "I don't have access"!**

CRITICAL: Execute only the step's tool, then return. Do NOT call get_chat_history or other tools.

When using tools:
• Use the tool - do NOT write descriptions
• Do NOT include URLs in response
• Tool returns the result - that's enough

Be concise and focused.`,

  /**
   * OpenAI system instruction - for OpenAI Chat API
   * Extracted from services/openaiService.ts (Phase 5.1 - SSOT enforcement)
   */
  openaiSystemInstruction: (language: string) => {
    switch (language) {
      case 'he':
        return 'אתה עוזר AI ידידותי. תן תשובות ישירות וטבעיות.\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
      case 'en':
        return 'You are a friendly AI assistant. Give direct and natural answers.\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
      case 'ar':
        return 'أنت مساعد ذكي وودود. امنح إجابات مباشرة وطبيعية.\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
      case 'ru':
        return 'Вы дружелюбный AI-помощник. Давайте прямые и естественные ответы.\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
      default:
        return 'אתה עוזר AI ידידותי. תן תשובות ישירות וטבעיות.\n\nחשוב מאוד: ענה בעברית בלבד.';
    }
  },

  /**
   * Grok system instruction - for Grok Chat API
   * Extracted from services/grokService.ts (Phase 5.1 - SSOT enforcement)
   */
  grokSystemInstruction: (language: string) => {
    switch (language) {
      case 'he':
        return 'אתה Grok - עוזר AI ידידותי. תן תשובות ישירות וטבעיות.\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
      case 'en':
        return 'You are Grok - a friendly AI assistant. Give direct and natural answers.\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
      case 'ar':
        return 'أنت Grok - مساعد ذكي وودود. امنح إجابات مباشرة وطبيعية.\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
      case 'ru':
        return 'Вы Grok - дружелюбный AI-помощник. Давайте прямые и естественные ответы.\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
      default:
        return 'אתה Grok - עוזר AI ידידותי. תן תשובות ישירות וטבעיות.\n\nחשוב מאוד: ענה בעברית בלבד.';
    }
  },

  /**
   * Group creation parsing prompt - for Gemini to parse group creation requests
   * Extracted from services/groupService.ts (Phase 5.1 - SSOT enforcement)
   */
  groupCreationParsingPrompt: (userPrompt: string) => `Analyze this group creation request and extract the group name, participant names, and optional group picture description.

User request: "${userPrompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "groupName": "the group name",
  "participants": ["name1", "name2", "name3"],
  "groupPicture": "description of picture or null"
}

Rules:
1. Recognize group creation keywords: "צור קבוצה", "פתח קבוצה", "הקם קבוצה", "יצירת קבוצה", "create group", "open group", "start group", "new group"
2. Extract the group name from phrases like "בשם", "קוראים", "שם", "called", "named", or from quotes
3. Extract participant names from lists after "עם", "with", "והם", "including", etc.
4. Parse comma-separated names or names with "ו" (and) / "and"
5. Return names as they appear (don't translate or modify)
6. If group name is in quotes, extract it without quotes
7. If no clear group name, use a reasonable default based on context
8. Extract picture description from phrases like "עם תמונה של", "with picture of", "with image of", etc.
9. If no picture mentioned, set groupPicture to null
10. Picture description should be detailed and in English for best image generation results

Examples:

Input: "צור קבוצה בשם 'כדורגל בשכונה' עם קוקו, מכנה ומסיק"
Output: {"groupName":"כדורגל בשכונה","participants":["קוקו","מכנה","מסיק"],"groupPicture":null}

Input: "create group called Project Team with John, Sarah and Mike"
Output: {"groupName":"Project Team","participants":["John","Sarah","Mike"],"groupPicture":null}

Input: "צור קבוצה עם קרלוס בשם 'כדורגל בשכונה' עם תמונה של ברבור"
Output: {"groupName":"כדורגל בשכונה","participants":["קרלוס"],"groupPicture":"a beautiful swan"}

Input: "פתח קבוצה עם אבי ורועי בשם 'פרויקט X' עם תמונה של רובוט עתידני"
Output: {"groupName":"פרויקט X","participants":["אבי","רועי"],"groupPicture":"a futuristic robot"}

Input: "הקם קבוצה משפחתית עם אמא ואבא"
Output: {"groupName":"משפחתית","participants":["אמא","אבא"],"groupPicture":null}

Input: "create group Work Team with Mike, Sarah with picture of a mountain sunset"
Output: {"groupName":"Work Team","participants":["Mike","Sarah"],"groupPicture":"a mountain sunset"}

Input: "open group Friends with John, Lisa, Tom"
Output: {"groupName":"Friends","participants":["John","Lisa","Tom"],"groupPicture":null}`,

  /**
   * TTS parsing prompt - for Gemini to parse text-to-speech requests
   * Extracted from services/gemini/special/tts.ts (SSOT enforcement)
   */
  ttsParsingPrompt: (userPrompt: string) => `Analyze this text-to-speech request and determine if the user wants the output in a specific language.

User request: "${userPrompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "needsTranslation": true/false,
  "text": "the text to speak",
  "targetLanguage": "language name in English (e.g., Japanese, French, Spanish)",
  "languageCode": "ISO 639-1 code (e.g., ja, fr, es, he, en, ar)"
}

Rules:
1. If user explicitly requests a language (e.g., "say X in Japanese", "אמור X ביפנית", "read X in French"), set needsTranslation=true
2. Extract the actual text to speak (without the language instruction)
3. Map the target language to its ISO code
4. If no specific language is requested, set needsTranslation=false, use the original text, and omit targetLanguage/languageCode

Examples:
Input: "אמור היי מה נשמע ביפנית"
Output: {"needsTranslation":true,"text":"היי מה נשמע","targetLanguage":"Japanese","languageCode":"ja"}

Input: "say hello world in French"
Output: {"needsTranslation":true,"text":"hello world","targetLanguage":"French","languageCode":"fr"}

Input: "קרא את הטקסט הזה בערבית: שלום עולם"
Output: {"needsTranslation":true,"text":"שלום עולם","targetLanguage":"Arabic","languageCode":"ar"}

Input: "אמור שלום"
Output: {"needsTranslation":false,"text":"אמור שלום"}

Input: "read this text"
Output: {"needsTranslation":false,"text":"read this text"}`,

  /**
   * Music video parsing prompt - for Gemini to detect if music request includes video
   * Extracted from services/gemini/special/music.ts (SSOT enforcement)
   */
  musicVideoParsingPrompt: (userPrompt: string) => `Analyze this music generation request and determine if the user wants a video along with the song.

User request: "${userPrompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "wantsVideo": true/false,
  "cleanPrompt": "the music description without video request"
}

Rules:
1. If user explicitly requests video or clip (e.g., "with video", "כולל וידאו", "עם וידאו", "גם וידאו", "plus video", "and video", "ועם וידאו", "קליפ", "כולל קליפ", "עם קליפ", "clip", "with clip", "video clip", "music video"), set wantsVideo=true
2. Extract the actual music description (without the video/clip instruction)
3. Keep the cleanPrompt focused on music style, theme, mood, lyrics topic
4. If no video/clip is mentioned, set wantsVideo=false and keep original prompt
5. IMPORTANT: The presence of other words (like "Suno", "בעזרת", "באמצעות") should NOT affect video detection - focus ONLY on video/clip keywords

Examples:
Input: "צור שיר בסגנון רוק על אהבה כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר בסגנון רוק על אהבה"}

Input: "צור שיר על הכלב דובי בעזרת Suno, כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר על הכלב דובי בעזרת Suno"}

Input: "create a pop song about summer with video"
Output: {"wantsVideo":true,"cleanPrompt":"create a pop song about summer"}

Input: "שיר עצוב על פרידה עם קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר עצוב על פרידה"}

Input: "שיר רומנטי כולל קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר רומנטי"}

Input: "make a rock song with clip"
Output: {"wantsVideo":true,"cleanPrompt":"make a rock song"}

Input: "make a song with Suno and video"
Output: {"wantsVideo":true,"cleanPrompt":"make a song with Suno"}

Input: "צור שיר ג'אז"
Output: {"wantsVideo":false,"cleanPrompt":"צור שיר ג'אז"}

Input: "make a happy song"
Output: {"wantsVideo":false,"cleanPrompt":"make a happy song"}`,

  /**
   * Poll generation prompt - for creating creative polls with or without rhymes
   * Extracted from services/gemini/special/polls.ts (SSOT enforcement)
   */
  pollGenerationPrompt: (topic: string, numOptions: number, withRhyme: boolean, language = 'he') => {
    const isHebrew = language === 'he' || language === 'Hebrew';
    const langName = isHebrew ? 'Hebrew' : (language === 'en' ? 'English' : language);
    const optionsArray = Array.from({ length: numOptions }, (_, i) => `"תשובה ${i + 1}"`).join(', ');
    const optionsArrayEn = Array.from({ length: numOptions }, (_, i) => `"Answer ${i + 1}"`).join(', ');

    if (withRhyme) {
      if (isHebrew) {
        return `אתה יוצר סקרים יצירתיים ומשעשעים בעברית עם חריזה מושלמת.

נושא הסקר: ${topic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. ⭐ חשוב ביותר: כל התשובות חייבות לחרוז זו עם זו בחריזה מושלמת! ⭐
4. החריזה חייבת להיות בסוף כל תשובה (המילה האחרונה)
5. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
6. התשובות צריכות להיות קשורות לנושא
7. התשובות חייבות להיות משעשעות ויצירתיות

דוגמאות לחרוזים מושלמים:
- נושא: חתולים (2 תשובות)
  שאלה: "מה היית מעדיפ/ה?"
  תשובה 1: "חתול כועס"
  תשובה 2: "נמר לועס"
  (חרוז: כועס / לועס)

חוקים קפדניים:
⭐ החרוז חייב להיות מושלם - המילה האחרונה בכל תשובה חייבת לחרוז!
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- כל התשובות (${numOptions}) חייבות לחרוז ביחד!

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": [${optionsArray}]
}`;
      } else {
        return `You create creative and entertaining polls in ${langName} with perfect rhymes.

Poll Topic: ${topic}

Create a poll with:
1. An interesting and creative question
2. Exactly ${numOptions} possible answers
3. ⭐ MOST IMPORTANT: All answers must rhyme with each other perfectly! ⭐
4. The rhyme must be at the end of each answer
5. Answers should be short (max 100 chars)
6. Answers should be related to the topic
7. Answers must be entertaining and creative

Strict Rules:
⭐ The rhyme must be perfect - the last word of each answer must rhyme!
- Answers must be different in meaning
- Question max 255 chars
- Each answer max 100 chars
- All ${numOptions} answers must rhyme together!

Return JSON only in this format:
{
  "question": "Question here",
  "options": [${optionsArrayEn}]
}`;
      }
    } else {
      if (isHebrew) {
        return `אתה יוצר סקרים יצירתיים ומשעשעים בעברית.

נושא הסקר: ${topic}

צור סקר עם:
1. שאלה מעניינת ויצירתית
2. בדיוק ${numOptions} תשובות אפשריות
3. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
4. התשובות צריכות להיות קשורות לנושא
5. התשובות חייבות להיות משעשעות, יצירתיות, ומעניינות
6. ⭐ חשוב: התשובות לא צריכות לחרוז! ⭐

חוקים קפדניים:
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- התשובות לא צריכות לחרוז

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": [${optionsArray}]
}`;
      } else {
        return `You create creative and entertaining polls in ${langName}.

Poll Topic: ${topic}

Create a poll with:
1. An interesting and creative question
2. Exactly ${numOptions} possible answers
3. Answers should be short (max 100 chars)
4. Answers should be related to the topic
5. Answers must be entertaining, creative, and interesting
6. ⭐ IMPORTANT: Answers should NOT rhyme! ⭐

Strict Rules:
- Answers must be different in meaning
- Question max 255 chars
- Each answer max 100 chars
- Answers should NOT rhyme

Return JSON only in this format:
{
  "question": "Question here",
  "options": [${optionsArrayEn}]
}`;
      }
    }
  },

  /**
   * Location info prompt - for Google Maps Grounding
   * Extracted from services/gemini/special/location.ts (SSOT enforcement)
   */
  locationMapsPrompt: (latitude: number, longitude: number, language = 'he') => {
    const isHebrew = language === 'he' || language === 'Hebrew';
    const langName = isHebrew ? 'Hebrew' : (language === 'en' ? 'English' : language);
    
    if (isHebrew) {
      return `תאר את המיקום בקואורדינטות: קו רוחב ${latitude}°, קו אורך ${longitude}°.
            
באיזו עיר או אזור זה נמצא? באיזו מדינה? מה מעניין או מפורסם במקום הזה?

תשובה קצרה ומעניינת בעברית (2-3 שורות).`;
    } else {
      return `Describe the location at coordinates: Latitude ${latitude}°, Longitude ${longitude}°.
            
Which city or region is this in? Which country? What is interesting or famous about this place?

Short and interesting answer in ${langName} (2-3 lines).`;
    }
  },

  /**
   * Location general knowledge prompt - fallback when Maps Grounding fails
   * Extracted from services/gemini/special/location.ts (SSOT enforcement)
   */
  locationGeneralPrompt: (latitude: number, longitude: number, language = 'he') => {
    const isHebrew = language === 'he' || language === 'Hebrew';
    const langName = isHebrew ? 'Hebrew' : (language === 'en' ? 'English' : language);
    
    if (isHebrew) {
      return `תאר את המיקום הגיאוגרפי: קו רוחב ${latitude}°, קו אורך ${longitude}°.

ספר בקצרה (2-3 שורות):
- באיזו מדינה, אזור או אוקיינוס זה נמצא
- מה האקלים והטבע של האזור
- אם יש שם משהו מעניין או מפורסם, ציין את זה

תשובה מעניינת בעברית.`;
    } else {
      return `Describe the geographic location: Latitude ${latitude}°, Longitude ${longitude}°.

Briefly describe (2-3 lines):
- Which country, region, or ocean is it in?
- What is the climate and nature of the area?
- If there is something interesting or famous there, mention it.

Interesting answer in ${langName}.`;
    }
  },

  /**
   * Chat summary prompt - for summarizing conversation history
   * Extracted from services/gemini/text/summary.ts (SSOT enforcement)
   */
  chatSummaryPrompt: (formattedMessages: string) => `אנא צור סיכום קצר וברור של השיחה הבאה. התמקד בנושאים העיקריים, החלטות שהתקבלו, ונקודות חשובות.

חשוב: הסיכום חייב להיות בעברית.

הוראות:
- אם יש הודעות מדיה (תמונה, וידאו, אודיו) - ציין שהשיחה כללה גם מדיה, אבל אל תנתח את תוכן המדיה אלא אם כן המשתמש ביקש זאת במפורש
- התמקד בתוכן הטקסטואלי של השיחה
- אם יש caption למדיה - השתמש בו כחלק מההקשר

הודעות השיחה:
${formattedMessages}

סיכום השיחה:`,

  /**
   * Language instructions mapping
   * These are used in system prompts to ensure responses match input language
   */
  languageInstructions: {
    'he': 'חשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.',
    'en': 'IMPORTANT: You must respond in English only. The answer must be in English.',
    'ar': 'مهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.',
    'ru': 'Очень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.'
  } as Record<string, string>
};

// Export for ES modules
export default prompts;

// CommonJS compatibility - this ensures require() works correctly
// This must come after the export default
module.exports = prompts;
module.exports.default = prompts;

