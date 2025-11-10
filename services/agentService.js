const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const conversationManager = require('./conversationManager');
const { cleanThinkingPatterns } = require('./geminiService');
const locationService = require('./locationService');

const execAsync = promisify(exec);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to format provider names nicely
const formatProviderName = (provider) => {
  const providerNames = {
    'gemini': 'Gemini',
    'openai': 'OpenAI',
    'grok': 'Grok',
    'veo3': 'Veo 3',
    'veo-3': 'Veo 3',
    'veo': 'Veo 3',
    'sora': 'Sora 2',
    'sora-2': 'Sora 2',
    'sora2': 'Sora 2',
    'sora-pro': 'Sora 2 Pro',
    'sora-2-pro': 'Sora 2 Pro',
    'kling': 'Kling',
    'runway': 'Runway',
    'suno': 'Suno'
  };
  return providerNames[provider?.toLowerCase()] || provider;
};

// Lazy-loaded services to avoid circular dependencies and improve startup time
let geminiService, openaiService, grokService, greenApiService;
const getServices = () => {
  if (!geminiService) geminiService = require('./geminiService');
  if (!openaiService) openaiService = require('./openaiService');
  if (!grokService) grokService = require('./grokService');
  if (!greenApiService) greenApiService = require('./greenApiService');
// Utility: get audio duration via ffprobe (mirrors whatsappRoutes implementation)
const getAudioDuration = async (audioBuffer) => {
  try {
    const tempFilePath = path.join(os.tmpdir(), `agent_audio_check_${Date.now()}.ogg`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFilePath}"`
      );
      const duration = parseFloat(stdout.trim());
      fs.unlinkSync(tempFilePath);
      console.log(`⏱️ [Agent] Audio duration: ${duration.toFixed(2)} seconds`);
      return duration;
    } catch (err) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error(`❌ [Agent] Could not get audio duration: ${err.message}`);
      return 0;
    }
  } catch (err) {
    console.error(`❌ [Agent] Error in getAudioDuration: ${err.message}`);
    return 0;
  }
};

  return { geminiService, openaiService, grokService, greenApiService };
};

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
 */

/**
 * Utility functions for smart retry strategies
 */

/**
 * Simplify a complex prompt by removing unnecessary details
 * @param {string} prompt - Original prompt
 * @returns {string} - Simplified prompt
 */
function simplifyPrompt(prompt) {
  if (!prompt) return prompt;
  
  // Remove excessive details, adjectives, and complex descriptions
  let simplified = prompt;
  
  // Remove multiple adjectives (keep only core nouns/verbs)
  // "beautiful, stunning, amazing cat" → "cat"
  simplified = simplified.replace(/(\w+,\s*){2,}(\w+)\s+(\w+)/gi, '$3');
  
  // Remove very specific style requests
  simplified = simplified.replace(/\b(in the style of|בסגנון|כמו|like)\s+.+?(,|\.|$)/gi, '');
  
  // Remove detailed background descriptions
  simplified = simplified.replace(/\b(with (a |an )?background|ברקע|עם רקע)\s+.+?(,|\.|$)/gi, '');
  
  // Remove complex lighting/atmosphere descriptions
  simplified = simplified.replace(/\b(lighting|תאורה|אווירה|atmosphere):?\s+.+?(,|\.|$)/gi, '');
  
  // Trim and clean up
  simplified = simplified.trim().replace(/\s+/g, ' ');
  
  // If we removed too much, return original
  if (simplified.length < 10) return prompt;
  
  return simplified;
}

/**
 * Check if a prompt is too complex and should be split
 * @param {string} prompt - Prompt to check
 * @returns {boolean} - True if should split
 */
