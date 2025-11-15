/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 */

module.exports = {
  /**
   * Multi-step planner prompt - instructs Gemini to analyze and plan execution
   */
  multiStepPlanner: (userRequest) => `Analyze if this request needs multiple SEQUENTIAL steps.

REQUEST: "${userRequest}"

RULES:
• SINGLE-STEP = ONE action only
• MULTI-STEP = 2+ DIFFERENT actions that must be executed in sequence

MULTI-STEP INDICATORS:
- Sequence words: "ואז", "אחר כך", "and then", "after that", "then"
- Multiple different verbs requiring different tools

AVAILABLE TOOLS:
• send_location - Send location (region: optional)
• create_image - Create image (prompt: required, provider: optional)
• create_video - Create video (prompt: required, provider: optional)
• text_to_speech - Text to speech (text: required, voice: optional)
• create_poll - Create poll (topic: required, numOptions: optional)
• web_search - Web search (query: required)
• translate_text - Translate text (text: required, target_language: required)

AUDIO/VOICE:
- Only include if user explicitly requests: "אמור", "תשמיע", "voice", "say", "קרא בקול"

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
  "reasoning":"two sequential actions"
}

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
• Use tools to complete tasks - do NOT ask for more information
• Answer directly and concisely
• Do NOT write [image] or [תמונה] in text
• Audio/voice: ONLY if user explicitly requests it ("אמור", "תשמיע", "voice", "say")
• Image captions, text responses, and descriptions MUST be in the request language

TOOLS: Use appropriate tool for each request (images, videos, music, location, search, etc.)`,

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
• "send location" / "שלח מיקום" → send_location (region optional - include only if specific location requested)
• "create image" / "צור תמונה" → create_image
• "create video" / "צור וידאו" → create_video
• Text requests → respond with text (no tools)

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

