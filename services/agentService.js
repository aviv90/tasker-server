const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const conversationManager = require('./conversationManager');
const locationService = require('./locationService');
const prompts = require('../config/prompts');
const { detectLanguage, extractDetectionText, cleanThinkingPatterns } = require('../utils/agentHelpers');
const { planMultiStepExecution } = require('./multiStepPlanner');
const { getStaticFileUrl } = require('../utils/urlUtils');

const execAsync = promisify(exec);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Import utility functions from refactored modules
const { formatProviderName, normalizeProviderKey, applyProviderToMessage } = require('./agent/utils/providerUtils');
// promptUtils removed - using LLM-first approach only
const { getServices } = require('./agent/utils/serviceLoader');
const { getAudioDuration } = require('./agent/utils/audioUtils');
const { TOOL_ACK_MESSAGES, VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('./agent/config/constants');
const { getUserFacingTools } = require('../config/tools-list');

// Import modular agent tools
const { allTools: agentTools, getToolDeclarations } = require('./agent/tools');

// ═══════════════════ AGENT CONTEXT MEMORY (Persistent in DB) ═══════════════════
// Agent context is now stored persistently in PostgreSQL database
// No more in-memory cache or TTL - context persists indefinitely like ChatGPT
// Access via conversationManager.saveAgentContext/getAgentContext/clearAgentContext
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 * 
 * NOTE: Tool definitions are now in /services/agent/tools/ (modular structure)
 */

/**
 * Meta-tools (advanced composite tools)
 * These are kept in agentService.js temporarily until further refactoring
 * TODO: Move these to /services/agent/tools/metaTools.js in Phase 2
 */
const metaTools = {
  // Meta-Tool 1: Create and Analyze
  create_and_analyze: {
    declaration: {
      name: 'create_and_analyze',
      description: 'צור תמונה ומיד נתח אותה. שימושי כשאתה רוצה לוודא שהתמונה עומדת בדרישות מסוימות.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'מספר ההודעות האחרונות לשלוף (ברירת מחדל: 20)',
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      const limit = args.limit || 20;
      console.log(`🔧 [Agent Tool] get_chat_history called with limit: ${limit}`);
      
      try {
        const history = await conversationManager.getConversationHistory(context.chatId);
        
        if (!history || history.length === 0) {
          return {
            success: true,
            data: 'אין היסטוריית הודעות זמינה',
            messages: []
          };
        }
        
        // Format history for the agent
        const formattedHistory = history.map((msg, idx) => {
          let content = `${msg.role === 'user' ? 'משתמש' : 'בוט'}: ${msg.content}`;
          
          // Add media indicators with URLs
          if (msg.metadata) {
            if (msg.metadata.hasImage && msg.metadata.imageUrl) {
              content += ` [תמונה: image_id=${idx}, url=${msg.metadata.imageUrl}]`;
            } else if (msg.metadata.hasImage) {
              content += ' [תמונה מצורפת]';
            }
            
            if (msg.metadata.hasVideo && msg.metadata.videoUrl) {
              content += ` [וידאו: video_id=${idx}, url=${msg.metadata.videoUrl}]`;
            } else if (msg.metadata.hasVideo) {
              content += ' [וידאו מצורף]';
            }
            
            if (msg.metadata.hasAudio && msg.metadata.audioUrl) {
              content += ` [אודיו: audio_id=${idx}, url=${msg.metadata.audioUrl}]`;
              if (msg.metadata.transcribedText) {
                content += ` [תמלול: "${msg.metadata.transcribedText}"]`;
              }
            } else if (msg.metadata.hasAudio) {
              content += ' [הקלטה קולית]';
            }
          }
          
          return content;
        }).join('\n');
        
        return {
          success: true,
          data: `היסטוריה של ${history.length} הודעות אחרונות:\n\n${formattedHistory}`,
          messages: history  // Keep full history for follow-up tools
        };
      } catch (error) {
        console.error('❌ Error in get_chat_history tool:', error);
        return {
          success: false,
          error: `שגיאה בשליפת היסטוריה: ${error.message}`
        };
      }
    }
  },

  // Tool 2: Analyze image from history
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

  // Tool: Analyze image (direct URL)
  analyze_image: {
    declaration: {
      name: 'analyze_image',
      description: 'נתח תמונה ישירות מ-URL. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly" או "image_url:" - קח את ה-URL משם ישירות! השתמש בכלי הזה כשיש URL זמין (תמונה מצורפת או מצוטטת), ובלי URL השתמש ב-analyze_image_from_history.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'URL של התמונה לניתוח. אם זמין בפרומפט (בשורה "image_url:" או "Use this image_url parameter directly"), קח אותו משם.'
          },
          question: {
            type: 'string',
            description: 'השאלה או הבקשה לגבי התמונה (מה זה, תאר, explain, וכו\')'
          }
        },
        required: ['image_url', 'question']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] analyze_image called with image_url: ${args.image_url?.substring(0, 60)}...`);
      
      let imageBuffer = null;
      try {
        if (!args.image_url) {
          return {
            success: false,
            error: 'חסר image_url לניתוח התמונה.'
          };
        }
        
        // Download and analyze the image
        const { geminiService, greenApiService } = getServices();
        imageBuffer = await greenApiService.downloadFile(args.image_url);
        
        // Convert buffer to base64 string (geminiService expects base64, not Buffer)
        const base64Image = imageBuffer.toString('base64');
        
        const result = await geminiService.analyzeImageWithText(args.question, base64Image);
        
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
        console.error('❌ Error in analyze_image tool:', error);
        // Free memory on error
        imageBuffer = null;
        return {
          success: false,
          error: `שגיאה בניתוח התמונה: ${error.message}`
        };
      }
    }
  },

  // Tool 3: Search web
  search_web: {
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
  },

  // Tool 4: Access long-term memory (summaries & preferences)
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
  },

  // ═══════════════════ CREATION TOOLS (Basic) ═══════════════════

  // Tool 5: Create image (basic tool)
  create_image: {
    declaration: {
      name: 'create_image',
      description: 'צור תמונה חדשה. ברירת מחדל: Gemini. אם תרצה ספק אחר, ציין בפרמטר provider.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'תיאור התמונה ליצירה',
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירה: gemini (ברירת מחדל), openai, או grok',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_image called`);
      
      try {
        if (context?.expectedMediaType === 'video') {
          return {
            success: false,
            error: 'התבקשת ליצור וידאו, לא תמונה. בחר ספק וידאו מתאים או נסה שוב.'
          };
        }

        const provider = args.provider || 'gemini';
        const { geminiService, openaiService, grokService } = getServices();
        
        let imageResult;
        if (provider === 'openai') {
          imageResult = await openaiService.generateImageForWhatsApp(args.prompt);
        } else if (provider === 'grok') {
          imageResult = await grokService.generateImageForWhatsApp(args.prompt);
        } else {
          imageResult = await geminiService.generateImageForWhatsApp(args.prompt);
        }
        
        if (imageResult.error) {
          return {
            success: false,
            error: `שגיאה ביצירת תמונה עם ${provider}: ${imageResult.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ תמונה נוצרה בהצלחה!`,
          imageUrl: imageResult.imageUrl,
          imageCaption: imageResult.description || imageResult.revisedPrompt || '',
          provider: provider
        };
      } catch (error) {
        console.error('❌ Error in create_image tool:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // ═══════════════════ META TOOLS (Stage 2) ═══════════════════

  // Tool 5: Create and analyze (meta-tool)
  create_and_analyze: {
    declaration: {
      name: 'create_and_analyze',
      description: 'צור תמונה ומיד נתח אותה. שימושי כשאתה רוצה לוודא שהתמונה עומדת בדרישות מסוימות.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'תיאור התמונה ליצירה',
          },
          analysis_question: {
            type: 'string',
            description: 'מה לבדוק בתמונה (לדוגמה: "האם יש כלב בתמונה?")',
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירה: gemini, openai, או grok (ברירת מחדל: gemini)',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['prompt', 'analysis_question']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_and_analyze called`);
      
      let imageBuffer = null;
      try {
        const provider = args.provider || 'gemini';
        const { geminiService, openaiService, grokService, fileDownloader } = getServices();
        
        // Step 1: Create image
        let imageResult;
        if (provider === 'openai') {
          imageResult = await openaiService.generateImageForWhatsApp(args.prompt);
        } else if (provider === 'grok') {
          imageResult = await grokService.generateImageForWhatsApp(args.prompt);
        } else {
          imageResult = await geminiService.generateImageForWhatsApp(args.prompt);
        }
        
        if (imageResult.error) {
          return {
            success: false,
            error: `שגיאה ביצירת תמונה: ${imageResult.error}`
          };
        }
        
        console.log(`✅ Image created with ${provider}, analyzing...`);
        
        // Step 2: Download and analyze
        const { greenApiService: greenApi2 } = getServices();
        imageBuffer = await greenApi2.downloadFile(imageResult.imageUrl);
        const analysisResult = await geminiService.analyzeImageWithText(args.analysis_question, imageBuffer);
        
        // Free memory
        imageBuffer = null;
        
        if (analysisResult.error) {
          return {
            success: false,
            error: `התמונה נוצרה אבל הניתוח נכשל: ${analysisResult.error}`
          };
        }
        
        return {
          success: true,
          data: `התמונה נוצרה בהצלחה! ניתוח: ${analysisResult.text}`,
          imageUrl: imageResult.imageUrl,
          caption: imageResult.description || ''
        };
      } catch (error) {
        console.error('❌ Error in create_and_analyze tool:', error);
        // Free memory on error
        imageBuffer = null;
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool 5: Analyze and edit (meta-tool)
  analyze_and_edit: {
    declaration: {
      name: 'analyze_and_edit',
      description: 'נתח תמונה מההיסטוריה ואז ערוך אותה בהתאם לממצאים. שימושי לשיפור תמונות אוטומטי.',
      parameters: {
        type: 'object',
        properties: {
          image_id: {
            type: 'number',
            description: 'מזהה התמונה מההיסטוריה',
          },
          analysis_goal: {
            type: 'string',
            description: 'מה לבדוק בתמונה (לדוגמה: "מה חסר בתמונה?")',
          },
          edit_instruction: {
            type: 'string',
            description: 'הוראות לעריכה (לדוגמה: "הוסף את מה שחסר")',
          }
        },
        required: ['image_id', 'analysis_goal', 'edit_instruction']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] analyze_and_edit called`);
      
      let imageBuffer = null;
      try {
        // Step 1: Get image from history
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
        
        // Step 2: Analyze
        const { geminiService, greenApiService } = getServices();
        imageBuffer = await greenApiService.downloadFile(imageUrl);
        
        const analysisResult = await geminiService.analyzeImageWithText(args.analysis_goal, imageBuffer);
        
        if (analysisResult.error) {
          imageBuffer = null;
          return {
            success: false,
            error: `שגיאה בניתוח: ${analysisResult.error}`
          };
        }
        
        console.log(`✅ Analysis complete: ${analysisResult.text.substring(0, 50)}...`);
        
        // Step 3: Edit based on analysis
        const editPrompt = `${args.edit_instruction}. בהתבסס על הניתוח: ${analysisResult.text}`;
        const editResult = await geminiService.editImageWithText(editPrompt, imageBuffer);
        
        // Free memory
        imageBuffer = null;
        
        if (editResult.error) {
          return {
            success: false,
            error: `הניתוח הצליח אבל העריכה נכשלה: ${editResult.error}`
          };
        }
        
        return {
          success: true,
          data: `ניתחתי את התמונה ועריכתי אותה! ממצאים: ${analysisResult.text}`,
          imageUrl: editResult.url
        };
      } catch (error) {
        console.error('❌ Error in analyze_and_edit tool:', error);
        // Free memory on error
        imageBuffer = null;
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool 6: Smart Execute with Fallback (meta-tool - Stage 3)
  smart_execute_with_fallback: {
    declaration: {
      name: 'smart_execute_with_fallback',
      description: 'בצע משימה עם אסטרטגיות fallback חכמות. אם ניסיון ראשון נכשל, ננסה אוטומטית: לפשט את הפרומפט, לנסות ספק אחר, או לפצל למשימות קטנות יותר. השתמש בכלי הזה רק לאחר שניסיון רגיל כבר נכשל!',
      parameters: {
        type: 'object',
        properties: {
          task_type: {
            type: 'string',
            description: 'סוג המשימה: image_creation, video_creation, audio_creation',
            enum: ['image_creation', 'video_creation', 'audio_creation']
          },
          original_prompt: {
            type: 'string',
            description: 'הפרומפט המקורי שנכשל'
          },
          failure_reason: {
            type: 'string',
            description: 'למה הניסיון הראשון נכשל'
          },
          provider_tried: {
            type: 'string',
            description: 'איזה ספק כבר נוסה (gemini/openai/grok)',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['task_type', 'original_prompt', 'failure_reason']
      }
    },
    execute: async (args, context) => {
      console.log(`🧠 [Agent Tool] smart_execute_with_fallback called for ${args.task_type}`);
      
      try {
        const { geminiService, openaiService, grokService } = getServices();
        if (args.task_type === 'video_creation') {
          context.expectedMediaType = 'video';
        }
        
        // Strategy 1: Try different provider
        console.log(`📊 Strategy 1: Trying different provider...`);
        const providersTriedRaw = [];
        if (Array.isArray(args.providers_tried)) {
          providersTriedRaw.push(...args.providers_tried);
        }
        if (args.provider_tried) {
          providersTriedRaw.push(args.provider_tried);
        }
        const providersTried = providersTriedRaw.map(normalizeProviderKey).filter(Boolean);
        const providerOrder = VIDEO_PROVIDER_FALLBACK_ORDER;
        const lastTried = providersTried.length > 0 ? providersTried[providersTried.length - 1] : null;
        let startIndex = providerOrder.indexOf(lastTried);
        if (startIndex === -1) {
          startIndex = null;
        }
        const providers = [];
        for (let i = 0; i < providerOrder.length; i++) {
          const index = startIndex === null ? i : (startIndex + 1 + i) % providerOrder.length;
          const candidate = providerOrder[index];
          if (!providersTried.includes(candidate) && !providers.includes(candidate)) {
            providers.push(candidate);
          }
        }
        
        for (const provider of providers) {
          console.log(`   → Attempting with ${provider}...`);
          
          try {
            let result;
            
            if (args.task_type === 'image_creation') {
              // Image generation with different providers
              if (provider === 'openai') {
                result = await openaiService.generateImageForWhatsApp(args.original_prompt);
              } else if (provider === 'grok') {
                result = await grokService.generateImageForWhatsApp(args.original_prompt);
              } else {
                result = await geminiService.generateImageForWhatsApp(args.original_prompt);
              }
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי עם ${formatProviderName(provider)}!`,
                  imageUrl: result.imageUrl,
                  imageCaption: result.description || result.revisedPrompt || '',
                  strategy_used: 'different_provider',
                  provider: provider
                };
              }
            } else if (args.task_type === 'video_creation') {
              // Video generation with different providers
              const replicateService = require('./replicateService');
              const videoProviderLabelMap = {
                gemini: 'veo3',
                openai: 'sora',
                grok: 'kling'
              };
              
              if (provider === 'gemini') {
                result = await geminiService.generateVideoForWhatsApp(args.original_prompt);
              } else if (provider === 'openai') {
                // Try Sora (OpenAI)
                result = await openaiService.generateVideoWithSoraForWhatsApp(args.original_prompt, null, { model: 'sora-2' });
              } else if (provider === 'grok') {
                // Fallback to Kling via Replicate
                result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
              } else {
                result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
              }
              
              if (!result.error) {
                if (args.task_type === 'video_creation') {
                  context.expectedMediaType = null;
                }
                const providerLabel = videoProviderLabelMap[provider] || provider;
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם ${formatProviderName(providerLabel)}! (אסטרטגיה: מודל חלופי)`,
                  videoUrl: result.videoUrl || result.url,
                  strategy_used: 'different_provider',
                  provider: providerLabel
                };
              }
            } else if (args.task_type === 'audio_creation') {
              // Audio/TTS - only one main provider (ElevenLabs)
              // Strategy: Try with different voices or settings
              const voiceService = require('./voiceService');
              result = await voiceService.textToSpeechForBot(args.original_prompt);
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור אודיו! (אסטרטגיה: הגדרות משופרות)`,
                  audioUrl: result.url,
                  strategy_used: 'improved_settings',
                  provider: 'elevenlabs'
                };
              }
            }
          } catch (e) {
            console.log(`   ✗ ${provider} failed: ${e.message}`);
          }
        }
        
        // Strategy 2: Simplify prompt
        console.log(`📊 Strategy 2: Simplifying prompt...`);
        const simplifiedPrompt = simplifyPrompt(args.original_prompt);
        
        if (simplifiedPrompt !== args.original_prompt) {
          console.log(`   → Original: "${args.original_prompt}"`);
          console.log(`   → Simplified: "${simplifiedPrompt}"`);
          
          try {
            let result;
            
            if (args.task_type === 'image_creation') {
              result = await geminiService.generateImageForWhatsApp(simplifiedPrompt);
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                  imageUrl: result.imageUrl,
                  caption: result.description || '',
                  strategy_used: 'simplified_prompt',
                  original_prompt: args.original_prompt,
                  simplified_prompt: simplifiedPrompt
                };
              }
            } else if (args.task_type === 'video_creation') {
              const replicateService = require('./replicateService');
              result = await replicateService.generateVideoWithTextForWhatsApp(simplifiedPrompt);
              
              if (!result.error) {
                if (args.task_type === 'video_creation') {
                  context.expectedMediaType = null;
                }
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                  videoUrl: result.videoUrl || result.url,
                  strategy_used: 'simplified_prompt',
                  original_prompt: args.original_prompt,
                  simplified_prompt: simplifiedPrompt
                };
              }
            } else if (args.task_type === 'audio_creation') {
              const voiceService = require('./voiceService');
              result = await voiceService.textToSpeechForBot(simplifiedPrompt);
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור אודיו עם טקסט פשוט יותר! (אסטרטגיה: פישוט)`,
                  audioUrl: result.url,
                  strategy_used: 'simplified_prompt',
                  original_prompt: args.original_prompt,
                  simplified_prompt: simplifiedPrompt
                };
              }
            }
          } catch (e) {
            console.log(`   ✗ Simplified prompt failed: ${e.message}`);
          }
        }
        
        // Strategy 3: No longer used - LLM-based planner handles complex prompts
        // (This fallback strategy is deprecated and will be removed)
        
        // Strategy 4: Try with relaxed parameters (less strict)
        console.log(`📊 Strategy 4: Trying with relaxed parameters...`);
        try {
          // For images, try with a more generic/simplified version
          const genericPrompt = makePromptMoreGeneric(args.original_prompt);
          
          if (genericPrompt !== args.original_prompt) {
            console.log(`   → Generic version: "${genericPrompt}"`);
            
            let result;
            
            if (args.task_type === 'image_creation') {
              result = await openaiService.generateImageForWhatsApp(genericPrompt);
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                  imageUrl: result.imageUrl,
                  caption: result.description || '',
                  strategy_used: 'generic_prompt',
                  original_prompt: args.original_prompt,
                  generic_prompt: genericPrompt
                };
              }
            } else if (args.task_type === 'video_creation') {
              const replicateService = require('./replicateService');
              result = await replicateService.generateVideoWithTextForWhatsApp(genericPrompt);
              
              if (!result.error) {
                if (args.task_type === 'video_creation') {
                  context.expectedMediaType = null;
                }
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                  videoUrl: result.videoUrl || result.url,
                  strategy_used: 'generic_prompt',
                  original_prompt: args.original_prompt,
                  generic_prompt: genericPrompt
                };
              }
            } else if (args.task_type === 'audio_creation') {
              const voiceService = require('./voiceService');
              result = await voiceService.textToSpeechForBot(genericPrompt);
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור אודיו עם טקסט כללי יותר! (אסטרטגיה: הכללה)`,
                  audioUrl: result.url,
                  strategy_used: 'generic_prompt',
                  original_prompt: args.original_prompt,
                  generic_prompt: genericPrompt
                };
              }
            }
          }
        } catch (e) {
          console.log(`   ✗ Generic prompt failed: ${e.message}`);
        }
        
        // All strategies failed
        const failureBase = `כל האסטרטגיות נכשלו:\n1. ספקים שונים ✗\n2. פישוט פרומפט ✗\n3. פרמטרים כלליים ✗`;
        const additionalHint = args.task_type === 'video_creation'
          ? '\n\nהבקשה המקורית דורשת וידאו, לא תמונה. נסה לנסח מחדש או לציין סגנון אחר לוידאו.'
          : '\n\nאולי תנסה לנסח את הבקשה אחרת?';
        return {
          success: false,
          error: `${failureBase}${additionalHint}`
        };
        
      } catch (error) {
        console.error('❌ Error in smart_execute_with_fallback:', error);
        return {
          success: false,
          error: `שגיאה במנגנון החכם: ${error.message}`
        };
      }
    }
  },

  // Tool 7: Retry with different provider (meta-tool)
  retry_with_different_provider: {
    declaration: {
      name: 'retry_with_different_provider',
      description: 'נסה ליצור/לערוך תמונה או וידאו עם ספק אחר אם הראשון נכשל או לא טוב. תומך ביצירת תמונות, עריכת תמונות, ויצירת וידאו. אל תשתמש בכלי הזה לפני שניסית!',
      parameters: {
        type: 'object',
        properties: {
          original_prompt: {
            type: 'string',
            description: 'הפרומפט המקורי ליצירה/עריכה',
          },
          reason: {
            type: 'string',
            description: 'למה לנסות ספק אחר (לדוגמה: "התמונה לא טובה", "timeout")',
          },
          task_type: {
            type: 'string',
            description: 'סוג המשימה: image (יצירה), image_edit (עריכה), או video',
            enum: ['image', 'image_edit', 'video']
          },
          avoid_provider: {
            type: 'string',
            description: 'איזה ספק לא לנסות (למשל: kling, veo3, sora, gemini, openai, grok)',
          },
          image_url: {
            type: 'string',
            description: 'URL של התמונה (רק לעריכה - task_type=image_edit)',
          }
        },
        required: ['original_prompt', 'reason']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] retry_with_different_provider called for ${args.task_type || 'image'}`);
      
      try {
        const taskType = args.task_type || 'image';
        const avoidProviderRaw = args.avoid_provider;
        const avoidProvider = normalizeProviderKey(avoidProviderRaw);
        
        const { geminiService, openaiService, grokService, greenApiService } = getServices();
        const replicateService = require('./replicateService');
        
        let providers, displayProviders;
        
        if (taskType === 'image_edit') {
          // Image editing fallback order: Gemini (default) → OpenAI (single fallback)
          // CRITICAL: Never fallback to create_image! Only try the other supported editor!
          // Note: Grok doesn't support image editing at all
          const providers = ['gemini', 'openai'].filter(p => p !== avoidProvider);
          const errors = [];
          
          if (!args.image_url) {
            return {
              success: false,
              error: 'חסר image_url לעריכת תמונה. צריך לספק את ה-URL של התמונה לעריכה.'
            };
          }
          
          for (const provider of providers) {
            console.log(`🔄 Trying image edit provider: ${provider}`);
            
            try {
              // Download image and convert to base64
              const imageBuffer = await greenApiService.downloadFile(args.image_url);
              const base64Image = imageBuffer.toString('base64');
              
              let editResult;
              if (provider === 'openai') {
                editResult = await openaiService.editImageForWhatsApp(args.original_prompt, base64Image);
              } else if (provider === 'gemini') {
                editResult = await geminiService.editImageForWhatsApp(args.original_prompt, base64Image);
              }
              
              if (editResult && !editResult.error) {
                return {
                  success: true,
                  data: `✅ ניסיתי לערוך עם ${formatProviderName(provider)} והצלחתי!`,
                  imageUrl: editResult.imageUrl,
                  caption: editResult.description || '',
                  provider: provider
                };
              }
              
              errors.push(`${provider}: ${editResult?.error || 'Unknown error'}`);
              console.log(`❌ ${provider} edit failed: ${editResult?.error}`);
            } catch (providerError) {
              errors.push(`${provider}: ${providerError.message}`);
              console.error(`❌ ${provider} edit threw error:`, providerError);
            }
          }
          
          return {
            success: false,
            error: `כל ספקי העריכה נכשלו:\n${errors.join('\n')}`
          };
          
        } else if (taskType === 'video') {
          // Video fallback order: Sora 2 (openai) → Veo 3 (gemini) → Kling (grok)
          context.expectedMediaType = 'video';
          providers = VIDEO_PROVIDER_FALLBACK_ORDER.filter(p => p !== avoidProvider);
          displayProviders = providers.map(p => VIDEO_PROVIDER_DISPLAY_MAP[p] || p);
          
          const errors = [];
          
          for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            const displayProvider = displayProviders[i];
            console.log(`🔄 Trying video provider: ${displayProvider} (${provider})`);
            
            try {
              let result;
              if (provider === 'grok') {
                result = await replicateService.generateVideoWithTextForWhatsApp(args.original_prompt);
              } else if (provider === 'gemini') {
                result = await geminiService.generateVideoForWhatsApp(args.original_prompt);
              } else if (provider === 'openai') {
                result = await openaiService.generateVideoWithSoraForWhatsApp(args.original_prompt);
              }
              
              if (result && !result.error) {
                return {
                  success: true,
                  data: `✅ ניסיתי עם ${formatProviderName(displayProvider)} והצלחתי!`,
                  videoUrl: result.videoUrl || result.url,
                  caption: result.description || '',
                  provider: displayProvider
                };
              }
              
              errors.push(`${displayProvider}: ${result?.error || 'Unknown error'}`);
              console.log(`❌ ${displayProvider} failed: ${result?.error}`);
            } catch (providerError) {
              errors.push(`${displayProvider}: ${providerError.message}`);
              console.error(`❌ ${displayProvider} threw error:`, providerError);
            }
          }
          
          return {
            success: false,
            error: `כל הספקים נכשלו:\n${errors.join('\n')}`
          };
          
        } else {
          // Image: try providers in order, skipping the one that failed
          const providers = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
          const errors = [];
          
          for (const provider of providers) {
            console.log(`🔄 Trying image provider: ${provider}`);
            
            try {
              let imageResult;
              if (provider === 'openai') {
                imageResult = await openaiService.generateImageForWhatsApp(args.original_prompt);
              } else if (provider === 'grok') {
                imageResult = await grokService.generateImageForWhatsApp(args.original_prompt);
              } else {
                imageResult = await geminiService.generateImageForWhatsApp(args.original_prompt);
              }
              
              if (!imageResult.error) {
                return {
                  success: true,
                  data: `✅ ניסיתי עם ${formatProviderName(provider)} והצלחתי!`,
                  imageUrl: imageResult.imageUrl,
                  caption: imageResult.description || '',
                  provider: provider
                };
              }
              
              errors.push(`${provider}: ${imageResult.error}`);
              console.log(`❌ ${provider} failed: ${imageResult.error}`);
            } catch (providerError) {
              errors.push(`${provider}: ${providerError.message}`);
              console.error(`❌ ${provider} threw error:`, providerError);
            }
          }
          
          return {
            success: false,
            error: `כל הספקים נכשלו:\n${errors.join('\n')}`
          };
        }
      } catch (error) {
        console.error('❌ Error in retry_with_different_provider tool:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // ═══════════════════ OPTIMIZED META-TOOLS (Tool Chaining) ═══════════════════

  // Tool 8: History-aware creation (creates based on chat history context)
  history_aware_create: {
    declaration: {
      name: 'history_aware_create',
      description: 'צור תמונה מבוססת על הקשר מההיסטוריה. מאחד 2 פעולות: שליפת היסטוריה + יצירה חכמה מבוססת context.',
      parameters: {
        type: 'object',
        properties: {
          user_request: {
            type: 'string',
            description: 'הבקשה של המשתמש (לדוגמה: "צור תמונה כמו בפעם הקודמת")',
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירה (gemini/openai/grok)',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['user_request']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] history_aware_create called`);
      
      try {
        // Step 1: Get chat history
        const history = await conversationManager.getChatHistory(context.chatId, 20);
        
        if (!history || history.length === 0) {
          return {
            success: false,
            error: 'אין היסטוריה זמינה ליצירה מבוססת context'
          };
        }
        
        // Step 2: Build context-aware prompt
        const recentMessages = history.slice(-10).map(msg => 
          `${msg.role}: ${msg.content}`
        ).join('\n');
        
        const enrichedPrompt = `בהתבסס על ההקשר הבא:\n${recentMessages}\n\nבקשה: ${args.user_request}`;
        
        console.log(`🎨 Creating with enriched prompt based on history...`);
        
        // Step 3: Create with the enriched prompt
        const provider = args.provider || 'gemini';
        const { geminiService, openaiService, grokService } = getServices();
        
        let result;
        if (provider === 'openai') {
          result = await openaiService.generateImageForWhatsApp(enrichedPrompt);
        } else if (provider === 'grok') {
          result = await grokService.generateImageForWhatsApp(enrichedPrompt);
        } else {
          result = await geminiService.generateImageForWhatsApp(enrichedPrompt);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `יצירה נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ יצרתי תמונה מבוססת על ההקשר מההיסטוריה!`,
          imageUrl: result.imageUrl,
          caption: result.description || '',
          provider: provider,
          usedHistory: true
        };
      } catch (error) {
        console.error('❌ Error in history_aware_create:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool 9: Create with long-term memory (uses preferences and summaries)
  create_with_memory: {
    declaration: {
      name: 'create_with_memory',
      description: 'צור תמונה/תוכן מבוסס על העדפות המשתמש וזיכרון ארוך טווח. מאחד 2 פעולות: קריאת העדפות + יצירה מותאמת אישית.',
      parameters: {
        type: 'object',
        properties: {
          base_prompt: {
            type: 'string',
            description: 'הפרומפט הבסיסי ליצירה',
          },
          use_style_preferences: {
            type: 'boolean',
            description: 'האם להשתמש בהעדפות סגנון מהזיכרון (ברירת מחדל: true)',
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירה',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['base_prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_with_memory called`);
      
      try {
        const usePreferences = args.use_style_preferences !== false;
        
        let finalPrompt = args.base_prompt;
        
        // Step 1: Get user preferences if enabled
        if (usePreferences) {
          const preferences = await conversationManager.getUserPreferences(context.chatId);
          
          if (Object.keys(preferences).length > 0) {
            console.log(`🧠 Applying user preferences:`, preferences);
            
            // Build preference string
            const prefString = Object.entries(preferences)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
            
            finalPrompt = `${args.base_prompt}\nהעדפות סגנון: ${prefString}`;
          }
        }
        
        // Step 2: Create with personalized prompt
        const provider = args.provider || 'gemini';
        const { geminiService, openaiService, grokService } = getServices();
        
        let result;
        if (provider === 'openai') {
          result = await openaiService.generateImageForWhatsApp(finalPrompt);
        } else if (provider === 'grok') {
          result = await grokService.generateImageForWhatsApp(finalPrompt);
        } else {
          result = await geminiService.generateImageForWhatsApp(finalPrompt);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `יצירה נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ יצרתי תמונה מותאמת אישית על בסיס ההעדפות שלך!`,
          imageUrl: result.imageUrl,
          caption: result.description || '',
          provider: provider,
          usedPreferences: usePreferences
        };
      } catch (error) {
        console.error('❌ Error in create_with_memory:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool 10: Search and create (combines web search with image creation)
  search_and_create: {
    declaration: {
      name: 'search_and_create',
      description: 'חפש מידע באינטרנט ואז צור תמונה מבוססת על המידע. מאחד 2 פעולות: חיפוש + יצירה מושכלת.',
      parameters: {
        type: 'object',
        properties: {
          search_query: {
            type: 'string',
            description: 'מה לחפש באינטרנט',
          },
          creation_goal: {
            type: 'string',
            description: 'מה ליצור בהתבסס על תוצאות החיפוש',
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירה',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['search_query', 'creation_goal']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] search_and_create called`);
      
      try {
        // Step 1: Search web
        console.log(`🔍 Searching for: ${args.search_query}`);
        const { geminiService } = getServices();
        
        const searchResult = await geminiService.searchWeb(args.search_query);
        
        if (!searchResult || searchResult.error) {
          return {
            success: false,
            error: `חיפוש נכשל: ${searchResult?.error || 'Unknown error'}`
          };
        }
        
        // Step 2: Create image based on search results
        const enrichedPrompt = `${args.creation_goal}\n\nמידע רלוונטי מהאינטרנט: ${searchResult.text?.substring(0, 500) || 'N/A'}`;
        
        console.log(`🎨 Creating based on search results...`);
        
        const provider = args.provider || 'gemini';
        const { openaiService, grokService } = getServices();
        
        let result;
        if (provider === 'openai') {
          result = await openaiService.generateImageForWhatsApp(enrichedPrompt);
        } else if (provider === 'grok') {
          result = await grokService.generateImageForWhatsApp(enrichedPrompt);
        } else {
          result = await geminiService.generateImageForWhatsApp(enrichedPrompt);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `יצירה נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ חיפשתי באינטרנט ויצרתי תמונה מבוססת על המידע שמצאתי!`,
          imageUrl: result.imageUrl,
          caption: result.description || '',
          provider: provider,
          searchUsed: true
        };
      } catch (error) {
        console.error('❌ Error in search_and_create:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // ═══════════════════ NEW TOOLS: Video, Music, Audio, Utilities ═══════════════════

  // Tool: Create video from text
  create_video: {
    declaration: {
      name: 'create_video',
      description: 'צור סרטון וידאו מטקסט. תומך ב-Veo3 (Google), Sora (OpenAI), Kling (ברירת מחדל).',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'תיאור הסרטון המבוקש'
          },
          provider: {
            type: 'string',
            description: 'ספק ליצירת הוידאו',
            enum: ['veo3', 'sora', 'sora-pro', 'kling']
          }
        },
        required: ['prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_video called with provider: ${args.provider || 'kling'}`);
      
      try {
        const { geminiService, openaiService } = getServices();
        const replicateService = require('./replicateService');
        const provider = args.provider || 'kling';
        context.expectedMediaType = 'video';
        
        let result;
        if (provider === 'veo3') {
          result = await geminiService.generateVideoForWhatsApp(args.prompt);
        } else if (provider === 'sora' || provider === 'sora-pro') {
          const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
          result = await openaiService.generateVideoWithSoraForWhatsApp(args.prompt, null, { model });
        } else {
          result = await replicateService.generateVideoWithTextForWhatsApp(args.prompt);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `יצירת וידאו נכשלה: ${result.error}`
          };
        }
        
        const payload = {
          success: true,
          data: `✅ הוידאו נוצר בהצלחה עם ${formatProviderName(provider)}!`,
          videoUrl: result.videoUrl || result.url,
          provider: provider
        };
        context.expectedMediaType = null;
        return payload;
      } catch (error) {
        console.error('❌ Error in create_video:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Convert image to video
  image_to_video: {
    declaration: {
      name: 'image_to_video',
      description: 'המר תמונה לסרטון וידאו מונפש. USE THIS TOOL when user says: "הפוך/המר לווידאו", "תמונה לוידאו", "הנפש", "image to video", "animate", or specifies provider like "עם Veo 3/Sora 2/Kling". CRITICAL: אם בפרומפט יש "Use this image_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'URL של התמונה להמרה. אם זמין בפרומפט (בשורה "Use this image_url parameter directly"), קח אותו משם.'
          },
          prompt: {
            type: 'string',
            description: 'הנחיות לאנימציה - מה יקרה בסרטון (תנועה, פעולה, אפקטים)'
          },
          provider: {
            type: 'string',
            description: 'ספק להמרה: veo3 (Gemini Veo 3 - best quality), sora/sora-pro (OpenAI Sora 2 - cinematic), kling (Replicate Kling - fast). אם המשתמש מציין ספק ספציפי, השתמש בו!',
            enum: ['veo3', 'sora', 'sora-pro', 'kling']
          }
        },
        required: ['image_url', 'prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] image_to_video called`);
      
      try {
        const { geminiService, openaiService, greenApiService } = getServices();
        const replicateService = require('./replicateService');
        const provider = args.provider || 'kling';
        
        // CRITICAL: All providers need imageBuffer (not URL)!
        // Download the image once, then pass to provider
        const imageBuffer = await greenApiService.downloadFile(args.image_url);
        
        let result;
        if (provider === 'veo3') {
          result = await geminiService.generateVideoFromImageForWhatsApp(args.prompt, imageBuffer);
        } else if (provider === 'sora' || provider === 'sora-pro') {
          const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
          result = await openaiService.generateVideoWithSoraFromImageForWhatsApp(args.prompt, imageBuffer, { model });
        } else {
          // Kling also needs imageBuffer
          result = await replicateService.generateVideoFromImageForWhatsApp(imageBuffer, args.prompt);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `המרה לוידאו נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ התמונה הומרה לוידאו בהצלחה עם ${formatProviderName(provider)}!`,
          videoUrl: result.videoUrl || result.url,
          provider: provider
        };
      } catch (error) {
        console.error('❌ Error in image_to_video:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Analyze video
  analyze_video: {
    declaration: {
      name: 'analyze_video',
      description: 'נתח סרטון וידאו. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'URL של הוידאו לניתוח. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
          },
          question: {
            type: 'string',
            description: 'מה לנתח/לשאול על הוידאו'
          }
        },
        required: ['video_url', 'question']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] analyze_video called`);
      
      try {
        const { geminiService, greenApiService } = getServices();
        
        // CRITICAL: analyze_video needs videoBuffer, not URL!
        // Download the video first
        const videoBuffer = await greenApiService.downloadFile(args.video_url);
        const result = await geminiService.analyzeVideoWithText(args.question, videoBuffer);
        
        if (result.error) {
          return {
            success: false,
            error: `ניתוח וידאו נכשל: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: result.text || 'ניתוח הושלם',
          analysis: result.text
        };
      } catch (error) {
        console.error('❌ Error in analyze_video:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Create music
  create_music: {
    declaration: {
      name: 'create_music',
      description: 'יוצר שיר/מוזיקה חדש מאפס עם Suno AI. השתמש בכלי הזה כאשר: המשתמש מבקש ליצור/לכתוב/להלחין/לעשות שיר חדש (למשל: "צור שיר על...", "כתוב לי שיר על...", "תעשה שיר של...", "create a song about...", "make a song about...", "generate music about..."). הכלי מייצר שיר מקורי עם מילים ומלודיה. אם המשתמש מבקש לינק לשיר קיים (של זמר/אמן), אל תשתמש בכלי הזה.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'תיאור השיר החדש - סגנון, נושא, מילים, מצב רוח'
          },
          make_video: {
            type: 'boolean',
            description: 'האם ליצור גם וידאו/קליפ לשיר (אם המשתמש ביקש)'
          }
        },
        required: ['prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_music called`);
      
      try {
        const { generateMusicWithLyrics } = require('./musicService');
        const { parseMusicRequest } = require('./geminiService');
        
        const originalUserText = context.originalInput?.userText || args.prompt;
        const cleanedOriginal = originalUserText ? String(originalUserText).replace(/^#\s*/, '').trim() : args.prompt;
        
        let cleanPrompt = args.prompt;
        let wantsVideo = Boolean(args.make_video);
        
        try {
          const parsingResult = await parseMusicRequest(cleanedOriginal || args.prompt);
          if (parsingResult?.cleanPrompt) {
            cleanPrompt = parsingResult.cleanPrompt.trim() || cleanPrompt;
          }
          if (parsingResult?.wantsVideo) {
            wantsVideo = true;
          }
        } catch (parseError) {
          console.warn('⚠️ create_music: Failed to parse music request for video detection:', parseError.message);
        }
        
        const senderData = context.originalInput?.senderData || {};
        const whatsappContext = context.chatId ? {
          chatId: context.chatId,
          senderId: senderData.senderId || senderData.sender || null,
          senderName: senderData.senderName || senderData.senderContactName || '',
          senderContactName: senderData.senderContactName || '',
          chatName: senderData.chatName || ''
        } : null;
        
        const result = await generateMusicWithLyrics(cleanPrompt, {
          whatsappContext,
          makeVideo: wantsVideo
        });
        
        if (result.error) {
          return {
            success: false,
            error: `יצירת מוזיקה נכשלה: ${result.error}`
          };
        }
        
        if (result.status === 'pending') {
          return {
            success: true,
            data: result.message || '🎵 יצירת השיר בעיצומה! אשלח אותו מיד כשהוא יהיה מוכן.',
            status: 'pending',
            taskId: result.taskId || null,
            makeVideo: wantsVideo
          };
        }
        
        return {
          success: true,
          data: `✅ השיר נוצר בהצלחה!`,
          audioUrl: result.result || result.url,
          lyrics: result.lyrics
        };
      } catch (error) {
        console.error('❌ Error in create_music:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Transcribe audio
  transcribe_audio: {
    declaration: {
      name: 'transcribe_audio',
      description: 'תמלל הקלטה קולית לטקסט (STT). CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות! אם לא, חלץ מהמבנה "[audioUrl: URL]" בפרומפט.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה לתמלול. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
          }
        },
        required: ['audio_url']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] transcribe_audio called`);
      
      try {
        const axios = require('axios');
        const speechService = require('./speechService');
        const { voiceService } = require('./voiceService');
        
        if (!args.audio_url) {
          return {
            success: false,
            error: 'לא נמצא URL של הקלטה. צטט הודעה קולית ונסה שוב.'
          };
        }
        
        // Download audio file
        console.log(`📥 Downloading audio: ${args.audio_url}`);
        const audioResponse = await axios.get(args.audio_url, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(audioResponse.data);
        
        // Transcribe
        console.log(`🎤 Transcribing audio...`);
        const transcriptionResult = await speechService.speechToText(audioBuffer, {
          response_format: 'verbose_json',
          timestamp_granularities: ['word']
        });
        
        if (transcriptionResult.error) {
          return {
            success: false,
            error: `תמלול נכשל: ${transcriptionResult.error}`
          };
        }
        
        const transcribedText = transcriptionResult.text || '';
        const detectedLanguage = transcriptionResult.detectedLanguage || voiceService.detectLanguage(transcribedText);
        
        console.log(`✅ Transcribed: "${transcribedText}" (${detectedLanguage})`);
        
        return {
          success: true,
          data: `📝 תמלול:\n\n"${transcribedText}"`,
          transcription: transcribedText,
          language: detectedLanguage
        };
      } catch (error) {
        console.error('❌ Error in transcribe_audio:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Text to speech
  text_to_speech: {
    declaration: {
      name: 'text_to_speech',
      description: 'המר טקסט לדיבור. משתמש ב-ElevenLabs.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'הטקסט להקראה'
          },
          language: {
            type: 'string',
            description: 'שפה להקראה (en, he, es, fr, etc.)'
          }
        },
        required: ['text']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] text_to_speech called`);
      
      try {
        const { voiceService } = require('./voiceService');
        
        const language = args.language || 'he';
        const voiceResult = await voiceService.getVoiceForLanguage(language);
        
        if (voiceResult.error) {
          return {
            success: false,
            error: `לא נמצא קול לשפה: ${voiceResult.error}`
          };
        }
        
        const ttsResult = await voiceService.textToSpeech(voiceResult.voiceId, args.text, {
          model_id: 'eleven_v3',
          optimize_streaming_latency: 0,
          output_format: 'mp3_44100_128'
        });
        
        if (ttsResult.error) {
          return {
            success: false,
            error: `TTS נכשל: ${ttsResult.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ הטקסט הומר לדיבור!`,
          audioUrl: ttsResult.audioUrl
        };
      } catch (error) {
        console.error('❌ Error in text_to_speech:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Chat summary
  chat_summary: {
    declaration: {
      name: 'chat_summary',
      description: 'צור סיכום של השיחה הנוכחית. שימושי למשתמש שרוצה סיכום מהיר.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] chat_summary called`);
      
      try {
        const { geminiService } = getServices();
        
        const history = await conversationManager.getConversationHistory(context.chatId);
        
        if (!history || history.length === 0) {
          return {
            success: false,
            error: 'אין מספיק הודעות לסיכום'
          };
        }
        
        const summary = await geminiService.generateChatSummary(history);
        
        if (summary.error) {
          return {
            success: false,
            error: `יצירת סיכום נכשלה: ${summary.error}`
          };
        }
        
        return {
          success: true,
          data: summary.text || summary,
          summary: summary.text || summary
        };
      } catch (error) {
        console.error('❌ Error in chat_summary:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Create poll
  create_poll: {
    declaration: {
      name: 'create_poll',
      description: 'צור סקר עם שאלה ותשובות יצירתיות. תומך בסקרים עם או בלי חרוזים!',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'נושא הסקר'
          },
          with_rhyme: {
            type: 'boolean',
            description: 'האם לייצר תשובות בחרוז? true = עם חרוזים (ברירת מחדל), false = בלי חרוזים. אם המשתמש אומר "בלי חרוזים" או "without rhyme" - שלח false!'
          }
        },
        required: ['topic']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_poll called with topic: ${args.topic}, with_rhyme: ${args.with_rhyme !== false}`);
      
      try {
        const { geminiService } = getServices();
        
        // Default to true (with rhyme) if not specified
        const withRhyme = args.with_rhyme !== false;
        
        const pollData = await geminiService.generateCreativePoll(args.topic, withRhyme);
        
        if (pollData.error) {
          return {
            success: false,
            error: `יצירת סקר נכשלה: ${pollData.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ הסקר נוצר${withRhyme ? ' עם חרוזים' : ' בלי חרוזים'}!`,
          poll: pollData
        };
      } catch (error) {
        console.error('❌ Error in create_poll:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Send random location
  send_location: {
    declaration: {
      name: 'send_location',
      description: 'שלח מיקום אקראי במקום מסוים (עיר/מדינה/יבשה) או מיקום אקראי לגמרי. משתמש ב-Google Maps geocoding למציאת כל מקום בעולם.',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            description: `שם המקום המדויק שהמשתמש ביקש - **אופציונלי!** ציין רק אם המשתמש ביקש אזור ספציפי.
            
**CRITICAL - Region is OPTIONAL:**
- "שלח מיקום" (ללא אזור) → אל תציין region (מיקום אקראי)
- "שלח מיקום אקראי" → אל תציין region
- "שלח מיקום באזור תל אביב" → region="תל אביב" (ציין!)
- "מיקום ברחובות" → region="רחובות" (ציין!)

דוגמאות:
- "שלח מיקום באזור תל אביב" → region="תל אביב" (לא "באזור תל אביב"!)
- "מיקום ברחובות" → region="רחובות"
- "send location in Tokyo" → region="Tokyo"
- "מיקום במדבר יהודה" → region="מדבר יהודה"
- "באזור לונדון" → region="London"
- "מיקום בצרפת" → region="צרפת"
- "ביפן" → region="יפן"
- "באירופה" → region="אירופה"
- "שלח מיקום" / "שלח מיקום אקראי" → אל תציין region (השאר ריק או null)

כללים חשובים:
1. העתק רק את שם המקום עצמו, בלי מילות קישור ("באזור", "ב", "in", "near")
2. שמור על האיות המקורי (עברית/אנגלית כמו שהמשתמש כתב)
3. **אם אין אזור ספציפי בבקשה - אל תציין region!** (מיקום אקראי אוטומטית)
4. גם כפרים/יישובים/שכונות קטנים - ציין ב-region אם המשתמש ביקש!`
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] send_location called with region: ${args.region || 'none'}`);
      const { greenApiService } = getServices();

      try {
        // Build a comprehensive search string from all available sources
        const userText = context?.originalInput?.userText || context?.normalized?.text || '';
        const regionParam = args.region || '';
        
        // Combine region parameter with user text for better matching
        const regionToSearch = regionParam ? regionParam : userText;
        
        console.log(`📍 [Location] Searching for region: "${regionToSearch}"`);
        const requestedRegion = await locationService.extractRequestedRegion(regionToSearch);
        const regionAckMessage = locationService.buildLocationAckMessage(requestedRegion);

        if (regionAckMessage && context?.chatId) {
          await greenApiService.sendTextMessage(context.chatId, regionAckMessage);
        }

        const locationResult = await locationService.findRandomLocation({ requestedRegion });
        if (!locationResult.success) {
          const errorMessage = locationResult.error || 'לא הצלחתי למצוא מיקום תקין';
          if (context?.chatId) {
            await greenApiService.sendTextMessage(context.chatId, `❌ ${errorMessage}`);
          }
          return {
            success: false,
            error: errorMessage
          };
        }

        const latitude = parseFloat(locationResult.latitude);
        const longitude = parseFloat(locationResult.longitude);

        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
          throw new Error('Invalid coordinates returned from location service');
        }

        return {
          success: true,
          latitude,
          longitude,
          locationInfo: locationResult.description || '',
          data: locationResult.description || '',
          suppressFinalResponse: true
        };
      } catch (error) {
        console.error('❌ Error in send_location:', error);
        const errorMessage = error?.message || 'שגיאה לא ידועה בשליחת המיקום';
        if (context?.chatId) {
          await greenApiService.sendTextMessage(context.chatId, `❌ ${errorMessage}`);
        }
        return {
          success: false,
          error: errorMessage
        };
      }
    }
  },

  // ═══════════════════ ADVANCED TOOLS: Editing, Audio, Translation ═══════════════════

  // Tool: Edit image
  edit_image: {
    declaration: {
      name: 'edit_image',
      description: 'ערוך תמונה קיימת. CRITICAL: אם בפרומפט יש "Use this image_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'URL של התמונה לעריכה. אם זמין בפרומפט (בשורה "Use this image_url parameter directly"), קח אותו משם.'
          },
          edit_instruction: {
            type: 'string',
            description: 'מה לערוך בתמונה (הוסף, הסר, שנה, etc.)'
          },
          service: {
            type: 'string',
            description: 'ספק לעריכה',
            enum: ['openai', 'gemini']
          }
        },
        required: ['image_url', 'edit_instruction']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] edit_image called`);
      
      try {
        const { openaiService, geminiService, greenApiService } = getServices();
        const service = args.service || 'gemini'; // Gemini is the default editor (OpenAI is fallback)
        
        // CRITICAL: edit_image needs base64 image, not URL!
        // Download the image first and convert to base64
        const imageBuffer = await greenApiService.downloadFile(args.image_url);
        const base64Image = imageBuffer.toString('base64');
        
        let result;
        if (service === 'openai') {
          result = await openaiService.editImageForWhatsApp(args.edit_instruction, base64Image);
        } else {
          result = await geminiService.editImageForWhatsApp(args.edit_instruction, base64Image);
        }
        
        if (result.error) {
          return {
            success: false,
            error: `עריכת תמונה נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ התמונה נערכה בהצלחה עם ${formatProviderName(service)}!`,
          imageUrl: result.imageUrl,
          caption: result.description || '',
          service: service
        };
      } catch (error) {
        console.error('❌ Error in edit_image:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Edit video
  edit_video: {
    declaration: {
      name: 'edit_video',
      description: 'ערוך סרטון וידאו קיים. CRITICAL: אם בפרומפט יש "Use this video_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL בפרומפט, קרא ל-get_chat_history תחילה.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'URL של הוידאו לעריכה. אם זמין בפרומפט (בשורה "Use this video_url parameter directly"), קח אותו משם.'
          },
          edit_instruction: {
            type: 'string',
            description: 'מה לערוך בווידאו'
          }
        },
        required: ['video_url', 'edit_instruction']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] edit_video called`);
      
      try {
        const { greenApiService } = getServices();
        const replicateService = require('./replicateService');
        
        // CRITICAL: edit_video needs videoBuffer, not URL!
        // Download the video first
        const videoBuffer = await greenApiService.downloadFile(args.video_url);
        const result = await replicateService.generateVideoFromVideoForWhatsApp(videoBuffer, args.edit_instruction);
        
        if (result.error) {
          return {
            success: false,
            error: `עריכת וידאו נכשלה: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ הוידאו נערך בהצלחה!`,
          videoUrl: result.videoUrl
        };
      } catch (error) {
        console.error('❌ Error in edit_video:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Voice clone and speak
  voice_clone_and_speak: {
    declaration: {
      name: 'voice_clone_and_speak',
      description: 'שבט קול מהקלטה קיימת והשתמש בו כדי לדבר טקסט חדש. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא ל-get_chat_history.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה לשיבוט הקול. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
          },
          text_to_speak: {
            type: 'string',
            description: 'הטקסט שהקול המשובט ידבר'
          },
          language: {
            type: 'string',
            description: 'שפת הדיבור (he, en, es, etc.)'
          }
        },
        required: ['audio_url', 'text_to_speak']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] voice_clone_and_speak called`);
      
      try {
        const { voiceService } = require('./voiceService');
        const { greenApiService } = getServices();
        
        // Download audio for cloning
        const audioBuffer = await greenApiService.downloadFile(args.audio_url);
        
        // Clone voice
        const voiceCloneOptions = {
          name: `Agent Voice Clone ${Date.now()}`,
          description: `Voice clone from agent tool`,
          removeBackgroundNoise: true,
          labels: JSON.stringify({
            accent: 'natural',
            use_case: 'conversational',
            quality: 'high',
            language: args.language || 'he'
          })
        };
        
        const cloneResult = await voiceService.createInstantVoiceClone(audioBuffer, voiceCloneOptions);
        
        if (cloneResult.error) {
          return {
            success: false,
            error: `שיבוט קול נכשל: ${cloneResult.error}`
          };
        }
        
        // Use cloned voice to speak text
        const ttsResult = await voiceService.textToSpeech(cloneResult.voiceId, args.text_to_speak, {
          model_id: 'eleven_v3',
          optimize_streaming_latency: 0,
          output_format: 'mp3_44100_128'
        });
        
        if (ttsResult.error) {
          return {
            success: false,
            error: `דיבור עם קול משובט נכשל: ${ttsResult.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ שיבטתי את הקול והוא מדבר את הטקסט שביקשת!`,
          audioUrl: ttsResult.audioUrl,
          voiceId: cloneResult.voiceId
        };
      } catch (error) {
        console.error('❌ Error in voice_clone_and_speak:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Creative audio mix
  creative_audio_mix: {
    declaration: {
      name: 'creative_audio_mix',
      description: 'צור מיקס אודיו יצירתי עם אפקטים ומוזיקה מהקלטה. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא להיסטוריה.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה למיקס. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
          },
          style: {
            type: 'string',
            description: 'סגנון המיקס (אפשרויות: creative, remix, enhance)'
          }
        },
        required: ['audio_url']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] creative_audio_mix called`);
      
      try {
        const { creativeAudioService } = require('./creativeAudioService');
        const { greenApiService } = getServices();
        
        // Download audio
        const audioBuffer = await greenApiService.downloadFile(args.audio_url);
        
        // Create creative mix
        const result = await creativeAudioService.createCreativeMix(audioBuffer, {
          style: args.style || 'creative',
          addMusic: true,
          addEffects: true
        });
        
        if (result.error) {
          return {
            success: false,
            error: `מיקס יצירתי נכשל: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ המיקס היצירתי נוצר בהצלחה!`,
          audioUrl: result.url
        };
      } catch (error) {
        console.error('❌ Error in creative_audio_mix:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Translate text
  translate_text: {
    declaration: {
      name: 'translate_text',
      description: 'תרגם טקסט לשפה אחרת (מחזיר טקסט בלבד). אם המשתמש אומר "אמור ביפנית" או "תרגם ואמור" - השתמש ב-translate_and_speak במקום! תומך ב-20+ שפות.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'הטקסט לתרגום'
          },
          target_language: {
            type: 'string',
            description: 'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Finnish, Norwegian, Danish, Czech)'
          }
        },
        required: ['text', 'target_language']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] translate_text called`);
      
      try {
        const { geminiService } = getServices();
        
        const result = await geminiService.translateText(args.text, args.target_language);
        
        if (result.error) {
          return {
            success: false,
            error: `תרגום נכשל: ${result.error}`
          };
        }
        
        return {
          success: true,
          data: result.translatedText,
          translation: result.translatedText,
          translatedText: result.translatedText,
          provider: result.provider || 'gemini'
        };
      } catch (error) {
        console.error('❌ Error in translate_text:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Translate and speak
  translate_and_speak: {
    declaration: {
      name: 'translate_and_speak',
      description: 'תרגם טקסט לשפה אחרת והמר אותו לדיבור (מחזיר הודעה קולית). אם יש הקלטה קולית מצוטטת במבנה ה-prompt (audioUrl), יש לחלץ אותה ולהעביר! השתמש כשהמשתמש אומר "אמור X ביפנית", "תרגם ל-Y ואמור", "קרא בצרפתית" וכד\'.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'הטקסט לתרגום'
          },
          target_language: {
            type: 'string',
            description: 'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Finnish, Norwegian, Danish, Czech)'
          },
          quoted_audio_url: {
            type: 'string',
            description: 'URL של הקלטה קולית מצוטטת (אם קיימת ב-prompt). חלץ אותו מהמבנה "[audioUrl: URL]" במידה וקיים.'
          }
        },
        required: ['text', 'target_language']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] translate_and_speak called: "${args.text}" -> ${args.target_language}`);
      
      try {
        const { geminiService } = getServices();
        const { voiceService } = require('./voiceService');
        const axios = require('axios');
        
        const MIN_DURATION_FOR_CLONING = 4.6; // seconds
        
        // Step 1: Translate the text
        console.log(`🌐 Translating to ${args.target_language}...`);
        const translationResult = await geminiService.translateText(args.text, args.target_language);
        
        if (translationResult.error || !translationResult.success) {
          return {
            success: false,
            error: `תרגום נכשל: ${translationResult.error || 'Unknown error'}`
          };
        }
        
        const translatedText = translationResult.translatedText;
        console.log(`✅ Translated: "${translatedText}"`);
        
        // Validate that translated text is not empty
        if (!translatedText || translatedText.trim().length === 0) {
          return {
            success: false,
            error: 'התרגום החזיר טקסט ריק. אנא ספק טקסט תקין לתרגום.'
          };
        }
        
        // Step 2: Get language code for voice selection
        const languageCodeMap = {
          'english': 'en',
          'hebrew': 'he',
          'spanish': 'es',
          'french': 'fr',
          'german': 'de',
          'italian': 'it',
          'portuguese': 'pt',
          'russian': 'ru',
          'chinese': 'zh',
          'japanese': 'ja',
          'korean': 'ko',
          'arabic': 'ar',
          'hindi': 'hi',
          'turkish': 'tr',
          'polish': 'pl',
          'dutch': 'nl',
          'swedish': 'sv',
          'finnish': 'fi',
          'norwegian': 'no',
          'danish': 'da',
          'czech': 'cs'
        };
        
        const targetLanguageCode = languageCodeMap[args.target_language.toLowerCase()] || 'en';
        
        // Step 3: Handle voice selection (clone or random)
        let voiceId = null;
        
        // Check if there's a quoted audio for voice cloning
        if (args.quoted_audio_url) {
          console.log(`🎤 Quoted audio detected: ${args.quoted_audio_url}`);
          
          try {
            // Download audio file
            const audioResponse = await axios.get(args.quoted_audio_url, { responseType: 'arraybuffer' });
            const audioBuffer = Buffer.from(audioResponse.data);
            
            // Get audio duration
            const audioDuration = await getAudioDuration(audioBuffer);
            
            console.log(`🎵 Audio duration: ${audioDuration.toFixed(2)}s (minimum for cloning: ${MIN_DURATION_FOR_CLONING}s)`);
            
            if (audioDuration >= MIN_DURATION_FOR_CLONING) {
              console.log(`🎤 Attempting voice clone...`);
              
              const voiceCloneResult = await voiceService.cloneVoice({
                name: `Agent Voice Clone ${Date.now()}`,
                description: `Voice clone for translate_and_speak`,
                removeBackgroundNoise: true,
                labels: JSON.stringify({
                  accent: 'natural',
                  use_case: 'conversational',
                  quality: 'high',
                  language: targetLanguageCode
                })
              }, audioBuffer);
              
              if (voiceCloneResult.error) {
                console.log(`⚠️ Voice cloning failed: ${voiceCloneResult.error}, using random voice`);
              } else {
                voiceId = voiceCloneResult.voiceId;
                console.log(`✅ Voice cloned successfully: ${voiceId}`);
              }
            } else {
              console.log(`⏭️ Audio too short for cloning (${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s), using random voice`);
            }
          } catch (cloneError) {
            console.log(`⚠️ Error during voice cloning process: ${cloneError.message}, using random voice`);
          }
        }
        
        // If voice wasn't cloned, get random voice for target language
        if (!voiceId) {
          console.log(`🎤 Getting random voice for language: ${targetLanguageCode}...`);
          const voiceResult = await voiceService.getVoiceForLanguage(targetLanguageCode);
          
          if (voiceResult.error) {
            return {
              success: false,
              error: `לא נמצא קול לשפה: ${voiceResult.error}`
            };
          }
          
          voiceId = voiceResult.voiceId;
        }
        
        // Step 4: Convert to speech
        console.log(`🗣️ Converting to speech with voice ${voiceId}...`);
        const ttsResult = await voiceService.textToSpeech(voiceId, translatedText, {
          model_id: 'eleven_v3',
          optimize_streaming_latency: 0,
          output_format: 'mp3_44100_128',
          language_code: targetLanguageCode
        });
        
        if (ttsResult.error) {
          return {
            success: false,
            error: `TTS נכשל: ${ttsResult.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ תורגם ל-${args.target_language} והומר לדיבור!`,
          audioUrl: ttsResult.audioUrl,
          translatedText: translatedText
        };
      } catch (error) {
        console.error('❌ Error in translate_and_speak:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },

  // Tool: Create group
  create_group: {
    declaration: {
      name: 'create_group',
      description: 'צור קבוצת WhatsApp חדשה עם משתתפים. זמין רק למשתמשים מורשים.',
      parameters: {
        type: 'object',
        properties: {
          group_name: {
            type: 'string',
            description: 'שם הקבוצה'
          },
          participants_description: {
            type: 'string',
            description: 'תיאור המשתתפים (למשל: "כל חברי המשפחה", "צוות העבודה", וכו\')'
          }
        },
        required: ['group_name']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_group called`);
      
      try {
        const chatId = context.chatId;
        if (!chatId) {
          return {
            success: false,
            error: 'לא נמצא chatId עבור יצירת הקבוצה'
          };
        }
        
        const senderData = context.originalInput?.senderData || {};
        const senderId = senderData.senderId || senderData.sender;
        const senderName = senderData.senderName || senderData.senderContactName || senderId || 'המשתמש';
        
        const { parseGroupCreationPrompt, resolveParticipants } = require('./groupService');
        const { createGroup, setGroupPicture, sendTextMessage } = require('./greenApiService');
        const { generateImageForWhatsApp } = require('./geminiService');
        const fs = require('fs');
        const path = require('path');
        
        // Use the original user request to extract group details (falls back to args.group_name)
        const rawPrompt = (context.originalInput?.userText || args.group_name || '').replace(/^#\s*/, '').trim();
        const promptForParsing = rawPrompt || args.participants_description || args.group_name;
        
        console.log(`📋 Parsing group creation request from: "${promptForParsing}"`);
        
        await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...');
        await sendTextMessage(chatId, '🔍 מנתח את הבקשה...');
        
        const parsed = await parseGroupCreationPrompt(promptForParsing);
        
        let statusMsg = `📋 שם הקבוצה: "${parsed.groupName}"\n👥 מחפש ${parsed.participants.length} משתתפים...`;
        if (parsed.groupPicture) {
          statusMsg += `\n🎨 תמונה: ${parsed.groupPicture}`;
        }
        await sendTextMessage(chatId, statusMsg);
        
        const resolution = await resolveParticipants(parsed.participants);
        
        if (resolution.notFound.length > 0) {
          let errorMsg = `⚠️ לא מצאתי את המשתתפים הבאים:\n`;
          resolution.notFound.forEach(name => {
            errorMsg += `• ${name}\n`;
          });
          errorMsg += `\n💡 טיפ: וודא שהשמות נכונים או הרץ "עדכן אנשי קשר" לסנכרון אנשי קשר`;
          
          if (resolution.resolved.length === 0) {
            await sendTextMessage(chatId, errorMsg + '\n\n❌ לא נמצאו משתתפים - ביטול יצירת קבוצה');
            return {
              success: false,
              error: 'לא נמצאו משתתפים תואמים ליצירת הקבוצה'
            };
          }
          
          await sendTextMessage(chatId, errorMsg);
        }
        
        if (resolution.resolved.length > 0) {
          let foundMsg = `✅ נמצאו ${resolution.resolved.length} משתתפים:\n`;
          resolution.resolved.forEach(p => {
            foundMsg += `• ${p.searchName} → ${p.contactName}\n`;
          });
          await sendTextMessage(chatId, foundMsg);
        }
        
        await sendTextMessage(chatId, '🔨 יוצר את הקבוצה...');
        
        const participantIds = resolution.resolved
          .map(p => p.contactId)
          .filter(id => id && id !== senderId);
        
        if (participantIds.length === 0) {
          await sendTextMessage(chatId, '⚠️ לא נמצאו משתתפים נוספים (חוץ ממך). צריך לפחות משתתף אחד נוסף ליצירת קבוצה.');
          return {
            success: false,
            error: 'לא נמצאו משתתפים נוספים ליצירת הקבוצה'
          };
        }
        
        const groupResult = await createGroup(parsed.groupName, participantIds);
        await sendTextMessage(chatId, `✅ הקבוצה "${parsed.groupName}" נוצרה בהצלחה!`);
        
        if (parsed.groupPicture && groupResult.chatId) {
          try {
            await sendTextMessage(chatId, `🎨 יוצר תמונת פרופיל לקבוצה...\n"${parsed.groupPicture}"`);
            
            const imageResult = await generateImageForWhatsApp(parsed.groupPicture);
            
            if (imageResult.success && imageResult.fileName) {
              const imagePath = path.join(__dirname, '..', 'public', 'tmp', imageResult.fileName);
              
              if (fs.existsSync(imagePath)) {
                const imageBuffer = fs.readFileSync(imagePath);
                await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...');
                await setGroupPicture(groupResult.chatId, imageBuffer);
                await sendTextMessage(chatId, '✅ תמונת הקבוצה עודכנה בהצלחה!');
              } else {
                console.warn(`⚠️ Generated group image not found at ${imagePath}`);
              }
            } else if (imageResult.error) {
              await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה, אבל הייתה בעיה ביצירת התמונה: ${imageResult.error}`);
            }
          } catch (pictureError) {
            console.error('❌ Failed to set group picture:', pictureError);
            await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה, אבל לא הצלחתי להעלות תמונה: ${pictureError.message}`);
          }
        }
        
        const summaryLines = [
          `✅ הקבוצה "${parsed.groupName}" מוכנה!`,
          `👤 יוצר: ${senderName}`,
          `👥 משתתפים: ${resolution.resolved.length}`,
          groupResult.chatId ? `🆔 מזהה קבוצה: ${groupResult.chatId}` : null,
          groupResult.groupInviteLink ? `🔗 לינק הזמנה: ${groupResult.groupInviteLink}` : null
        ].filter(Boolean);
        
        return {
          success: true,
          data: '',
          groupId: groupResult.chatId || null,
          groupInviteLink: groupResult.groupInviteLink || null,
          participantsAdded: resolution.resolved.length,
          suppressFinalResponse: true
        };
      } catch (error) {
        console.error('❌ Error in create_group:', error);
        return {
          success: false,
          error: `שגיאה: ${error.message}`
        };
      }
    }
  },
  
  // Tool 27: Retry last command
  retry_last_command: {
    declaration: {
      name: 'retry_last_command',
      description: 'חזור על הפקודה האחרונה של המשתמש, עם אפשרות לשנות ספק או פרמטרים. השתמש כשהמשתמש אומר "נסה שוב", "שוב", "עם OpenAI", "עם Gemini", "תקן", וכו\'.',
      parameters: {
        type: 'object',
        properties: {
          provider_override: {
            type: 'string',
            enum: ['gemini', 'openai', 'grok', 'sora', 'veo3', 'kling', 'runway', 'none'],
            description: 'ספק חלופי להשתמש (אם המשתמש ביקש). none = אין שינוי'
          },
          modifications: {
            type: 'string',
            description: 'שינויים או הוראות נוספות מהמשתמש (למשל: "עם שיער ארוך", "בלי משקפיים")'
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] retry_last_command called with provider: ${args.provider_override || 'none'}`);
      
      try {
        // Get last command from DB
        const lastCommand = await conversationManager.getLastCommand(context.chatId);
        
        if (!lastCommand) {
          return {
            success: false,
            error: 'אין פקודה קודמת לחזור עליה. זו הפעם הראשונה שאתה מבקש משהו.'
          };
        }
        
        console.log(`🔄 Last command: ${lastCommand.tool} with args:`, lastCommand.args);
        
        // Map tool names to appropriate retry function
        const tool = lastCommand.tool;
        const storedWrapper = lastCommand.args || {};
        const originalArgs = (storedWrapper && storedWrapper.toolArgs)
          ? storedWrapper.toolArgs
          : storedWrapper || {};
        const storedResult = (storedWrapper && storedWrapper.result) ? storedWrapper.result : {};
        
        // Build modified prompt if needed
        let modifiedPrompt = originalArgs.prompt || originalArgs.text || storedResult.translation || storedResult.translatedText || '';
        if (args.modifications && args.modifications.trim()) {
          modifiedPrompt = modifiedPrompt
            ? `${modifiedPrompt} ${args.modifications}`
            : args.modifications;
        }
        modifiedPrompt = (modifiedPrompt || '').toString().trim();
        
        // Determine provider override
        let provider = args.provider_override;
        if (provider === 'none' || !provider) {
          // Keep original provider if exists
          provider = originalArgs.provider || originalArgs.service;
        }
        
        // Route to appropriate tool based on last command
        if (tool === 'gemini_image' || tool === 'openai_image' || tool === 'grok_image' || tool === 'create_image') {
          // Image generation retry
          const promptToUse = modifiedPrompt || originalArgs.prompt || originalArgs.text || storedResult.prompt || '';
          if (!promptToUse) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת.'
            };
          }
          
          const imageArgs = {
            prompt: promptToUse,
            provider: provider || 'gemini'
          };
          
          console.log(`🎨 Retrying image generation with:`, imageArgs);
          return await agentTools.create_image.execute(imageArgs, context);
          
        } else if (tool === 'veo3_video' || tool === 'sora_video' || tool === 'kling_text_to_video' || tool === 'create_video') {
          // Video generation retry
          const promptToUse = modifiedPrompt || originalArgs.prompt || originalArgs.text || storedResult.prompt || '';
          if (!promptToUse) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת לוידאו.'
            };
          }
          
          const videoArgs = {
            prompt: promptToUse,
            provider: provider || 'kling'
          };
          
          console.log(`🎬 Retrying video generation with:`, videoArgs);
          return await agentTools.create_video.execute(videoArgs, context);
          
        } else if (tool === 'edit_image') {
          // Image editing retry
          const editInstruction = modifiedPrompt || originalArgs.edit_instruction || originalArgs.prompt || '';
          const imageUrl = originalArgs.image_url || storedResult.imageUrl;
          
          if (!editInstruction || !imageUrl) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את הוראות העריכה או את כתובת התמונה.'
            };
          }
          
          const editArgs = {
            image_url: imageUrl,
            edit_instruction: editInstruction,
            service: provider || originalArgs.service || 'openai'
          };
          
          console.log(`✏️ Retrying image edit with:`, editArgs);
          return await agentTools.edit_image.execute(editArgs, context);
          
        } else if (tool === 'gemini_chat' || tool === 'openai_chat' || tool === 'grok_chat') {
          // Chat retry
          const chatProvider = provider || (tool.includes('openai') ? 'openai' : tool.includes('grok') ? 'grok' : 'gemini');
          
          // For chat, we need to use the appropriate service directly
          const { geminiService, openaiService, grokService } = getServices();
          
          let result;
          if (chatProvider === 'openai') {
            result = await openaiService.generateTextResponse(modifiedPrompt, []);
          } else if (chatProvider === 'grok') {
            result = await grokService.generateTextResponse(modifiedPrompt, []);
          } else {
            result = await geminiService.generateTextResponse(modifiedPrompt, []);
          }
          
          return {
            success: !result.error,
            data: result.text || result.error,
            error: result.error
          };
          
        } else if (tool === 'text_to_speech') {
          // TTS retry
          const textToSpeak = modifiedPrompt || originalArgs.text || storedResult.translation || storedResult.translatedText;
          if (!textToSpeak) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את הטקסט להמרה לדיבור.'
            };
          }
          return await agentTools.text_to_speech.execute({
            text: textToSpeak,
            target_language: originalArgs.target_language || originalArgs.language || 'he'
          }, context);
          
        } else if (tool === 'music_generation' || tool === 'create_music') {
          // Music retry
          const promptToUse = modifiedPrompt || originalArgs.prompt || storedResult.prompt || originalArgs.text || '';
          if (!promptToUse) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את הפרומפט ליצירת המוזיקה.'
            };
          }
          return await agentTools.create_music.execute({
            prompt: promptToUse
          }, context);
          
        } else if (tool === 'translate_text') {
          const translationArgs = {
            text: originalArgs.text || storedResult.originalText || originalArgs.prompt || '',
            target_language: originalArgs.target_language || originalArgs.language || storedResult.target_language || storedResult.language || 'he'
          };
          
          if (!translationArgs.text || !translationArgs.target_language) {
            return {
              success: false,
              error: 'לא הצלחתי לאחזר את הטקסט או את שפת היעד של הפקודה הקודמת.'
            };
          }
          
          return await agentTools.translate_text.execute(translationArgs, context);
          
        } else if (tool === 'create_poll') {
          // Poll retry
          const topicToUse = modifiedPrompt || originalArgs.topic || originalArgs.prompt || '';
          if (!topicToUse) {
            return {
              success: false,
              error: 'לא הצלחתי לשחזר את נושא הסקר הקודם.'
            };
          }
          return await agentTools.create_poll.execute({
            topic: topicToUse
          }, context);
          
        } else {
          // Generic retry - just return info about what was done
          return {
            success: true,
            data: `הפקודה האחרונה הייתה: ${tool}\n\nלא יכול לחזור עליה אוטומטית, אבל אתה יכול לבקש אותה שוב ישירות.`,
            lastTool: tool,
            lastArgs: originalArgs
          };
        }
        
      } catch (error) {
        console.error('❌ Error in retry_last_command:', error);
        return {
          success: false,
          error: `שגיאה בביצוע חוזר: ${error.message}`
        };
      }
    }
  }
};

// Merge modular tools with legacy meta-tools
// This allows gradual migration while maintaining all functionality
Object.assign(agentTools, metaTools);

// TOOL_ACK_MESSAGES, VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP,
// normalizeProviderKey, and applyProviderToMessage are now imported from refactored modules

/**
 * Send Ack message to user based on tools being executed
 * @param {string} chatId - Chat ID
 * @param {Array} functionCalls - Array of function calls (with name and args)
 */
async function sendToolAckMessage(chatId, functionCalls) {
  if (!chatId || !functionCalls || functionCalls.length === 0) return;
  
  try {
    let ackMessage = '';
    
    // Helper to build Ack message for a single tool
    const buildSingleAck = (call) => {
      const toolName = call.name;
      if (toolName === 'send_location') {
        return '';
      }
      // CRITICAL: Never expose tool names to user - use generic message if undefined
      let baseMessage = TOOL_ACK_MESSAGES[toolName] || 'מבצע פעולה... ⚙️';
      
      // Check if this tool uses a provider (direct or nested)
      const providerRaw = call.args?.provider;
      let provider = normalizeProviderKey(providerRaw);
      
      if (!provider && toolName === 'smart_execute_with_fallback') {
        const providersTriedRaw = [];
        if (Array.isArray(call.args?.providers_tried)) {
          providersTriedRaw.push(...call.args.providers_tried);
        }
        if (call.args?.provider_tried) {
          providersTriedRaw.push(call.args.provider_tried);
        }
        const providersTried = providersTriedRaw.map(normalizeProviderKey).filter(Boolean);
        const availableProviders = VIDEO_PROVIDER_FALLBACK_ORDER.filter(p => !providersTried.includes(p));
        provider = availableProviders[0] || null;
      }
      
      // SKIP: retry_with_different_provider handles its own Acks internally
      // Sending Ack here would duplicate the Acks sent by the tool itself
      if (toolName === 'retry_with_different_provider') {
        return ''; // Don't send any Ack - let the tool handle it
      }
      
      let providerDisplayKey = providerRaw || provider;
      const isVideoTask = call.args?.task_type === 'video_creation' 
                       || call.args?.task_type === 'video'
                       || toolName === 'create_video'
                       || toolName === 'retry_with_different_provider' && call.args?.task_type === 'video';
      if (isVideoTask) {
        const normalizedKey = normalizeProviderKey(providerDisplayKey);
        if (normalizedKey && VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey];
        } else if (!providerRaw && provider && VIDEO_PROVIDER_DISPLAY_MAP[provider]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[provider];
        }
      }
      
      const providerName = providerDisplayKey ? formatProviderName(providerDisplayKey) : null;
      baseMessage = applyProviderToMessage(baseMessage, providerName);
      
      return baseMessage;
    };
    
    if (functionCalls.length === 1) {
      const singleAck = buildSingleAck(functionCalls[0]);
      if (!singleAck || !singleAck.trim()) {
        return;
      }
      ackMessage = singleAck;
    } else if (functionCalls.length === 2) {
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע:\n• ${acks.join('\n• ')}`;
    } else {
      // Multiple tools - generic message
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע ${acks.length} פעולות... ⚙️`;
    }
    
    if (!ackMessage || !ackMessage.trim()) {
      return;
    }
    
    console.log(`📢 [ACK] Sending acknowledgment: "${ackMessage}"`);
    const { greenApiService } = getServices();
    await greenApiService.sendTextMessage(chatId, ackMessage);
  } catch (error) {
    console.error('❌ [ACK] Failed to send acknowledgment:', error.message);
    // Don't throw - Ack failure shouldn't break the agent
  }
}

// ✅ detectLanguage and getLanguageInstruction moved to /utils/agentHelpers.js and /config/prompts.js

/**
 * Get language instruction for system prompt (wrapper for prompts config)
 */
function getLanguageInstruction(langCode) {
  return prompts.languageInstructions[langCode] || prompts.languageInstructions['he'];
}

/**
 * Execute a single step in a multi-step workflow
 * @param {string} stepPrompt - Prompt for this specific step
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Step execution result
 */
async function executeSingleStep(stepPrompt, chatId, options = {}) {
  const {
    maxIterations = 5,
    languageInstruction,
    agentConfig,
    functionDeclarations,
    systemInstruction,
    expectedTool = null  // In multi-step, restrict execution to this tool only
  } = options;
  
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Shorter system instruction for single steps
  const stepSystemInstructionText = systemInstruction || prompts.singleStepInstruction(languageInstruction);
  
  // NO HISTORY for single steps - each step is isolated and focused on its specific task only
  const chat = model.startChat({
    history: [], // Empty history to prevent confusion between steps
    tools: [{ functionDeclarations }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: stepSystemInstructionText }]
    }
  });
  
  let iterations = 0;
  let currentPrompt = stepPrompt;
  const toolsUsed = [];
  let textResponse = '';
  const assets = {
    imageUrl: null,
    imageCaption: '',
    videoUrl: null,
    audioUrl: null,
    poll: null,
    latitude: null,
    longitude: null,
    locationInfo: null
  };
  
  // Agent execution loop
  while (iterations < maxIterations) {
    iterations++;
    
    try {
      const result = await chat.sendMessage(currentPrompt);
      const response = result.response;
      
      // Check for function calls
      const functionCalls = response.functionCalls();
      
      if (!functionCalls || functionCalls.length === 0) {
        // No more tool calls - get text response and finish
        textResponse = response.text();
        break;
      }
      
      // Execute function calls FIRST (don't send Ack yet - wait until step completes)
      const functionResponses = [];
      let targetToolExecuted = false;
      
      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args;
        
        // CRITICAL: In multi-step execution, only execute the target tool for this step
        // Prevent calling additional tools like get_chat_history that are not in the plan
        if (expectedTool && toolName !== expectedTool) {
          console.log(`⚠️ [Multi-step] Blocking unexpected tool call: ${toolName} (expected: ${expectedTool})`);
          functionResponses.push({
            name: toolName,
            response: { 
              error: `This tool is not part of the current step. Please execute only: ${expectedTool}`,
              blocked: true
            }
          });
          continue;
        }
        
        // If we already executed the target tool, stop (prevent multiple calls)
        if (expectedTool && targetToolExecuted && toolName === expectedTool) {
          console.log(`⚠️ [Multi-step] Target tool ${expectedTool} already executed, stopping`);
          break;
        }
        
        toolsUsed.push(toolName);
        
        // Execute the tool
        const toolFunction = agentTools[toolName];
        if (!toolFunction || !toolFunction.execute) {
          functionResponses.push({
            name: toolName,
            response: { error: `Tool ${toolName} not found or not executable` }
          });
          continue;
        }
        
        // Execute with proper context (chatId needed for some tools)
        const toolResult = await toolFunction.execute(toolArgs, { chatId });
        functionResponses.push({
          name: toolName,
          response: toolResult
        });
        
        // Mark target tool as executed
        if (expectedTool && toolName === expectedTool) {
          targetToolExecuted = true;
        }
        
        // Extract assets from tool result
        if (toolResult.imageUrl) {
          assets.imageUrl = toolResult.imageUrl;
          assets.imageCaption = toolResult.caption || toolResult.imageCaption || '';
        }
        if (toolResult.videoUrl) assets.videoUrl = toolResult.videoUrl;
        if (toolResult.audioUrl) assets.audioUrl = toolResult.audioUrl;
        if (toolResult.poll) assets.poll = toolResult.poll;
        if (toolResult.latitude) assets.latitude = toolResult.latitude;
        if (toolResult.longitude) assets.longitude = toolResult.longitude;
        if (toolResult.locationInfo) assets.locationInfo = toolResult.locationInfo;
      }
      
      // If target tool executed, get final text response and stop (don't continue with more tools)
      if (expectedTool && targetToolExecuted) {
        // Send function results back to get final text response
        const functionResponseParts = functionResponses
          .filter(fr => !fr.response.blocked)
          .map(fr => ({
            functionResponse: {
              name: fr.name,
              response: fr.response
            }
          }));
        
        if (functionResponseParts.length > 0) {
          const finalResult = await chat.sendMessage(functionResponseParts);
          textResponse = finalResult.response.text() || textResponse;
        }
        break; // Stop here - target tool executed, no need for more iterations
      }
      
      // Send function results back to the model (for non-multi-step or when no expected tool)
      const functionResponseParts = functionResponses
        .filter(fr => !fr.response.blocked)
        .map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response
          }
        }));
      
      if (functionResponseParts.length === 0) {
        // All tools were blocked, stop
        break;
      }
      
      const continueResult = await chat.sendMessage(functionResponseParts);
      textResponse = continueResult.response.text();
      
      // Check if model wants to continue with more tools
      if (!continueResult.response.functionCalls() || continueResult.response.functionCalls().length === 0) {
        break;
      }
      
    } catch (error) {
      console.error(`  ❌ [Step Error]:`, error.message);
      return {
        success: false,
        error: error.message,
        iterations,
        toolsUsed
      };
    }
  }
  
  // Clean up text response
  if (textResponse) {
    textResponse = cleanThinkingPatterns(textResponse);
  }
  
  return {
    success: true,
    text: textResponse,
    ...assets,
    toolsUsed,
    iterations
  };
}

/**
 * Execute an agent query with autonomous tool usage
 * @param {string} prompt - User's question/request
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Additional options
 * @returns {Object} - Response with text and tool usage info
 */
async function executeAgentQuery(prompt, chatId, options = {}) {
  // Detect user's language
  const userLanguage = detectLanguage(prompt);
  const languageInstruction = getLanguageInstruction(userLanguage);
  
  // ⚙️ Configuration: Load from env or use defaults
  const agentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8, // Increased from 5 to 8 for multi-step tasks
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000, // 4 minutes for complex multi-step tasks (increased from 3)
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  };
  
  // 🔍 Extract clean user text for multi-step detection (remove metadata)
  const detectionText = extractDetectionText(prompt);
  
  // 🧠 Use LLM-based planner to intelligently detect and plan multi-step execution
  let plan = await planMultiStepExecution(detectionText);
  
  console.log(`🔍 [Planner] Plan result:`, JSON.stringify({
    isMultiStep: plan.isMultiStep,
    stepsLength: plan.steps?.length,
    fallback: plan.fallback,
    steps: plan.steps?.map(s => ({ stepNumber: s.stepNumber, tool: s.tool, action: s.action?.substring(0, 50) }))
  }, null, 2));
  
  // If planner failed, treat as single-step (no heuristic fallback - rely on LLM only)
  if (plan.fallback) {
    console.log(`⚠️ [Planner] Planner failed, treating as single-step`);
    plan = { isMultiStep: false };
  }
  
  // 🔄 Multi-step execution - execute each step sequentially
  if (plan.isMultiStep && plan.steps && plan.steps.length > 1) {
    console.log(`✅ [Planner] Entering multi-step execution with ${plan.steps.length} steps`);
    agentConfig.maxIterations = Math.max(agentConfig.maxIterations, 15); // More iterations for multi-step
    agentConfig.timeoutMs = Math.max(agentConfig.timeoutMs, 360000); // 6 minutes for multi-step
    
    // Prepare tools for steps
    const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
    const systemInstruction = prompts.agentSystemInstruction(languageInstruction);
    
    // 🔄 Execute each step sequentially
    const stepResults = [];
    let accumulatedText = '';
    let finalAssets = {
      imageUrl: null,
      imageCaption: '',
      videoUrl: null,
      audioUrl: null,
      poll: null,
      latitude: null,
      longitude: null,
      locationInfo: null
    };
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Extract tool and parameters from plan (provided by planner)
      const toolName = step.tool || null;
      const toolParams = step.parameters || {};
      
      // 📢 CRITICAL: Send Ack BEFORE executing the step
      // For first step: Send Ack immediately
      // For subsequent steps: Previous step's results were already sent in previous iteration (all awaits completed)
      // So we can safely send Ack for current step
      if (toolName) {
        console.log(`📢 [Multi-step] Sending Ack for Step ${step.stepNumber}/${plan.steps.length} (${toolName}) BEFORE execution`);
        await sendToolAckMessage(chatId, [{ name: toolName, args: toolParams }]);
      }
      
      // Build focused prompt for this step - use action from plan
      let stepPrompt = step.action;
      
      // CRITICAL: ALWAYS add context from previous steps (not just when keywords detected)
      // Each step needs to know what happened before to maintain continuity
      if (stepResults.length > 0) {
        const previousContext = stepResults.map((res, idx) => {
          let summary = `Step ${idx + 1}:`;
          if (res.text) summary += ` ${res.text.substring(0, 200)}`; // Increased from 100 to 200 chars
          if (res.imageUrl) summary += ` [Created image]`;
          if (res.videoUrl) summary += ` [Created video]`;
          if (res.audioUrl) summary += ` [Created audio]`;
          if (res.poll) summary += ` [Created poll: "${res.poll.question}"]`;
          if (res.latitude && res.longitude) summary += ` [Sent location]`;
          return summary;
        }).join('\n');
        
        stepPrompt = `CONTEXT from previous steps:\n${previousContext}\n\nCURRENT TASK: ${step.action}`;
      }
      
      // If planner provided tool and parameters, add them to the prompt
      if (toolName && Object.keys(toolParams).length > 0) {
        const paramsStr = Object.entries(toolParams)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        stepPrompt = `${stepPrompt}\n\nTool: ${toolName}\nParameters: ${paramsStr}`;
      }
      
      // Execute this step
      try {
        console.log(`🔄 [Multi-step] Executing Step ${step.stepNumber}/${plan.steps.length}: ${step.action}`);
        const stepResult = await executeSingleStep(stepPrompt, chatId, {
          ...options,
          maxIterations: 5, // Limit iterations per step
          languageInstruction,
          agentConfig,
          functionDeclarations,
          systemInstruction: prompts.singleStepInstruction(languageInstruction),
          expectedTool: toolName  // Restrict execution to this tool only
        });
        
        console.log(`🔍 [Multi-step] Step ${step.stepNumber} executeSingleStep returned:`, {
          success: stepResult.success,
          hasLocation: !!(stepResult.latitude && stepResult.longitude),
          hasPoll: !!stepResult.poll,
          hasImage: !!stepResult.imageUrl,
          hasVideo: !!stepResult.videoUrl,
          hasAudio: !!stepResult.audioUrl,
          hasText: !!stepResult.text,
          toolsUsed: stepResult.toolsUsed,
          error: stepResult.error
        });
        
        if (stepResult.success) {
          stepResults.push(stepResult);
          const { greenApiService } = getServices();
          
          // 🚀 CRITICAL: Send ALL results immediately in order (location/poll/text/media)
          // Each step's output must be sent before moving to next step
          console.log(`🔍 [Multi-step] Step ${step.stepNumber} result:`, {
            hasLocation: !!(stepResult.latitude && stepResult.longitude),
            hasPoll: !!stepResult.poll,
            hasImage: !!stepResult.imageUrl,
            hasVideo: !!stepResult.videoUrl,
            hasAudio: !!stepResult.audioUrl,
            hasText: !!stepResult.text,
            toolsUsed: stepResult.toolsUsed
          });
          
          // 1. Send location (if exists)
          if (stepResult.latitude && stepResult.longitude) {
            try {
              console.log(`📍 [Multi-step] Sending location for step ${step.stepNumber}/${plan.steps.length}`);
              await greenApiService.sendLocation(chatId, parseFloat(stepResult.latitude), parseFloat(stepResult.longitude), '', '');
              if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
                await greenApiService.sendTextMessage(chatId, `📍 ${stepResult.locationInfo}`);
              }
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Location sent`);
            } catch (locationError) {
              console.error(`❌ [Multi-step] Failed to send location:`, locationError.message);
            }
          }
          
          // 2. Send poll (if exists)
          if (stepResult.poll) {
            try {
              const pollOptions = stepResult.poll.options.map(opt => ({ optionName: opt }));
              await greenApiService.sendPoll(chatId, stepResult.poll.question, pollOptions, false);
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Poll sent`);
            } catch (pollError) {
              console.error(`❌ [Multi-step] Failed to send poll:`, pollError.message);
            }
          }
          
          // 3. Send image (if exists)
          if (stepResult.imageUrl) {
            try {
              const fullImageUrl = stepResult.imageUrl.startsWith('http') 
                ? stepResult.imageUrl 
                : getStaticFileUrl(stepResult.imageUrl.replace('/static/', ''));
              const caption = stepResult.imageCaption || '';
              await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption);
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Image sent`);
            } catch (imageError) {
              console.error(`❌ [Multi-step] Failed to send image:`, imageError.message);
            }
          }
          
          // 4. Send video (if exists)
          if (stepResult.videoUrl) {
            try {
              const fullVideoUrl = stepResult.videoUrl.startsWith('http') 
                ? stepResult.videoUrl 
                : getStaticFileUrl(stepResult.videoUrl.replace('/static/', ''));
              await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '');
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Video sent`);
            } catch (videoError) {
              console.error(`❌ [Multi-step] Failed to send video:`, videoError.message);
            }
          }
          
          // 5. Send audio (if exists)
          if (stepResult.audioUrl) {
            try {
              const fullAudioUrl = stepResult.audioUrl.startsWith('http') 
                ? stepResult.audioUrl 
                : getStaticFileUrl(stepResult.audioUrl.replace('/static/', ''));
              await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
              console.log(`✅ [Multi-step] Step ${step.stepNumber}: Audio sent`);
            } catch (audioError) {
              console.error(`❌ [Multi-step] Failed to send audio:`, audioError.message);
            }
          }
          
          // 6. Send text (ONLY if no structured output was already sent)
          // CRITICAL: Avoid duplicate sending - if location/poll/media was sent, 
          // the text is usually just a description that's already been sent separately
          const hasStructuredOutput = stepResult.latitude || stepResult.poll || 
                                       stepResult.imageUrl || stepResult.videoUrl || 
                                       stepResult.audioUrl || stepResult.locationInfo;
          
          if (!hasStructuredOutput && stepResult.text && stepResult.text.trim()) {
            try {
              let cleanText = stepResult.text.trim().replace(/https?:\/\/[^\s]+/gi, '').trim();
              if (cleanText) {
                await greenApiService.sendTextMessage(chatId, cleanText);
                console.log(`✅ [Multi-step] Step ${step.stepNumber}: Text sent`);
              }
            } catch (textError) {
              console.error(`❌ [Multi-step] Failed to send text:`, textError.message);
            }
          } else if (hasStructuredOutput) {
            console.log(`⏭️ [Multi-step] Step ${step.stepNumber}: Skipping text - structured output already sent`);
          }
          
          // ✅ CRITICAL: ALL results for this step have been sent and awaited
          // All async operations (sendLocation, sendPoll, sendFileByUrl, sendTextMessage) have completed
          // The loop will now continue to the next iteration, where the Ack will be sent
          console.log(`✅ [Multi-step] Step ${step.stepNumber}/${plan.steps.length} completed and ALL results sent and delivered: ${stepResult.toolsUsed?.join(', ') || 'text only'}`);
          
          // At this point, all messages for this step have been sent to WhatsApp
          // The next iteration will start, and the Ack for the next step will be sent
        } else {
          // ❌ Step failed - send error to user
          console.error(`❌ [Agent] Step ${step.stepNumber}/${plan.steps.length} failed:`, stepResult.error);
          
          if (stepResult.error) {
            try {
              const { greenApiService } = getServices();
              // Send error message to user (as-is, as per rule #2)
              const errorMessage = stepResult.error.toString();
              await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`);
              console.log(`📤 [Multi-step] Step ${step.stepNumber}: Error sent to user`);
            } catch (errorSendError) {
              console.error(`❌ [Multi-step] Failed to send error message:`, errorSendError.message);
            }
          }
          
          // Continue with remaining steps even if one fails
        }
      } catch (stepError) {
        // ❌ Step execution threw an exception - send error to user
        console.error(`❌ [Agent] Error executing step ${step.stepNumber}:`, stepError.message);
        
        try {
          const { greenApiService } = getServices();
          // Send error message to user (as-is, as per rule #2)
          const errorMessage = stepError.message || stepError.toString();
          await greenApiService.sendTextMessage(chatId, `❌ שגיאה בביצוע שלב ${step.stepNumber}: ${errorMessage}`);
          console.log(`📤 [Multi-step] Step ${step.stepNumber}: Exception error sent to user`);
        } catch (errorSendError) {
          console.error(`❌ [Multi-step] Failed to send exception error:`, errorSendError.message);
        }
        
        // Continue with remaining steps
      }
    }
    
    // Clean and process final text for multi-step
    let finalText = accumulatedText.trim();
    
    // Basic cleanup: Remove URLs (just in case - should not happen with improved prompts)
    finalText = finalText.replace(/https?:\/\/[^\s]+/gi, '').trim();
    
    // Remove duplicate lines (if Step 1 and Step 2 both returned similar content)
    const lines = finalText.split('\n').filter(line => line.trim());
    const uniqueLines = [];
    const seen = new Set();
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueLines.push(line);
      }
    }
    finalText = uniqueLines.join('\n').trim();
    
    // ✅ All results (including media) were already sent immediately after each step
    // No need to send anything at the end
    
    console.log(`🏁 [Agent] Multi-step execution completed: ${stepResults.length}/${plan.steps.length} steps successful`);
    console.log(`📦 [Agent] Returning: ${finalText.length} chars text, image: ${!!finalAssets.imageUrl}, multiStep: true`);
    console.log(`📝 [Agent] Final text preview: "${finalText.substring(0, 100)}..."`);
    
    return {
      success: true,
      text: finalText,
      ...finalAssets,
      toolsUsed: stepResults.flatMap(r => r.toolsUsed || []),
      iterations: stepResults.reduce((sum, r) => sum + (r.iterations || 0), 0),
      multiStep: true,
      stepsCompleted: stepResults.length,
      totalSteps: plan.steps.length,
      // Mark that results were already sent immediately (don't resend in whatsappRoutes)
      alreadySent: true
    };
  }
  
  // Continue with single-step execution if not multi-step
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
    // System prompt for the agent (Hebrew base with dynamic language instruction)
    // Build tools list dynamically from central registry
    const availableToolNames = getUserFacingTools()
      .map(t => t.name)
      .slice(0, 15) // Show first 15 tools
      .join(', ');
    
    const systemInstruction = `אתה עוזר AI אוטונומי עם גישה לכלים מתקדמים.
 
 **🌐 Language:** ${languageInstruction} - תשיב בשפה שבה המשתמש כתב!
  
 **כלים זמינים:** ${availableToolNames}, ועוד.
  
 **כללים קריטיים:**
 • אם image_url/video_url בפרומפט → השתמש בו ישירות (אל תקרא get_chat_history!)
 • הודעות מצוטטות + מדיה: שאלה → analyze_image, עריכה → edit_image (לא retry!)
 • **לינקים/קישורים - חובה להשתמש ב-search_web!**
   - "שלח לי לינק", "send me link", "קישור ל-X" → search_web (כלי מחובר ל-Google Search!)
   - אסור לומר "אין לי אפשרות לשלוח לינקים" - יש לך search_web!
   - search_web מחזיר לינקים אמיתיים ועדכניים מ-Google
 • **אודיו/קול - CRITICAL: אל תיצור אודיו/קול אלא אם כן המשתמש מבקש במפורש!**
   - "ספר בדיחה" / "tell joke" → טקסט בלבד (לא text_to_speech!)
   - "תרגם ל-X ואמור" / "say in English" / "אמור ב-Y" → translate_and_speak (כן!)
   - "תשמיע לי" / "תקרא בקול" / "voice" → text_to_speech או translate_and_speak (כן!)
   - **אם המשתמש לא אמר "אמור", "תשמיע", "voice", "say" - אל תיצור אודיו!**
 • "אמור X ב-Y" → translate_and_speak (לא translate_text!)
 • create_music: ליצירת שירים חדשים | search_web: למציאת שירים קיימים/לינקים
 • תמיד ציין provider: create_image({provider: "gemini"}), create_video({provider: "kling"})
 • send_location: region הוא **אופציונלי** - ציין רק אם יש אזור ספציפי
 • אם tool נכשל → retry_with_different_provider (אל תקרא לאותו tool שוב!)
 • Multi-step: אם רואה "Step X/Y" → התמקד רק בשלב הזה`;

  // 🧠 Context for tool execution (load previous context if enabled)
  let context = {
    chatId,
    previousToolResults: {},
    toolCalls: [],
    generatedAssets: {
      images: [],
      videos: [],
      audio: [],
      polls: []
    },
    lastCommand: options.lastCommand || null,
    originalInput: options.input || null,
    suppressFinalResponse: false,
    expectedMediaType: null
  };
  
  // Load previous context if context memory is enabled (from DB)
  if (agentConfig.contextMemoryEnabled) {
    const previousContext = await conversationManager.getAgentContext(chatId);
    if (previousContext) {
      console.log(`🧠 [Agent Context] Loaded previous context from DB with ${previousContext.toolCalls.length} tool calls`);
      context = {
        ...context,
        toolCalls: previousContext.toolCalls || [],
        generatedAssets: previousContext.generatedAssets || context.generatedAssets
      };
    } else {
      console.log(`🧠 [Agent Context] No previous context found in DB (starting fresh)`);
    }
  }
  
  // Conversation history for the agent
  const chat = model.startChat({
    history: [],
    tools: [{ functionDeclarations }],
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }]
    }
  });
  
  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async () => {
    // Single-step execution (multi-step is handled above with executeSingleStep loop)
    let response = await chat.sendMessage(prompt);
    let iterationCount = 0;
    
    // Agent loop - continue until we get a final text response
    while (iterationCount < maxIterations) {
    iterationCount++;
    console.log(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);
    
    const result = response.response;
    
    // Check if Gemini wants to call a function
    const functionCalls = result.functionCalls();
    
    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls in this iteration
      let text = result.text();
      
      // 🧹 CRITICAL: Clean thinking patterns before sending to user
      text = cleanThinkingPatterns(text);
      
      // No continuation needed - this is the final answer
      console.log(`✅ [Agent] Completed in ${iterationCount} iterations`);
      
      // 🧠 Save context for future agent calls if enabled (to DB)
      if (agentConfig.contextMemoryEnabled) {
        await conversationManager.saveAgentContext(chatId, {
          toolCalls: context.toolCalls,
          generatedAssets: context.generatedAssets
        });
        console.log(`🧠 [Agent Context] Saved context to DB with ${context.toolCalls.length} tool calls`);
      }
      
      // 🎨 Extract latest generated media to send to user
      console.log(`🔍 [Agent] Assets: ${context.generatedAssets.images.length} images, ${context.generatedAssets.videos.length} videos, ${context.generatedAssets.audio.length} audio`);
      
      const latestImageAsset = context.generatedAssets.images.length > 0 
        ? context.generatedAssets.images[context.generatedAssets.images.length - 1]
        : null;
      const latestVideoAsset = context.generatedAssets.videos.length > 0 
        ? context.generatedAssets.videos[context.generatedAssets.videos.length - 1]
        : null;
      const latestAudioAsset = context.generatedAssets.audio && context.generatedAssets.audio.length > 0 
        ? context.generatedAssets.audio[context.generatedAssets.audio.length - 1]
        : null;
      const latestPollAsset = context.generatedAssets.polls && context.generatedAssets.polls.length > 0 
        ? context.generatedAssets.polls[context.generatedAssets.polls.length - 1]
        : null;
      
      // Check if send_location was called - extract latitude/longitude from tool result
      const locationResult = context.previousToolResults['send_location'];
      const latitude = locationResult?.latitude || null;
      const longitude = locationResult?.longitude || null;
      const locationInfo = locationResult?.locationInfo || locationResult?.data || null;
      
      console.log(`🔍 [Agent] Extracted assets - Image: ${latestImageAsset?.url}, Video: ${latestVideoAsset?.url}, Audio: ${latestAudioAsset?.url}, Poll: ${latestPollAsset?.question}, Location: ${latitude}, ${longitude}`);
      
      const finalText = context.suppressFinalResponse ? '' : text;
      
      return {
        success: true,
        text: finalText,
        imageUrl: latestImageAsset?.url || null,
        imageCaption: latestImageAsset?.caption || '',
        videoUrl: latestVideoAsset?.url || null,
        audioUrl: latestAudioAsset?.url || null,
        poll: latestPollAsset || null,
        latitude: latitude,
        longitude: longitude,
        locationInfo: locationInfo,
        toolsUsed: Object.keys(context.previousToolResults),
        iterations: iterationCount,
        toolCalls: context.toolCalls,
        toolResults: context.previousToolResults,
        multiStep: false,
        alreadySent: false
      };
    }
    
    // Execute function calls (in parallel for better performance)
    console.log(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);
    
    // 📢 Send Ack message to user before executing tools (includes provider info)
    await sendToolAckMessage(chatId, functionCalls);
    
    // Execute all tools in parallel (they're independent)
    const toolPromises = functionCalls.map(async (call) => {
      const toolName = call.name;
      const toolArgs = call.args;
      
      console.log(`   → Calling tool: ${toolName} with args:`, toolArgs);
      
      const tool = agentTools[toolName];
      if (!tool) {
        console.error(`❌ Unknown tool: ${toolName}`);
        return {
          functionResponse: {
            name: toolName,
            response: {
              success: false,
              error: `Unknown tool: ${toolName}`
            }
          }
        };
      }
      
      try {
        // Execute the tool
        const toolResult = await tool.execute(toolArgs, context);
        
        // Save result for future tool calls
        context.previousToolResults[toolName] = toolResult;
        
        // Immediately surface raw errors to the user (as-is), even if fallback will follow
        if (toolResult && toolResult.error && context.chatId) {
          try {
            const { greenApiService } = getServices();
            const errorMessage = toolResult.error.startsWith('❌')
              ? toolResult.error
              : `❌ ${toolResult.error}`;
            await greenApiService.sendTextMessage(context.chatId, errorMessage);
          } catch (notifyError) {
            console.error(`❌ Failed to notify user about error: ${notifyError.message}`);
          }
        }
        
        if (toolResult && toolResult.suppressFinalResponse) {
          context.suppressFinalResponse = true;
        }
        
        // 🧠 Track tool call for context memory
        context.toolCalls.push({
          tool: toolName,
          args: toolArgs,
          success: toolResult.success !== false,
          timestamp: Date.now()
        });
        
        // 🧠 Track generated assets for context memory
        if (toolResult.imageUrl) {
          console.log(`✅ [Agent] Tracking image: ${toolResult.imageUrl}, caption: ${toolResult.caption || '(none)'}`);
          context.generatedAssets.images.push({
            url: toolResult.imageUrl,
            caption: toolResult.caption || '',
            prompt: toolArgs.prompt,
            provider: toolResult.provider || toolArgs.provider,
            timestamp: Date.now()
          });
        } else {
          console.log(`⚠️ [Agent] No imageUrl in toolResult for ${toolName}`);
        }
        if (toolResult.videoUrl) {
          context.generatedAssets.videos.push({
            url: toolResult.videoUrl,
            prompt: toolArgs.prompt,
            timestamp: Date.now()
          });
        }
        if (toolResult.audioUrl) {
          if (!context.generatedAssets.audio) context.generatedAssets.audio = [];
          context.generatedAssets.audio.push({
            url: toolResult.audioUrl,
            prompt: toolArgs.prompt || toolArgs.text_to_speak || toolArgs.text,
            timestamp: Date.now()
          });
        }
        if (toolResult.poll) {
          if (!context.generatedAssets.polls) context.generatedAssets.polls = [];
          context.generatedAssets.polls.push({
            question: toolResult.poll.question,
            options: toolResult.poll.options,
            topic: toolArgs.topic,
            timestamp: Date.now()
          });
        }
        
        return {
          functionResponse: {
            name: toolName,
            response: toolResult
          }
        };
      } catch (error) {
        console.error(`❌ Error executing tool ${toolName}:`, error);
        
        // 🧠 Track failed tool call
        context.toolCalls.push({
          tool: toolName,
          args: toolArgs,
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
        
        return {
          functionResponse: {
            name: toolName,
            response: {
              success: false,
              error: `Tool execution failed: ${error.message}`
            }
          }
        };
      }
    });
    
    // Wait for all tools to complete
    const functionResponses = await Promise.all(toolPromises);
    
    // 🧠 Enrich function responses with context for better multi-step handling
    // Add execution context directly IN the response object (not as separate text - that causes Gemini errors)
    const enrichedResponses = functionResponses.map(fr => {
      const result = fr.functionResponse.response;
      
      // Add step completion indicators to help Gemini track progress
      // Result processed successfully
      
      return fr;
    });
    
    // Log execution summary for debugging
    if (functionResponses.length > 0) {
      const successCount = functionResponses.filter(fr => fr.functionResponse.response.success !== false).length;
      const failCount = functionResponses.length - successCount;
      console.log(`📊 [Agent] Tool execution: ${successCount} succeeded, ${failCount} failed`);
    }
    
    // Send function responses back to Gemini
    // CRITICAL: Do NOT add text parts here - Gemini doesn't allow mixing FunctionResponse with text
    response = await chat.sendMessage(enrichedResponses);
  }
  
    // Max iterations reached
    console.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);
    return {
      success: false,
      error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
      toolsUsed: Object.keys(context.previousToolResults),
      iterations: iterationCount,
      toolCalls: context.toolCalls,
      toolResults: context.previousToolResults,
      multiStep: false,
      alreadySent: false
    };
  };
  
  // ⏱️ Execute agent with timeout
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Agent timeout')), agentConfig.timeoutMs)
  );
  
  try {
    return await Promise.race([agentExecution(), timeoutPromise]);
  } catch (error) {
    if (error.message === 'Agent timeout') {
      console.error(`⏱️ [Agent] Timeout after ${agentConfig.timeoutMs}ms`);
      return {
        success: false,
        error: `⏱️ הפעולה ארכה יותר מדי. נסה בקשה פשוטה יותר או נסה שוב מאוחר יותר.`,
        toolsUsed: Object.keys(context.previousToolResults),
        timeout: true,
        toolCalls: context.toolCalls,
        toolResults: context.previousToolResults,
        multiStep: false,
        alreadySent: false
      };
    }
    throw error;
  }
}

// NOTE: shouldUseAgent was removed - all requests now go through routeToAgent
// which uses LLM-based planning and execution (no regex/heuristic intent detection)
// The agent is now the PRIMARY routing mechanism, handling all intent detection via LLM

module.exports = {
  executeAgentQuery
};


