/**
 * Context & Memory Tools
 * 
 * Tools for accessing chat history, analyzing images from history,
 * saving user preferences, and accessing long-term memory.
 * 
 * Extracted from metaTools.js (Phase 5.2)
 */

// Handle default export from TypeScript
const conversationManagerModule = require('../../../conversationManager');
const conversationManager = conversationManagerModule.default || conversationManagerModule;
const { getServices } = require('../../utils/serviceLoader');

const contextAndMemoryTools = {
  // Tool: Analyze image from history
  analyze_image_from_history: {
    declaration: {
      name: 'analyze_image_from_history',
      description: 'נתח תמונה מהיסטוריית ההודעות. השתמש בכלי הזה אחרי ששלפת את היסטוריית ההודעות וראית שיש תמונה רלוונטית.',
      parameters: {
        type: 'object',
        properties: {
          image_id: {
            type: 'number',
            description: 'מזהה התמונה מההיסטוריה (המספר שמופיע ב-[image_id: X])',
          },
          question: {
            type: 'string',
            description: 'השאלה או הבקשה לגבי התמונה',
          }
        },
        required: ['image_id', 'question']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`);
      
      let imageBuffer = null;
      try {
        // Get the message with the image
        const history = context.previousToolResults?.get_chat_history?.messages;
        if (!history || !history[args.image_id]) {
          return {
            success: false,
            error: `לא נמצאה תמונה עם המזהה ${args.image_id}`
          };
        }
        
        const message = history[args.image_id];
        const imageUrl = message.metadata?.imageUrl;
        
        if (!imageUrl) {
          return {
            success: false,
            error: `ההודעה ${args.image_id} לא מכילה תמונה`
          };
        }
        
        // Download and analyze the image
        const { geminiService, greenApiService } = getServices();
        imageBuffer = await greenApiService.downloadFile(imageUrl);
        
        const result = await geminiService.analyzeImageWithText(args.question, imageBuffer);
        
        // Free memory
        imageBuffer = null;
        
        if (result.success) {
          return {
            success: true,
            data: result.text
          };
        } else {
          return {
            success: false,
            error: result.error || 'שגיאה בניתוח התמונה'
          };
        }
      } catch (error) {
        console.error('❌ Error in analyze_image_from_history tool:', error);
        // Free memory on error
        imageBuffer = null;
        return {
          success: false,
          error: `שגיאה בניתוח תמונה: ${error.message}`
        };
      }
    }
  },

  // Tool: Save user preference
  save_user_preference: {
    declaration: {
      name: 'save_user_preference',
      description: 'שמור העדפת משתמש לטווח ארוך. השתמש כשמשתמש אומר "תמיד...", "אני מעדיף...", "בפעם הבאה...", "זכור ש...". דוגמאות: "תמיד צור תמונות עם OpenAI", "אני מעדיף וידאו קצרים", "זכור שאני לא אוהב חתולים".',
      parameters: {
        type: 'object',
        properties: {
          preference_key: {
            type: 'string',
            description: 'מפתח ההעדפה (למשל: "preferred_image_provider", "video_style", "dislikes")'
          },
          preference_value: {
            type: 'string',
            description: 'ערך ההעדפה'
          },
          description: {
            type: 'string',
            description: 'תיאור קצר של ההעדפה (אופציונלי)'
          }
        },
        required: ['preference_key', 'preference_value']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] save_user_preference called: ${args.preference_key} = ${args.preference_value}`);
      
      try {
        await conversationManager.saveUserPreference(
          context.chatId, 
          args.preference_key, 
          args.preference_value
        );
        
        return {
          success: true,
          data: `✅ שמרתי את ההעדפה: ${args.preference_key} = ${args.preference_value}`
        };
      } catch (error) {
        console.error('❌ Error in save_user_preference tool:', error);
        return {
          success: false,
          error: `שגיאה בשמירת העדפה: ${error.message}`
        };
      }
    }
  },

  // Tool: Get long-term memory
  get_long_term_memory: {
    declaration: {
      name: 'get_long_term_memory',
      description: 'קרא זיכרון ארוך טווח - סיכומי שיחות קודמות והעדפות משתמש. השתמש כשצריך להבין הקשר רחב יותר או לבדוק מה המשתמש אוהב/לא אוהב.',
      parameters: {
        type: 'object',
        properties: {
          include_summaries: {
            type: 'boolean',
            description: 'האם לכלול סיכומי שיחות קודמות (ברירת מחדל: true)',
          },
          include_preferences: {
            type: 'boolean',
            description: 'האם לכלול העדפות משתמש (ברירת מחדל: true)',
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] get_long_term_memory called`);
      
      try {
        const includeSummaries = args.include_summaries !== false;
        const includePreferences = args.include_preferences !== false;
        
        let result = {
          success: true,
          data: ''
        };
        
        // Get summaries
        if (includeSummaries) {
          const summaries = await conversationManager.getConversationSummaries(context.chatId, 5);
          
          if (summaries.length > 0) {
            result.data += '📚 סיכומי שיחות קודמות:\n\n';
            summaries.forEach((summary, idx) => {
              result.data += `${idx + 1}. ${summary.summary}\n`;
              if (summary.keyTopics && summary.keyTopics.length > 0) {
                result.data += `   נושאים: ${summary.keyTopics.join(', ')}\n`;
              }
              result.data += '\n';
            });
            result.summaries = summaries;
          } else {
            result.data += '📚 אין סיכומי שיחות קודמות\n\n';
          }
        }
        
        // Get preferences
        if (includePreferences) {
          const preferences = await conversationManager.getUserPreferences(context.chatId);
          
          if (Object.keys(preferences).length > 0) {
            result.data += '⚙️ העדפות משתמש:\n';
            for (const [key, value] of Object.entries(preferences)) {
              result.data += `   • ${key}: ${value}\n`;
            }
            result.preferences = preferences;
          } else {
            result.data += '⚙️ אין העדפות משתמש שמורות';
          }
        }
        
        return result;
      } catch (error) {
        console.error('❌ Error in get_long_term_memory tool:', error);
        return {
          success: false,
          error: `שגיאה בגישה לזיכרון ארוך טווח: ${error.message}`
        };
      }
    }
  }
};

module.exports = contextAndMemoryTools;
