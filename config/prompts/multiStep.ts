/**
 * Multi-Step Planner Prompts
 * Instructions for analyzing and planning multi-step execution
 */

import { getPlannerTools, formatToolsCompact, getCriticalRules } from '../tools-list';

/**
 * Multi-step planner prompt - instructs Gemini to analyze and plan execution
 */
export function multiStepPlanner(userRequest: string): string {
  return `Analyze if this request needs multiple SEQUENTIAL steps.

REQUEST: "${userRequest}"

RULES:
• SINGLE-STEP = ONE action only
• MULTI-STEP = 2+ DIFFERENT actions that must be executed in sequence

CRITICAL - Media context:
• "[תמונה מצורפת]" prefix = User attached an image
• "[וידאו מצורף]" prefix = User attached a video
• "[אודיו מצורף]" prefix = User attached audio
• NEVER use analyze_image or analyze_video unless there is an attached image/video or an explicit image_url/video_url in the request.
• NEVER add analyze_image or analyze_video as an extra step after a different tool just to "think" – only when the user actually asked to analyze media and provided it.
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
- "צור קבוצה עם תמונה" / "create group with picture" → SINGLE create_group (tool handles image internally!)
- "שלח מוצר" / "find product" / "מתנה" / "gift idea" / "random product" → SINGLE random_amazon_product

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

Return COMPLETE JSON only. NO markdown. NO "...".`;
}

