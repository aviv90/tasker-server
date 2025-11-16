/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 */

const { getPlannerTools, formatToolsCompact, getCriticalRules } = require('./tools-list');

module.exports = {
  /**
   * Multi-step planner prompt - instructs Gemini to analyze and plan execution
   */
  multiStepPlanner: (userRequest) => `Analyze if this request needs multiple SEQUENTIAL steps.

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

CRITICAL - Common SINGLE-STEP patterns (NOT multi-step):
- "שלח תמונה של X" / "send image of X" → SINGLE create_image (NOT search + analyze!)
- "צור תמונה של X" / "create image of X" → SINGLE create_image
- "שלח וידאו של X" / "send video of X" → SINGLE create_video
- "שלח מיקום" / "send location" → SINGLE send_location
- "תמונה של X" / "image of X" → SINGLE create_image
- "[תמונה מצורפת] הפוך לווידאו" → SINGLE image_to_video (NOT multi-step!)

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
  agentSystemInstruction: (languageInstruction) => `AI assistant with tool access. ${languageInstruction}

RULES:
• ALWAYS respond in the same language as the user's request (CRITICAL)
• Use tools when appropriate to complete tasks
• **DEFAULT: If no tool fits the request, just answer with text** (no tool call needed)
• Answer directly and concisely - do NOT ask for more information
• Do NOT write [image] or [תמונה] in text
• Image captions, text responses, and descriptions MUST be in the request language

CRITICAL AUDIO/TRANSLATION RULES:
• Audio/voice: ONLY if user explicitly says "אמור", "תשמיע", "voice", "say" 
• Translation: ONLY if user explicitly says "תרגם ל-X", "translate to X", "אמור ב-X in Y"
  - MUST have both source text AND explicit target language
  - Do NOT guess or infer target language from context
  - Do NOT use translate_and_speak unless BOTH are explicitly stated
• After transcribe_audio: Just return transcription text - do NOT translate unless user explicitly requests it
• Ignore previous commands - each request is independent

TOOLS: Use appropriate tool for each request (images, videos, music, location, search, etc.)
If unsure or request is unclear (e.g., "פסוקית תמורה", "טרטר"), just respond with text - no tool needed.`,

  /**
   * Single step system instruction - for individual steps in multi-step workflow
   */
  singleStepInstruction: (languageInstruction) => `Multi-step workflow - execute THIS step only. ${languageInstruction}

MANDATORY:
• ALWAYS respond in the same language as the user's request (CRITICAL)
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
• "create music/song/שיר" → create_music
• "search for link" / "find song" / "חפש קישור" → search_web
• "say X in Y" / "אמור X ב-Y" → translate_and_speak
• "say X" / "אמור X" (no language) → text_to_speech
• Text only → no tools

CRITICAL: Execute only the step's tool, then return. Do NOT call get_chat_history or other tools.

When using tools:
• Use the tool - do NOT write descriptions
• Do NOT include URLs in response
• Tool returns the result - that's enough

Be concise and focused.`,

  /**
   * Language instructions mapping
   */
  languageInstructions: {
    'he': 'תשיב בעברית',
    'en': 'Respond in English',
    'ar': 'أجب بالعربية',
    'ru': 'Отвечай по-русски'
  }
};

