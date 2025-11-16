/**
 * Search Tools - Web search capabilities
 * Clean, modular tool definitions following SOLID principles
 */

const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Search Web
 */
const search_web = {
  declaration: {
    name: 'search_web',
    description: `חפש מידע או לינקים באינטרנט באמצעות Google Search. 

**מתי להשתמש בכלי הזה:**
1. המשתמש מבקש לינק/קישור/URL (דוגמאות: "שלח לי לינק לשיר של אריאל זילבר", "send link to news article", "קישור לתחזית מזג אוויר")
2. צריך מידע עדכני שאינו בידע שלך (2023)
3. חיפוש תוכן קיים (שירים, סרטונים, מאמרים)

**חשוב מאוד:**
- כלי זה מחובר ל-Google Search ויחזיר לינקים אמיתיים ועדכניים
- אם המשתמש מבקש לינק - חובה להשתמש בכלי הזה!
- אסור לומר "אין לי אפשרות לשלוח לינקים" - יש לך את הכלי הזה!

**מתי לא להשתמש:**
- אם המשתמש מבקש ליצור משהו חדש (שיר, תמונה, וידאו) → השתמש ב-create_music/create_image/create_video`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'שאילתת החיפוש (לדוגמה: "שיר של אריאל זילבר", "BBC news Israel", "Tel Aviv weather forecast")',
        }
      },
      required: ['query']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] search_web called with query: ${args.query}`);
    
    try {
      // Use Gemini with Google Search
      const { geminiService } = getServices();
      const result = await geminiService.generateTextResponse(args.query, [], {
        useGoogleSearch: true
      });
      
      if (result.error) {
        return {
          success: false,
          error: result.error
        };
      }
      
      // Ensure links are included in the response
      console.log(`✅ [search_web] Got result (${result.text.length} chars)`);
      
      return {
        success: true,
        data: result.text
      };
    } catch (error) {
      console.error('❌ Error in search_web tool:', error);
      return {
        success: false,
        error: `שגיאה בחיפוש: ${error.message}`
      };
    }
  }
};

module.exports = {
  search_web
};

