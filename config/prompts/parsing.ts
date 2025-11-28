/**
 * Parsing Prompts
 * Prompts for parsing user requests into structured data
 */

/**
 * Group creation parsing prompt - for Gemini to parse group creation requests
 */
export function groupCreationParsingPrompt(userPrompt: string): string {
  return `Analyze this group creation request and extract the group name, participant names, and optional group picture description.

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
Output: {"groupName":"Friends","participants":["John","Lisa","Tom"],"groupPicture":null}`;
}

/**
 * TTS parsing prompt - for Gemini to parse text-to-speech requests
 */
export function ttsParsingPrompt(userPrompt: string): string {
  return `Analyze this text-to-speech request and determine if the user wants the output in a specific language.

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
Output: {"needsTranslation":false,"text":"read this text"}`;
}

/**
 * Music video parsing prompt - for Gemini to detect if music request includes video
 */
export function musicVideoParsingPrompt(userPrompt: string): string {
  return `Analyze this music generation request and determine if the user wants a video along with the song.

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
Output: {"wantsVideo":false,"cleanPrompt":"make a happy song"}`;
}