function shouldSplitTask(prompt) {
  if (!prompt) return false;
  
  // Check for multiple independent requests
  const hasMultipleRequests = /\bו(גם|אז|אחר כך|לאחר מכן)\b/gi.test(prompt) || 
                              /\b(and then|after that|also|plus)\b/gi.test(prompt);
  
  // Check for conditional logic
  const hasConditional = /\b(אם|if|when|כש|במידה)\b/gi.test(prompt);
  
  // Check for multiple steps explicitly mentioned
  const hasSteps = /\b(קודם|ראשון|שני|שלישי|אחרון|first|second|third|last|step)\b/gi.test(prompt);
  
  // Check prompt length (very long prompts often need splitting)
  const isTooLong = prompt.length > 200;
  
  return (hasMultipleRequests || hasConditional || hasSteps) && isTooLong;
}

/**
 * Split a complex prompt into smaller subtasks
 * @param {string} prompt - Complex prompt
 * @returns {string[]} - Array of subtasks
 */
function splitTaskIntoSteps(prompt) {
  if (!prompt) return [prompt];
  
  const steps = [];
  
  // Try to split by explicit connectors
  const splitPatterns = [
    /\s+(ואז|ואחר כך|ולאחר מכן|וגם)\s+/gi,
    /\s+(and then|after that|afterwards|also)\s+/gi,
    /\.\s+/g  // Split by sentences
  ];
  
  let parts = [prompt];
  
  for (const pattern of splitPatterns) {
    if (pattern.test(prompt)) {
      parts = prompt.split(pattern).filter(p => p.trim().length > 10);
      break;
    }
  }
  
  // If we couldn't split intelligently, try to extract main concepts
  if (parts.length === 1 && prompt.length > 150) {
    // Extract main nouns/actions as separate steps
    const mainConcepts = prompt.match(/\b(צור|תצור|ערוך|תערוך|נתח|תנתח|הוסף|תוסיף|create|edit|analyze|add)\s+[^,\.]+/gi);
    
    if (mainConcepts && mainConcepts.length > 1) {
      return mainConcepts.map(c => c.trim());
    }
  }
  
  return parts.length > 1 ? parts.map(p => p.trim()) : [prompt];
}

/**
 * Make a prompt more generic by removing specific details
 * @param {string} prompt - Original prompt
 * @returns {string} - Generic version
 */
