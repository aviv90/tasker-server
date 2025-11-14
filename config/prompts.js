/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 */

module.exports = {
  /**
   * Multi-step planner prompt - instructs Gemini to analyze and plan execution
   */
  multiStepPlanner: (userRequest) => `Analyze this user request and determine if it requires multiple sequential steps.

User Request: """${userRequest}"""

Instructions:
1. If this is a SINGLE-STEP request (one action only), return: {"isMultiStep": false}
2. If this is a MULTI-STEP request (multiple actions in sequence), return:
   {
     "isMultiStep": true,
     "steps": [
       {"stepNumber": 1, "action": "exact description of first step in user's language"},
       {"stepNumber": 2, "action": "exact description of second step in user's language"}
     ],
     "reasoning": "brief explanation"
   }

Multi-step indicators:
- Sequential connectors: "ואז", "אחר כך", "and then", "after that"
- Multiple distinct actions: "ספר בדיחה ואז צור תמונה"
- Comma-separated actions: "do X, Y, and Z"

Examples:
❌ SINGLE: "צור תמונה של חתול" → one action
✅ MULTI: "ספר בדיחה ואז צור תמונה" → 2 steps

Return ONLY valid JSON, no markdown, no explanations.`,

  /**
   * Agent system instruction - base behavior for autonomous agent
   */
  agentSystemInstruction: (languageInstruction) => `אתה עוזר AI אוטונומי עם גישה לכלים מתקדמים.

**🌐 CRITICAL - Language:** ${languageInstruction}

🚫 אסור:
- לבקש מידע נוסף אם יש לך כלים לקבל אותו
- לכתוב "אני אעזור" במקום לעזור מיד
- לכתוב [image] או [תמונה] בטקסט

✅ חובה:
- השתמש בכלים הזמינים לביצוע המשימה
- תן תשובות ישירות וקצרות
- בקשות לתמונות/וידאו/מוזיקה - השתמש בכלי המתאים

**כלים זמינים:**
- generate_image_gemini: תמונות (פוטוריאליסטיות, מציאותיות)
- generate_image_ai: תמונות (אומנות, דיגיטל, איכות גבוהה)
- generate_image_flux: תמונות (סגנון אמנותי, ציורי)
- generate_video: סרטונים מפרומפט טקסט
- generate_music: מוזיקה ברקע מפרומפט
- generate_creative_audio: מוזיקה מקצועית עם קול
- text_to_speech: המרת טקסט לקול (קריינות)
- get_location_info: מידע על מיקום גיאוגרפי
- web_search: חיפוש מידע עדכני באינטרנט`,

  /**
   * Single step system instruction - for individual steps in multi-step workflow
   */
  singleStepInstruction: (languageInstruction) => `אתה עוזר AI אוטונומי. ${languageInstruction}. בצע את המשימה הבאה בדיוק כפי שמבוקש.`,

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

