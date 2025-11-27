/**
 * Search Tools - Web & RAG search capabilities
 * Clean, modular tool definitions following SOLID principles
 */

// Gemini File Search (RAG) client
// Using the new @google/genai SDK for proper File Search support
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai'; // Keep for search_web compatibility
import { config } from '../../../config';
import { getServices } from '../utils/serviceLoader';
import logger from '../../../utils/logger';
import prompts from '../../../config/prompts';
import { getLanguageInstruction } from '../utils/languageUtils';

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

// Initialize Gemini client for File Search (RAG)
const geminiApiKey = process.env.GEMINI_API_KEY || '';
// Use new SDK for File Search (RAG)
const googleGenAI = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
// Use legacy SDK for search_web (Google Search) to maintain compatibility
// @ts-ignore
const googleAI = new GoogleGenerativeAI(geminiApiKey);

/**
 * Tool: search_web
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
    logger.debug(`🔧 [Agent Tool] search_web called with query: ${args.query}`);

    try {
      if (!args.query) {
        return {
          success: false,
          error: 'חובה לציין שאילתת חיפוש'
        };
      }

      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      const normalizedLanguage = typeof language === 'string' ? language.toLowerCase() : 'he';
      const languageInstruction = getLanguageInstruction(normalizedLanguage);

      // Use SSOT from config/prompts.ts
      const systemInstruction = prompts.searchSystemInstruction(args.query, languageInstruction);

      const { geminiService } = getServices();
      const result = (await geminiService.generateTextResponse(args.query, [], {
        useGoogleSearch: true,
        systemInstruction
      })) as { text: string; error?: string };

      if (result.error) {
        return {
          success: false,
          error: result.error
        };
      }

      logger.info(`✅ [search_web] Got result (${result.text?.length || 0} chars)`);

      return {
        success: true,
        data: result.text
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in search_web tool:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: `שגיאה בחיפוש: ${err.message}`
      };
    }
  }
};

/**
 * Tool: search_building_plans
 * Use Gemini File Search Store with demo building plans PDF (RAG)
 */
type SearchBuildingPlansArgs = {
  question?: string;
};

export const search_building_plans = {
  declaration: {
    name: 'search_building_plans',
    description:
      'חפש מידע בשרטוטי הבנייה של הדמו (PDF) באמצעות Gemini File Search. השתמש בכלי הזה רק כשברור שהמשתמש שואל על תוכנית הבנייה / שרטוט / קומות / חדרים בבניין הדמו.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'השאלה המדויקת לגבי שרטוטי הבנייה (לדוגמה: "איפה חדר המדרגות בקומה 2?", "כמה חדרי שינה יש בתוכנית?")'
        }
      },
      required: ['question']
    }
  },
  execute: async (args: SearchBuildingPlansArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug('🔧 [Agent Tool] search_building_plans called', { question: args.question });

    try {
      if (!args.question) {
        return {
          success: false,
          error: 'חובה לציין שאלה לגבי שרטוטי הבנייה'
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeName =
        (config as any).rag?.buildingDemoStoreName || (config as any).models?.gemini?.fileSearchStore || null;

      if (!storeName) {
        logger.error('❌ No File Search Store configured for building plans RAG');
        return {
          success: false,
          error:
            'לא הוגדר File Search Store לשרטוטי הבנייה (חסר GEMINI_BUILDING_DEMO_STORE או GEMINI_MODEL_FILE_SEARCH_STORE)'
        };
      }

      if (!googleGenAI) {
        logger.error('❌ Failed to initialize GoogleGenAI client');
        return {
          success: false,
          error: 'שגיאה באתחול Gemini Client'
        };
      }

      const language =
        context?.originalInput?.language || context?.normalized?.language || 'he';
      const normalizedLanguage =
        typeof language === 'string' ? language.toLowerCase() : 'he';
      const languageInstruction = getLanguageInstruction(normalizedLanguage);

      const userPrompt = `${languageInstruction}

אתה עוזר בתחום שרטוטי בנייה. התייחס רק למידע שנמצא בקובץ/ים שבמאגר File Search של שרטוט הבניין הדמו.
אם המידע לא מופיע שם, תגיד שאין לך מספיק מידע מתוך השרטוט.

שאלה:
${args.question}`;

      // Use gemini-3-pro-preview for building plans analysis (best model for PDF/RAG analysis)
      // This model is specifically optimized for complex document understanding and analysis
      const modelForBuildingPlans = 'gemini-3-pro-preview';

      logger.info('🔧 [search_building_plans] Preparing request', {
        model: modelForBuildingPlans,
        storeName,
        // Check if storeName looks valid
        validFormat: storeName.startsWith('fileSearchStores/')
      });

      // Use the new SDK (@google/genai) structure which supports File Search properly
      // Explicitly construct content and tool objects to ensure correct serialization
      // Using gemini-3-pro-preview for superior PDF analysis capabilities
      const response = await googleGenAI.models.generateContent({
        model: modelForBuildingPlans,
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [storeName]
              }
            }
          ]
        }
      });

      // In the new @google/genai SDK, response.text is a getter property
      const text = response.text || '';

      if (!text) {
        logger.warn('⚠️ [search_building_plans] Empty response from Gemini File Search');
        return {
          success: false,
          error: 'לא הצלחתי למצוא מידע רלוונטי בשרטוטי הבנייה'
        };
      }

      logger.info(
        `✅ [search_building_plans] Got RAG result (${text.substring(0, 80)}...)`
      );

      return {
        success: true,
        data: text
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in search_building_plans tool:', {
        error: err.message,
        stack: err.stack
      });
      return {
        success: false,
        error: `שגיאה בחיפוש בשרטוטי הבנייה: ${err.message}`
      };
    }
  }
};

module.exports = {
  search_web,
  search_building_plans
};


