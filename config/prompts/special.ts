/**
 * Special Purpose Prompts
 * Prompts for specific operations like polls, location, summaries
 */

/**
 * Poll generation prompt - for creating creative polls with or without rhymes
 */
export function pollGenerationPrompt(topic: string, numOptions: number, withRhyme: boolean, language = 'he'): string {
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
}

/**
 * Location info prompt - for Google Maps Grounding
 */
export function locationMapsPrompt(latitude: number, longitude: number, language = 'he'): string {
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
}

/**
 * Location general knowledge prompt - fallback when Maps Grounding fails
 */
export function locationGeneralPrompt(latitude: number, longitude: number, language = 'he'): string {
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
}

/**
 * Structured conversation summary prompt - for long-term memory and user preferences
 */
export function conversationHistorySummaryPrompt(conversationText: string): string {
  return `נתח את השיחה הבאה וצור סיכום מובנה:

${conversationText}

החזר JSON בפורמט הבא (רק JSON, ללא טקסט נוסף):
{
  "summary": "סיכום קצר של השיחה (2-3 משפטים)",
  "keyTopics": ["נושא 1", "נושא 2", "נושא 3"],
  "userPreferences": {
    "key": "value"
  }
}

הערות:
- summary: תאר את מה שדובר בשיחה באופן תמציתי
- keyTopics: 3-5 נושאים מרכזיים שדובר עליהם
- userPreferences: זהה העדפות משתמש (סגנון, ספקים מועדפים, נושאים שחוזרים)
- אם אין העדפות ברורות, החזר אובייקט ריק {}`;
}

/**
 * Chat summary prompt - for summarizing conversation history (regular chat response)
 */
export function chatSummaryPrompt(formattedMessages: string): string {
  return `אנא צור סיכום קצר וברור של השיחה הבאה. התמקד בנושאים העיקריים, החלטות שהתקבלו, ונקודות חשובות.

חשוב: הסיכום חייב להיות בעברית.

הוראות:
- אם יש הודעות מדיה (תמונה, וידאו, אודיו) - ציין שהשיחה כללה גם מדיה, אבל אל תנתח את תוכן המדיה אלא אם כן המשתמש ביקש זאת במפורש
- התמקד בתוכן הטקסטואלי של השיחה
- אם יש caption למדיה - השתמש בו כחלק מההקשר

הודעות השיחה:
${formattedMessages}

סיכום השיחה:`;
}


/**
 * Translation prompt - for text translation
 */
export function translationPrompt(text: string, targetLanguage: string): string {
  return `Translate the following text to ${targetLanguage}. Return ONLY the translated text, nothing else.

Text to translate: "${text}"

Important: Return only the translation, no explanations, no quotes, no extra text.`;
}

/**
 * Drive Document Analysis Prompt (PDFs/Docs)
 */
export const driveDocumentAnalysisPrompt =
  'זהו קובץ מסמך/שרטוט (PDF). ' +
  'תאר באופן מפורט וברור את התוכן שלו, את המבנה, האלמנטים המרכזיים, הטקסטים החשובים, ' +
  'וכל דבר שרלוונטי להבנת השרטוט או התכנית. ' +
  'ענה בעברית ברורה, עם bullet points מסודרים.';

/**
 * Drive Image Analysis Prompt
 */
export const driveImageAnalysisPrompt =
  'תאר את התוכן של התמונה בפירוט. אם יש טקסט בתמונה, העתק אותו במלואו.';

