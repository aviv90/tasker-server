/**
 * Search Tools - Web search capabilities
 * Clean, modular tool definitions following SOLID principles
 */

import { getServices } from '../utils/serviceLoader';

type AgentToolContext = {
  chatId?: string;
  originalInput?: {
    language?: string;
  };
  normalized?: {
    language?: string;
  };
};

type SearchWebArgs = {
  query?: string;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
}>;

/**
 * Tool: Search Web
 */
export const search_web = {
  declaration: {
    name: 'search_web',
    description: `חפש מידע או לינקים באינטרנט באמצעות Google Search. 

**מתי להשתמש בכלי הזה (חובה!):**
1. **מידע עדכני** - זמן, תאריך, אזור זמן (דוגמאות: "מה השעה ברומניה", "what time is it in New York", "איזה יום היום", "what date is it")
2. **חדשות ואירועים** - מידע אקטואלי ועדכני (דוגמאות: "מה קורה בעולם", "latest news about X", "אירועים היום")
3. **מזג אוויר** - תחזית או תנאי מזג אוויר נוכחיים (דוגמאות: "מזג אוויר בתל אביב", "weather in London", "תחזית מזג אוויר")
4. **לינקים וקישורים** - המשתמש מבקש לינק/קישור/URL (דוגמאות: "שלח לי לינק לשיר של אריאל זילבר", "send link to news article")
5. **מידע שעלול להשתנות** - כל מידע שדורש נתונים עדכניים מהאינטרנט
6. **חיפוש תוכן קיים** - שירים, סרטונים, מאמרים, סרטים

**חשוב מאוד:**
- כלי זה מחובר ל-Google Search ויחזיר לינקים אמיתיים ועדכניים
- אם המשתמש מבקש מידע עדכני (זמן, תאריך, חדשות) - חובה להשתמש בכלי הזה!
- אם המשתמש מבקש לינק - חובה להשתמש בכלי הזה!
- אסור לומר "אין לי אפשרות לשלוח לינקים" או "אני לא יכול לדעת את השעה" - יש לך את הכלי הזה!
- אסור לומר "אני לא יכול לגשת לאינטרנט" - יש לך את הכלי הזה!

**מתי לא להשתמש:**
- אם המשתמש מבקש ליצור משהו חדש (שיר, תמונה, וידאו) → השתמש ב-create_music/create_image/create_video`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'שאילתת החיפוש (לדוגמה: "שיר של אריאל זילבר", "BBC news Israel", "Tel Aviv weather forecast")'
        }
      },
      required: ['query']
    }
  },
  execute: async (args: SearchWebArgs = {}, context: AgentToolContext = {}): ToolResult => {
    console.log(`🔧 [Agent Tool] search_web called with query: ${args.query}`);

    try {
      if (!args.query) {
        return {
          success: false,
          error: 'חובה לציין שאילתת חיפוש'
        };
      }

      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      const normalizedLanguage = typeof language === 'string' ? language.toLowerCase() : 'he';
      const isHebrew = normalizedLanguage === 'he' || normalizedLanguage === 'hebrew';
      const langInstruction =
        isHebrew || !language
          ? 'בעברית'
          : `in ${normalizedLanguage === 'en' ? 'English' : language}`;

      const { geminiService } = getServices();
      const result = (await geminiService.generateTextResponse(args.query, [], {
        useGoogleSearch: true,
        systemInstruction: `You are a helpful search assistant. Search for "${args.query}" and answer ${langInstruction}. Provide relevant links if found.`
      })) as { text: string; error?: string };

      if (result.error) {
        return {
          success: false,
          error: result.error
        };
      }

      console.log(`✅ [search_web] Got result (${result.text?.length || 0} chars)`);

      return {
        success: true,
        data: result.text
      };
    } catch (error) {
      const err = error as Error;
      console.error('❌ Error in search_web tool:', err);
      return {
        success: false,
        error: `שגיאה בחיפוש: ${err.message}`
      };
    }
  }
};

module.exports = {
  search_web
};

