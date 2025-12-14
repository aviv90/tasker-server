import {
  CRITICAL_LANGUAGE_RULE,
  CRITICAL_GENDER_RULE,
  CHAT_HISTORY_RULE,
  CONVERSATION_HISTORY_CONTEXT_RULE,
  GOOGLE_DRIVE_RULE,
  LOCATION_RULE,
  MUSIC_CREATION_RULE,
  WEB_SEARCH_RULE,
  AUDIO_TRANSLATION_RULES,
  NEW_REQUEST_VS_RETRY_RULE,
  RETRY_SPECIFIC_STEPS_RULE,
  FOLLOW_UP_VS_RETRY_RULE,
  SCHEDULING_RULE,
  SINGLE_STEP_TOOL_MAPPING,
  SINGLE_STEP_RULES,
  OPENAI_SYSTEM_RULES,
  GROK_SYSTEM_RULES,
  SEARCH_ASSISTANT_RULES,
  GOOGLE_SEARCH_SYSTEM_INSTRUCTION,
  GOOGLE_SEARCH_RULES,
  CRITICAL_MULTI_MODAL_RULE
} from './rules';
import { getHistoryContextRules } from '../tools-list';

/**
 * Agent system instruction - base behavior for autonomous agent
 */
export function agentSystemInstruction(languageInstruction: string): string {
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  return `Current Date & Time: ${now}
AI Assistant. ${languageInstruction}

CORE RULES:
${CRITICAL_GENDER_RULE}
${CRITICAL_LANGUAGE_RULE}
• **ROOT CAUSE ONLY:** Solve problems from the ROOT. Do NOT use "band-aid" fixes or temporary patches. Analyze continuously until the deep source of the issue is found and fixed.

CONTEXT & HISTORY:
• **CRITICAL - CURRENT REQUEST ONLY:** The history shows past conversation. **ONLY the LAST user message is your current task.** All previous user requests were ALREADY handled - do NOT re-execute them!
• **Continuity:** Maintain natural conversation flow.
  - History (last 10 messages) is provided for context ONLY.
  - ${CONVERSATION_HISTORY_CONTEXT_RULE}
  - **Tool-Specific History:**
${getHistoryContextRules()}
  - Reference past context where relevant.
  - Choose tools based on CURRENT request, independent of past tool types.
  - **NEVER** use tools for requests that appear earlier in history - they are COMPLETED.
${FOLLOW_UP_VS_RETRY_RULE}
${NEW_REQUEST_VS_RETRY_RULE}
${RETRY_SPECIFIC_STEPS_RULE}

BEHAVIOR:
• **Tools:** Use appropriate tools for tasks.
• **Default:** If no tool fits, answer with text.
• **Directness:** Answer directly and concisely.
• **Format:** No [image] tags in text. Captions/descriptions MUST be in request language.
• **Protocol:** **NEVER** announce "I am creating..." or "Processing". just call the tool.
• **Protocol:** **NEVER** announce "I am creating..." or "Processing". just call the tool.
• **Protocol:** **NEVER** apologize in a language different from the user's request. Match the user's language exactly (e.g., Hebrew request -> Hebrew apology).
• **Persona:** Do NOT mimic automated system messages (e.g., "Creating image...").
${CRITICAL_MULTI_MODAL_RULE}

TOOL RULES:
${AUDIO_TRANSLATION_RULES}
${CHAT_HISTORY_RULE}
${GOOGLE_DRIVE_RULE}
${LOCATION_RULE}
${MUSIC_CREATION_RULE}
${WEB_SEARCH_RULE}
${SCHEDULING_RULE}

If unsure, respond with text.`;
}

/**
 * Single step system instruction - for individual steps in multi-step workflow
 */
export function singleStepInstruction(languageInstruction: string): string {
  return `Multi-step workflow - execute THIS step only. ${languageInstruction}

MANDATORY:
${CRITICAL_LANGUAGE_RULE}
• **Focus:** Execute EXACTLY one action for this step. Do NOT skip or change it.
• **Isolation:** Do NOT use tools from other steps (like \`get_chat_history\`).
• **Language:** Captions and text MUST match request language.

${SINGLE_STEP_TOOL_MAPPING}

${SINGLE_STEP_RULES}`;
}