function makePromptMoreGeneric(prompt) {
  if (!prompt) return prompt;
  
  let generic = prompt;
  
  // Remove specific names/brands
  generic = generic.replace(/\b(של|מבית|by|from)\s+[A-Z][a-z]+\b/g, '');
  
  // Remove specific years/dates
  generic = generic.replace(/\b(מ?שנת|from|in)\s+(19|20)\d{2}\b/gi, '');
  
  // Remove very specific technical terms
  generic = generic.replace(/\b(resolution|רזולוציה|quality|איכות):\s*\d+[a-z]*/gi, '');
  
  // Remove specific color codes
  generic = generic.replace(/#[0-9A-Fa-f]{6}\b/g, 'color');
  
  // Simplify comparative language
  generic = generic.replace(/\b(very|extremely|super|incredibly|מאוד|סופר|במיוחד)\s+/gi, '');
  
  // Trim
  generic = generic.trim().replace(/\s+/g, ' ');
  
  return generic;
}

/**
 * Define available tools for the agent
 */
const agentTools = {
  // Tool 1: Get chat history
  get_chat_history: {
    declaration: {
      name: 'get_chat_history',
      description: 'קבל את היסטוריית ההודעות מהשיחה. השתמש בכלי הזה כשהמשתמש מתייחס להודעות קודמות, או כשאתה צריך קונטקסט נוסף מהשיחה.',
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

  // Tool 3: Search web
  search_web: {
    declaration: {
      name: 'search_web',
      description: 'חפש מידע באינטרנט. השתמש בכלי הזה כשאתה צריך מידע עדכני או מידע שאינו זמין בידע שלך.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'שאילתת החיפוש',
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
        
        // Strategy 3: Split into smaller tasks (for complex prompts)
        console.log(`📊 Strategy 3: Checking if task should be split...`);
        if (shouldSplitTask(args.original_prompt)) {
          const subtasks = splitTaskIntoSteps(args.original_prompt);
          console.log(`   → Split into ${subtasks.length} subtasks`);
          
          return {
            success: false,
            data: `הפרומפט מורכב מדי. אני מציע לפצל למשימות קטנות יותר:\n${subtasks.map((t, i) => `${i+1}. ${t}`).join('\n')}`,
            strategy_used: 'suggest_split',
            subtasks: subtasks
          };
        }
        
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
      description: 'נסה ליצור תמונה או וידאו עם ספק אחר אם הראשון נכשל או לא טוב. אל תשתמש בכלי הזה לפני שניסית ליצור!',
      parameters: {
        type: 'object',
        properties: {
          original_prompt: {
            type: 'string',
            description: 'הפרומפט המקורי ליצירה',
          },
          reason: {
            type: 'string',
            description: 'למה לנסות ספק אחר (לדוגמה: "התמונה לא טובה")',
          },
          task_type: {
            type: 'string',
            description: 'סוג המשימה: image או video',
            enum: ['image', 'video']
          },
          avoid_provider: {
            type: 'string',
            description: 'איזה ספק לא לנסות (למשל: kling, veo3, sora, gemini, openai, grok)',
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
        
        const { geminiService, openaiService, grokService } = getServices();
        const replicateService = require('./replicateService');
        
        let providers, displayProviders;
        
        if (taskType === 'video') {
          // Video: kling (grok) → veo3 (gemini) → sora (openai)
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
      description: 'המר תמונה מההיסטוריה לסרטון וידאו מונפש. צריך לקרוא קודם ל-get_chat_history לקבל URL של תמונה.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'URL של התמונה להמרה'
          },
          prompt: {
            type: 'string',
            description: 'הנחיות לאנימציה'
          },
          provider: {
            type: 'string',
            description: 'ספק להמרה',
            enum: ['veo3', 'sora', 'sora-pro', 'kling']
          }
        },
        required: ['image_url', 'prompt']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] image_to_video called`);
      
      try {
        const { geminiService, openaiService } = getServices();
        const replicateService = require('./replicateService');
        const provider = args.provider || 'kling';
        
        let result;
        if (provider === 'veo3') {
          result = await geminiService.generateVideoFromImageForWhatsApp(args.image_url, args.prompt);
        } else if (provider === 'sora' || provider === 'sora-pro') {
          const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
          result = await openaiService.generateVideoWithSoraFromImageForWhatsApp(args.image_url, args.prompt, model);
        } else {
          result = await replicateService.generateVideoFromImageForWhatsApp(args.image_url, args.prompt);
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
      description: 'נתח סרטון וידאו מההיסטוריה. צריך לקרוא קודם ל-get_chat_history לקבל URL של וידאו.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'URL של הוידאו לניתוח'
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
        const { geminiService } = getServices();
        
        const result = await geminiService.analyzeVideoWithText(args.video_url, args.question);
        
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
      description: 'צור שיר/מוזיקה עם מילים. משתמש ב-Suno AI.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'תיאור השיר, סגנון, נושא, או מילים'
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
      description: 'תמלל הקלטה קולית לטקסט (STT). השתמש כשהמשתמש מבקש "מה נאמר בהקלטה?", "תמלל את זה", "מה כתוב?" וכו\'. נדרש audioUrl בהודעה המצוטטת.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה לתמלול. חלץ מהמבנה "[audioUrl: URL]" ב-prompt.'
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
      description: 'צור סקר עם שאלה ותשובות יצירתיות.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'נושא הסקר'
          }
        },
        required: ['topic']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] create_poll called`);
      
      try {
        const { geminiService } = getServices();
        
        const pollData = await geminiService.generateCreativePoll(args.topic);
        
        if (pollData.error) {
          return {
            success: false,
            error: `יצירת סקר נכשלה: ${pollData.error}`
          };
        }
        
        return {
          success: true,
          data: `✅ הסקר נוצר!`,
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
      description: 'שלח מיקום אקראי מהעולם עם מידע על המקום. אפשר לציין אזור ספציפי (עיר, מדינה, יבשת).',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            description: 'אזור אופציונלי לבחירת מיקום (למשל: "תל אביב", "ניו יורק", "יפן", "אירופה", "אסיה", וכו\'). אם לא מצוין - מיקום אקראי מהעולם.'
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] send_location called with region: ${args.region || 'none'}`);
      const { greenApiService } = getServices();

      try {
        // Use region from args if provided, otherwise try to extract from user prompt
        const regionToSearch = args.region || context?.originalInput?.userText || context?.normalized?.text || '';
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
      description: 'ערוך תמונה קיימת מההיסטוריה. צריך לקרוא קודם ל-get_chat_history לקבל URL של תמונה.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'URL של התמונה לעריכה'
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
        const { openaiService, geminiService } = getServices();
        const service = args.service || 'openai'; // OpenAI is better for editing
        
        let result;
        if (service === 'openai') {
          result = await openaiService.editImageForWhatsApp(args.image_url, args.edit_instruction);
        } else {
          result = await geminiService.editImageForWhatsApp(args.image_url, args.edit_instruction);
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
      description: 'ערוך סרטון וידאו קיים מההיסטוריה. צריך לקרוא קודם ל-get_chat_history לקבל URL של וידאו.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'URL של הוידאו לעריכה'
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
        const replicateService = require('./replicateService');
        
        const result = await replicateService.generateVideoFromVideoForWhatsApp(args.video_url, args.edit_instruction);
        
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
      description: 'שבט קול מהקלטה קיימת והשתמש בו כדי לדבר טקסט חדש. צריך URL של הקלטה (מ-get_chat_history).',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה לשיבוט הקול'
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
      description: 'צור מיקס אודיו יצירתי עם אפקטים ומוזיקה מהקלטה קיימת. צריך URL של הקלטה.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'URL של ההקלטה למיקס'
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

/**
 * Map tool names to Hebrew Ack messages
 */
const TOOL_ACK_MESSAGES = {
  // Creation tools
  'create_image': 'יוצר תמונה... 🎨',
  'create_video': 'יוצר וידאו... 🎬',
  'image_to_video': 'ממיר תמונה לוידאו מונפש... 🎞️',
  'create_music': 'יוצר מוזיקה... 🎵',
  'text_to_speech': 'ממיר לדיבור... 🎤',
  
  // Analysis tools
  'analyze_image_from_history': 'מנתח תמונה... 🔍',
  'analyze_video': 'מנתח וידאו... 🎥',
  
  // Edit tools
  'edit_image': 'עורך תמונה... ✏️',
  'edit_video': 'עורך וידאו... 🎞️',
  
  // Info tools
  'search_web': 'מחפש באינטרנט... 🔎',
  'get_chat_history': 'שולף היסטוריה... 📜',
  'get_long_term_memory': 'בודק העדפות... 💾',
  'translate_text': 'מתרגם... 🌐',
  'translate_and_speak': 'מתרגם והופך לדיבור... 🌐🗣️',
  'transcribe_audio': 'מתמלל הקלטה... 🎤📝',
  'chat_summary': 'מסכם שיחה... 📝',
  
  // WhatsApp tools
  'create_poll': 'יוצר סקר... 📊',
  'send_location': '',
  'create_group': 'יוצר קבוצה... 👥',
  
  // Audio tools
  'voice_clone_and_speak': 'משכפל קול... 🎙️',
  'creative_audio_mix': 'מערבב אודיו... 🎧',
  
  // Meta-tools
  'history_aware_create': 'יוצר עם context... 🧠',
  'create_with_memory': 'יוצר לפי העדפות... 💡',
  'search_and_create': 'מחפש ויוצר... 🔍➡️🎨',
  'create_and_analyze': 'יוצר ומנתח... 🎨➡️🔍',
  'analyze_and_edit': 'מנתח ועורך... 🔍➡️✏️',
  'smart_execute_with_fallback': 'מנסה עם __PROVIDER__... 🔄',
  'retry_with_different_provider': 'מנסה עם __PROVIDER__... 🔁',
  'retry_last_command': 'חוזר על פקודה קודמת... ↩️',
  
  // Preferences
  'save_user_preference': 'שומר העדפה... 💾'
};

const VIDEO_PROVIDER_FALLBACK_ORDER = ['grok', 'gemini', 'openai'];
const VIDEO_PROVIDER_DISPLAY_MAP = {
  grok: 'kling',
  gemini: 'veo3',
  openai: 'sora-2'
};

const normalizeProviderKey = (provider) => {
  if (!provider) return null;
  const key = String(provider).toLowerCase();
  const mapping = {
    kling: 'grok',
    'kling-text-to-video': 'grok',
    grok: 'grok',
    veo3: 'gemini',
    veo: 'gemini',
    gemini: 'gemini',
    google: 'gemini',
    'google-veo3': 'gemini',
    sora: 'openai',
    'sora-2': 'openai',
    'sora2': 'openai',
    'sora-2-pro': 'openai',
    'sora-pro': 'openai',
    openai: 'openai'
  };
  return mapping[key] || key;
};

const applyProviderToMessage = (message, providerName) => {
  if (message.includes('__PROVIDER__')) {
    return message.replace('__PROVIDER__', providerName || 'ספק אחר');
  }
  if (providerName) {
    if (message.includes('...')) {
      return message.replace('...', ` עם ${providerName}...`).replace('  ', ' ');
    }
    return `${message} (${providerName})`;
  }
  return message;
};

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
      let baseMessage = TOOL_ACK_MESSAGES[toolName] || `מבצע: ${toolName}... ⚙️`;
      
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
      
      if (!provider && toolName === 'retry_with_different_provider') {
        const avoidRaw = call.args?.avoid_provider;
        const avoidProvider = normalizeProviderKey(avoidRaw) || 'gemini';
        const providerSequence = VIDEO_PROVIDER_FALLBACK_ORDER;
        const avoidIndex = providerSequence.indexOf(avoidProvider);
        if (avoidIndex === -1) {
          provider = providerSequence[0];
        } else {
          provider = providerSequence[(avoidIndex + 1) % providerSequence.length];
        }
      }
      
      let providerDisplayKey = providerRaw || provider;
      const isVideoTask = call.args?.task_type === 'video_creation' || toolName === 'create_video';
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

/**
 * Execute an agent query with autonomous tool usage
 * @param {string} prompt - User's question/request
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Additional options
 * @returns {Object} - Response with text and tool usage info
 */
async function executeAgentQuery(prompt, chatId, options = {}) {
  console.log(`🤖 [Agent] Starting autonomous query: "${prompt.substring(0, 100)}..."`);
  
  // ⚙️ Configuration: Load from env or use defaults
  const agentConfig = {
    model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 5,
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 180000, // 3 minutes for complex multi-step tasks
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  };
  
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
  // System prompt for the agent (Hebrew - optimized and consistent)
  const systemInstruction = `אתה עוזר AI אוטונומי עם גישה לכלים מתקדמים.

🚫 אסור לחלוטין:
• לכתוב את תהליך החשיבה שלך
• לכתוב באנגלית ("My thoughts", "I need to", "Let me")
• לכתוב רשימות של מה אתה עושה
• רק תשובה סופית בעברית!

🛠️ הכלים שלך (30 כלים!):

📚 מידע:
• get_chat_history - היסטוריית שיחה (חובה לשאלות context!)
• save_user_preference - שמור העדפות משתמש
• get_long_term_memory - קרא העדפות משתמש
• search_web - מידע מהאינטרנט
• chat_summary - סיכום השיחה
• translate_text - תרגום (22 שפות) → מחזיר טקסט בלבד!
• translate_and_speak - תרגום + דיבור → מחזיר הודעה קולית!
• transcribe_audio - תמלול אודיו לטקסט (STT) → מצוטט הקלטה

🎨 יצירה:
• create_image - תמונות (gemini/openai/grok)
• create_video - וידאו (veo3/sora/kling)
• image_to_video - תמונה→וידאו מונפש
• create_music - שירים/מוזיקה (Suno)
• text_to_speech - טקסט→דיבור (22 שפות)

🔍 ניתוח:
• analyze_image_from_history - ניתוח תמונות
• analyze_video - ניתוח וידאו

✏️ עריכה:
• edit_image - עריכת תמונות (openai/gemini)
• edit_video - עריכת וידאו (runway)

🎤 אודיו מתקדם:
• voice_clone_and_speak - שיבוט קול + דיבור
• creative_audio_mix - מיקס יצירתי עם אפקטים

👥 WhatsApp:
• create_poll - יצירת סקרים
• send_location - מיקום אקראי (תומך באזורים: ערים, מדינות, יבשות!)
• create_group - יצירת קבוצות (מורשים בלבד)

🎯 Meta-Tools:
• history_aware_create - יצירה + היסטוריה
• create_with_memory - יצירה + העדפות
• search_and_create - חיפוש + יצירה
• create_and_analyze - יצירה + ניתוח
• analyze_and_edit - ניתוח + עריכה
• smart_execute_with_fallback - fallback חכם
• retry_with_different_provider - ניסיון חוזר

🔄 Retry:
• retry_last_command - חזור על פקודה קודמת (עם אפשרות לשנות ספק)

💡 כללים קריטיים:

📜 **מתי לגשת להיסטוריה (חובה!):**
• "מה אמרתי קודם" / "על מה דיברנו" → get_chat_history
• "לפי התמונה שהעליתי" / "כמו בהודעה הקודמת" → get_chat_history
• "בהמשך לשיחה" / "כפי שכתבתי" → get_chat_history
• כל שאלה שדורשת context קודם → **תמיד** קרא get_chat_history תחילה!

💾 **מתי לשמור העדפות:**
• "תמיד צור עם X" / "אני מעדיף Y" → save_user_preference
• "זכור ש..." / "בפעם הבאה" → save_user_preference
• "אני לא אוהב X" / "אני אוהב Y" → save_user_preference

🗣️ **מתי להשתמש ב-translate_and_speak (CRITICAL!):**
• "אמור X ביפנית" / "אמור X ב-Y" → translate_and_speak (לא translate_text!)
• "תרגם ל-X ואמור" / "קרא ביפנית" → translate_and_speak
• "הקרא את זה בערבית" / "say in English" → translate_and_speak
• **אם המשתמש אומר "אמור" עם שפה - זה תמיד הודעה קולית!**
• **translate_text מחזיר רק טקסט. translate_and_speak מחזיר אודיו.**
• **אל תפצל translate_and_speak ל-translate_text + text_to_speech!** זה כלי אחד שעושה הכל.

🔁 **מתי להשתמש ב-retry וב-fallback:**
• "נסה שוב" / "שוב" / "עוד פעם" → retry_last_command
• "עם OpenAI" / "עם Gemini" → retry_last_command (עם provider_override)
• "אבל עם X" / "תקן ל-Y" → retry_last_command (עם modifications)
• **אם create_video נכשל עם Kling** → retry_with_different_provider (task_type: 'video', avoid_provider: 'kling')
• **אם create_image נכשל** → retry_with_different_provider או smart_execute_with_fallback
• **סדר fallback לוידאו: Kling → Veo3 → Sora2** (אל תשתמש ב-Gemini לוידאו!)

🧠 **פקודה אחרונה זמינה עבורך:**
• בכל פנייה חדשה מוצגת "[פקודה קודמת]" עם הפרטים הקריטיים (פרומפט, תרגום, ספק, תוצאות).
• השתמש בזה כדי לענות טבעי להמשך שיחה ("ועכשיו בקול", "הפעם בתמונה", "עם ספק אחר").
• בקשות כמו "תגיד את זה בקול", "ועכשיו בקול", "תשמיע לי" → נצל את המידע הקודם והפעל translate_and_speak או text_to_speech בהתאם.
• אל תשמור retry_last_command כפקודה האחרונה – הפקודה המקורית נשמרת אוטומטית.

🎯 **בחירת ספק (CRITICAL!):**
• **תמיד** ציין provider כשקורא ל-create_image/create_video/edit_image/edit_video!
• אם המשתמש לא ציין ספק - תבחר בעצמך:
  - תמונות: provider='gemini' (ברירת מחדל)
  - וידאו: provider='kling' (ברירת מחדל)
  - עריכת תמונות: provider='openai' (ברירת מחדל)
• דוגמאות:
  ✅ create_image({prompt: "חתול", provider: "gemini"})
  ✅ create_video({prompt: "נחשול", provider: "kling"})
  ❌ create_image({prompt: "חתול"}) ← חסר provider!

⚙️ **כללים כלליים:**
• תשיב בעברית, טבעי ונעים
• בשאלות מורכבות - פצל למספר שלבים קטנים

🚨 **טיפול בשגיאות (CRITICAL!):**
• אם tool נכשל - **אל תקרא לאותו tool שוב בשום מקרה!**
• **אל תפצל tool כושל למספר tools אחרים!** (למשל: אם translate_and_speak נכשל → אסור translate_text + text_to_speech)
• **במקום לקרוא שוב ל-tool הכושל, עשה כך:**
  ✅ אם זו בעיית ספק (create_image/create_video/edit_image נכשל):
     → השתמש ב-retry_with_different_provider(original_tool_name, new_provider, args)
  ✅ אם זו בעיה כללית או אתה לא בטוח:
     → השתמש ב-smart_execute_with_fallback(original_tool_name, args, failed_providers)
• **דוגמה לא נכונה:**
  ❌ create_image({prompt: "...", provider: "gemini"}) נכשל
  ❌ [קורא שוב] create_image({prompt: "...", provider: "openai"})
• **דוגמה נכונה:**
  ✅ create_image({prompt: "...", provider: "gemini"}) נכשל
  ✅ [קורא] retry_with_different_provider({original_tool_name: "create_image", new_provider: "openai", args: {...}})
• **ספר תמיד למשתמש מה השגיאה** לפני שאתה מנסה fallback!
• דוגמה: "❌ Gemini נכשל: [השגיאה]." ← תמיד שלח את זה למשתמש!
• **אל תסתיר שגיאות** - המשתמש צריך לדעת מה קרה!
• אם כל הניסיונות נכשלו - הסבר למשתמש מה ניסית ולמה זה לא עבד`;


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
    tools: [{ functionDeclarations }]
  });
  
  // ⏱️ Wrap entire agent execution with timeout
  const agentExecution = async () => {
    // Include system instruction in the first message
    const fullPrompt = `${systemInstruction}\n\n---\n\nUser Request: ${prompt}`;
    let response = await chat.sendMessage(fullPrompt);
    let iterationCount = 0;
    
    // Agent loop - continue until we get a final text response
    while (iterationCount < maxIterations) {
    iterationCount++;
    console.log(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);
    
    const result = response.response;
    
    // Check if Gemini wants to call a function
    const functionCalls = result.functionCalls();
    
    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls - we have a final answer
      let text = result.text();
      
      // 🧹 CRITICAL: Clean thinking patterns before sending to user!
      text = cleanThinkingPatterns(text);
      
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
      console.log(`🔍 [Agent] context.generatedAssets:`, JSON.stringify(context.generatedAssets, null, 2));
      
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
        toolResults: context.previousToolResults
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
        
        // DEBUG: Log what the tool returned
        console.log(`🔍 [Agent] ${toolName} returned:`, JSON.stringify(toolResult, null, 2));
        
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
    
    // Send function responses back to Gemini
    response = await chat.sendMessage(functionResponses);
  }
  
    // Max iterations reached
    console.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);
    return {
      success: false,
      error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
      toolsUsed: Object.keys(context.previousToolResults),
      iterations: iterationCount,
      toolCalls: context.toolCalls,
      toolResults: context.previousToolResults
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
        toolResults: context.previousToolResults
      };
    }
    throw error;
  }
}

/**
 * Check if a query should use the agent (vs regular routing)
 * @param {string} prompt - User's prompt
 * @param {Object} input - Normalized input
 * @returns {boolean} - True if should use agent
 */
function shouldUseAgent(prompt, input) {
  // Use agent for:
  // • Chat history/previous messages
  // • Multi-step requests (create + analyze)
  // • Conditional fallback ("if fails, try X")
  // • Complex retry requests
  
  const agentPatterns = [
    // History (Hebrew + English)
    /מה\s+(אמרתי|אמרת|כתבתי|כתבת|שלחתי|שלחת|דיברתי|דיברת)|על\s+מה\s+(דיברנו|עסקנו|שוחחנו)|(אילו|איזה|מה|כמה)\s+(תמונות|וידאו|הודעות)\s+(היו|נשלחו|כאן|פה)?|(תראה|הראה)\s+(לי)?\s+מה\s+(שלחתי|היה)|מה\s+(היה|קרה|עבר)\s+(כאן|פה|בשיחה)/i,
    /(ב|מ|על)(ה)?(תמונה|וידאו|הקלטה|הודעה|שיחה)\s+(האחרונה|הקודמת|מקודם)/i,
    /what\s+(did\s+)?(I|we|you)\s+(say|write|mention|talk|discuss)|what\s+(images?|videos?|messages?)\s+(were|was)?\s+(sent|shared|here)?|(show|display)\s+me\s+what\s+(I|we|you)\s+(sent|shared)|about\s+the\s+(image|video|audio|message|conversation)|in\s+the\s+(previous|last|recent)\s+(message|conversation)/i,
    
    // Multi-step (Hebrew + English)
    // ⚠️ IMPORTANT: Exclude simple "צור" verbs without multi-step indicators (e.g., "צור סקר" alone)
    // Only match patterns with explicit multi-step indicators: "ו" (and), "אם" (if), "ואז" (then)
    // This prevents single "צור X" commands from being caught by this pattern
    /(צור|נתח|חפש).+(ו|אם|ואז).+(נתח|בדוק|ערוך|שפר|תן|צור|ספר)/i,
    /create.+(and|then).+(analyze|check|edit|improve)|analyze.+(and|then).+(edit|improve|enhance)|search.+(and|then).+(summarize|create|tell)/i,
    
    // Conditional fallback (Hebrew + English)
    /(אם|ו?אם).+(נכשל|לא\s+עבד|לא\s+הצליח).+(נסה|צור).+(עם|ב)\s+(OpenAI|Gemini|Grok)|(אם|if).+(לא|not).+(נסה|try).+(אחר|different|other)/i,
    /(if|and\s+if|when).+(fails?|doesn'?t\s+work|error|not\s+good).+(try|create|use).+(with|using|another|different|other)\s*(OpenAI|Gemini|Grok)?/i,
    
    // Smart retry (Hebrew + English)
    /(זה|ה\w+)\s+(לא\s+)?(עבד|עובד|הצליח|יוצא|יצא)\s+(כמו\s+שצריך|טוב|נכון)?|(נסה|תנסה)\s+(שוב|עוד פעם)\s+(עם|ב|אבל|רק).+|(פשט|תפשט)\s+(את\s+)?(זה|הפרומפט|הבקשה)/i,
    /(this|it)\s+(didn'?t|doesn'?t)\s+(work|come\s+out|turn\s+out)|try\s+(again|once\s+more)\s+(with|but|using).+|(simplify|make\s+it\s+simpler)|too\s+(complex|complicated|detailed)/i
  ];
  
  for (const pattern of agentPatterns) {
    if (pattern.test(prompt)) {
      console.log(`🤖 [Agent] Detected agent-suitable query, will use agent`);
      return true;
    }
  }
  
  return false;
}

module.exports = {
  executeAgentQuery,
  shouldUseAgent
};

