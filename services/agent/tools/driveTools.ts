/**
 * Google Drive Tools - Search and retrieve documents from Google Drive
 * Clean, modular tool definitions following SOLID principles
 */

import googleDriveService from '../../googleDriveService';
import logger from '../../../utils/logger';

type AgentToolContext = {
  chatId?: string;
  originalInput?: {
    language?: string;
  };
  normalized?: {
    language?: string;
  };
};

type SearchGoogleDriveArgs = {
  query?: string;
  folder_id?: string;
  max_results?: number;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
}>;

/**
 * Tool: search_google_drive
 */
export const search_google_drive = {
  declaration: {
    name: 'search_google_drive',
    description: `חפש מידע ומסמכים ב-Google Drive. הכלי יכול לחפש קבצים, תמונות, מסמכים ותיקיות, לחלץ טקסט מהם ולספק מידע רלוונטי.

**מתי להשתמש בכלי הזה (חובה!):**
1. **שאלות על שרטוטים/מסמכים/קבצים** - המשתמש שואל על שרטוט, מסמך, תכנית, קובץ, PDF, או כל תוכן שנמצא ב-Google Drive (דוגמאות: "מה יש בשרטוט", "מה מופיע במסמך", "תסביר לי את התכנית", "מה כתוב בקובץ", "מה יש ב-PDF")
2. **חיפוש מסמכים** - המשתמש מבקש מידע מתוך מסמכים ב-Google Drive (דוגמאות: "חפש במסמכים שלי", "מה כתוב במסמך X", "מצא מידע על Y בתיקייה")
3. **חיפוש תמונות** - המשתמש מבקש מידע מתוך תמונות ב-Google Drive (דוגמאות: "מה יש בתמונה X", "חפש תמונות של Y")
4. **חיפוש בתיקייה ספציפית** - המשתמש מציין תיקייה מסוימת (דוגמאות: "חפש בתיקייה X", "מה יש בתיקייה Y")
5. **מידע מתוך קבצים** - המשתמש מבקש מידע שצריך לחפש בתוך תוכן הקבצים, לא רק בשמות הקבצים

**CRITICAL - שאלות על שרטוטים/מסמכים:**
- אם המשתמש שואל "מה יש בשרטוט", "מה מופיע במסמך", "מה כתוב בקובץ", "תסביר את התכנית" → **תמיד** השתמש ב-search_google_drive!
- **אל תשתמש ב-get_chat_history או analyze_image_from_history** לשאלות על שרטוטים/מסמכים/קבצים - השתמש ב-search_google_drive!
- הכלי ימצא אוטומטית את הקובץ הרלוונטי בתיקיית הלקוח, יוריד אותו, ינתח אותו (ויזואלית/טקסטואלית) ויחזיר תיאור מפורט

**CRITICAL - מתי לא להשתמש:**
- **אל תשתמש ב-search_google_drive לבקשות מיקום!** אם המשתמש מבקש "שלח מיקום", "מיקום באזור X", "location in X" → השתמש ב-send_location!
- אם המשתמש מבקש ליצור משהו חדש (שיר, תמונה, וידאו) → השתמש ב-create_music/create_image/create_video
- אם המשתמש מבקש מידע מהאינטרנט (לא מ-Google Drive) → השתמש ב-search_web
- אם המשתמש שואל על הודעות קודמות בצ'אט (לא על קבצים ב-Drive) → השתמש ב-get_chat_history

**חשוב מאוד:**
- הכלי מחפש גם בשמות הקבצים וגם בתוכן הקבצים (כאשר אפשרי)
- הכלי יכול לחלץ טקסט מתמונות, מסמכים וקבצים אחרים
- אם המשתמש מבקש מידע מ-Google Drive - חובה להשתמש בכלי הזה!
- אסור לומר "אין לי גישה ל-Google Drive" - יש לך את הכלי הזה!`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'שאילתת החיפוש (לדוגמה: "מסמכים על פרויקט X", "תמונות של פגישה", "מידע על לקוח Y")'
        },
        folder_id: {
          type: 'string',
          description: 'מזהה התיקייה הספציפית לחיפוש (אופציונלי). אם לא צוין, יחפש בכל ה-Drive.'
        },
        max_results: {
          type: 'number',
          description: 'מספר מקסימלי של קבצים לחזור (ברירת מחדל: 5)'
        }
      },
      required: ['query']
    }
  },
  execute: async (args: SearchGoogleDriveArgs = {}, _context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] search_google_drive called with query: ${args.query}, folder_id: ${args.folder_id}`);

    try {
      if (!args.query) {
        return {
          success: false,
          error: 'חובה לציין שאילתת חיפוש'
        };
      }

      const maxResults = args.max_results || 5;
      const folderId = args.folder_id || process.env.GOOGLE_DRIVE_FOLDER_ID;

      // Search and extract relevant information
      const result = await googleDriveService.searchAndExtractRelevantInfo(
        args.query,
        folderId,
        maxResults
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'שגיאה בחיפוש ב-Google Drive'
        };
      }

      if (!result.results || result.results.length === 0) {
        return {
          success: true,
          data: `לא נמצאו קבצים רלוונטיים ב-Google Drive עבור החיפוש "${args.query}".`
        };
      }

      // Format results for the agent
      const formattedResults = result.results.map((item: { file: { name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string }; extractedText?: string; relevance?: string }, index: number) => {
        const file = item.file;
        let text = `\n${index + 1}. **${file.name}** (${file.mimeType})`;
        
        if (file.modifiedTime) {
          const date = new Date(file.modifiedTime);
          text += `\n   📅 עודכן לאחרונה: ${date.toLocaleDateString('he-IL')}`;
        }
        
        if (file.size) {
          const sizeMB = (parseInt(file.size) / (1024 * 1024)).toFixed(2);
          text += `\n   📦 גודל: ${sizeMB} MB`;
        }
        
        if (file.webViewLink) {
          text += `\n   🔗 קישור: ${file.webViewLink}`;
        }
        
        if (item.extractedText) {
          // Limit extracted text length
          const preview = item.extractedText.length > 500 
            ? item.extractedText.substring(0, 500) + '...'
            : item.extractedText;
          text += `\n   📄 תוכן:\n   ${preview}`;
        } else if (item.relevance === 'failed') {
          text += `\n   ⚠️ לא ניתן לחלץ טקסט מהקובץ`;
        }
        
        return text;
      }).join('\n');

      const summary = `נמצאו ${result.results.length} קבצים רלוונטיים ב-Google Drive עבור החיפוש "${args.query}":${formattedResults}`;

      logger.info(`✅ [search_google_drive] Found ${result.results.length} files`);

      return {
        success: true,
        data: summary
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in search_google_drive tool:', { error: err.message, stack: err.stack });
      
      // Check for authentication errors
      if (err.message.includes('invalid_grant') || err.message.includes('unauthorized') || err.message.includes('OAuth')) {
        return {
          success: false,
          error: 'נדרש אימות מחדש ל-Google Drive. אנא ודא שה-GOOGLE_DRIVE_REFRESH_TOKEN מוגדר נכון.'
        };
      }
      
      return {
        success: false,
        error: `שגיאה בחיפוש ב-Google Drive: ${err.message}`
      };
    }
  }
};

module.exports = {
  search_google_drive
};