/**
 * OpenAI system instruction - for OpenAI Chat API
 */
export function openaiSystemInstruction(language: string): string {
  return OPENAI_SYSTEM_RULES[language as keyof typeof OPENAI_SYSTEM_RULES] || OPENAI_SYSTEM_RULES.default;
}

/**
 * Grok system instruction - for Grok Chat API
 */
export function grokSystemInstruction(language: string): string {
  return GROK_SYSTEM_RULES[language as keyof typeof GROK_SYSTEM_RULES] || GROK_SYSTEM_RULES.default;
}

/**
 * Search assistant system instruction - for Google Search operations
 */
export function searchSystemInstruction(query: string, languageInstruction: string): string {
  const isHebrew = languageInstruction.includes('עברית') || languageInstruction.includes('בעברית');
  return isHebrew ? SEARCH_ASSISTANT_RULES.he(query) : SEARCH_ASSISTANT_RULES.en(query);
}

/**
 * Google Search System Instruction
 */
export function googleSearchSystemInstruction(languageInstruction: string, useGoogleSearch: boolean): string {
  let systemPrompt = `${GOOGLE_SEARCH_SYSTEM_INSTRUCTION}
${languageInstruction}`;

  if (useGoogleSearch) {
    systemPrompt += GOOGLE_SEARCH_RULES;
  }

  return systemPrompt;
}

/**
 * Google Search Model Response
 */
export function googleSearchResponse(detectedLang: string, useGoogleSearch: boolean): string {
  let modelResponse = '';

  switch (detectedLang) {
    case 'he':
      modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
      if (useGoogleSearch) {
        modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
      }
      break;
    case 'en':
      modelResponse = 'Understood. I will respond directly without thinking process.';
      if (useGoogleSearch) {
        modelResponse += ' **Google Search tool is available and I must use it for any link request.** I must not answer from memory (2023) or invent links. If search found no results - I will say "No link available".';
      }
      break;
    case 'ar':
      modelResponse = 'فهمت. سأجيب مباشرة دون عملية تفكير.';
      if (useGoogleSearch) {
        modelResponse += ' **أداة Google Search متاحة ويجب أن أستخدمها لأي طلب رابط.** لا يجب أن أجيب من الذاكرة (2023) أو أختلق روابط. إذا لم يجد البحث نتائج - سأقول "لا يوجد رابط متاح".';
      }
      break;
    case 'ru':
      modelResponse = 'Понял. Буду отвечать напрямую без процесса размышления.';
      if (useGoogleSearch) {
        modelResponse += ' **Инструмент Google Search доступен, и я должен использовать его для любого запроса ссылки.** Я не должен отвечать из памяти (2023) или придумывать ссылки. Если поиск не нашел результатов - я скажу "Ссылка недоступна".';
      }
      break;
    default:
      modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
      if (useGoogleSearch) {
        modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
      }
  }

  return modelResponse;
}

/**
 * Google Search Example
 */
export function googleSearchExample(detectedLang: string): { user: string; model: string } {
  let exampleUser: string;
  let exampleModel: string;

  switch (detectedLang) {
    case 'he':
      exampleUser = 'שלח לי קישור למזג האוויר בתל אביב';
      exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423';
      break;
    case 'en':
      exampleUser = 'Send me a link to weather in Tel Aviv';
      exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nHere is a link to weather forecast in Tel Aviv: https://www.ims.gov.il/he/cities/2423';
      break;
    case 'ar':
      exampleUser = 'أرسل لي رابط للطقس في تل أبيب';
      exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nإليك رابط لتوقعات الطقس في تل أبيب: https://www.ims.gov.il/he/cities/2423';
      break;
    case 'ru':
      exampleUser = 'Отправь мне ссылку на погоду в Тель-Авиве';
      exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nВот ссылка на прогноз погоды в Тель-Авиве: https://www.ims.gov.il/he/cities/2423';
      break;
    default:
      exampleUser = 'שלח לי קישור למזג האוויר בתל אביב';
      exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423';
  }

  return {
    user: exampleUser,
    model: exampleModel
  };
}
