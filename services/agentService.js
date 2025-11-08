const { GoogleGenerativeAI } = require('@google/generative-ai');
const conversationManager = require('./conversationManager');
const { cleanThinkingPatterns } = require('./geminiService');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Lazy-loaded services to avoid circular dependencies and improve startup time
let geminiService, openaiService, grokService, fileDownloader;
const getServices = () => {
  if (!geminiService) geminiService = require('./geminiService');
  if (!openaiService) openaiService = require('./openaiService');
  if (!grokService) grokService = require('./grokService');
  if (!fileDownloader) fileDownloader = require('../utils/fileDownloader');
  return { geminiService, openaiService, grokService, fileDownloader };
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
        const history = await conversationManager.getChatHistory(context.chatId, limit);
        
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
          
          // Add media indicators
          if (msg.metadata) {
            if (msg.metadata.hasImage) content += ' [יש תמונה מצורפת]';
            if (msg.metadata.hasVideo) content += ' [יש וידאו מצורף]';
            if (msg.metadata.hasAudio) content += ' [יש אודיו מצורף]';
            if (msg.metadata.imageUrl) content += ` [image_id: ${idx}]`;
            if (msg.metadata.videoUrl) content += ` [video_id: ${idx}]`;
            if (msg.metadata.audioUrl) content += ` [audio_id: ${idx}]`;
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
        const { geminiService, fileDownloader } = getServices();
        imageBuffer = await fileDownloader.downloadFile(imageUrl);
        
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
  get_long_term_memory: {
    declaration: {
      name: 'get_long_term_memory',
      description: 'גישה לזיכרון ארוך טווח - סיכומי שיחות קודמות והעדפות משתמש. שימושי כדי להבין הקשר רחב יותר או העדפות המשתמש.',
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
          data: `✅ תמונה נוצרה בהצלחה עם ${provider}!`,
          imageUrl: imageResult.url,
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
        imageBuffer = await fileDownloader.downloadFile(imageResult.url);
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
          imageUrl: imageResult.url
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
        const { geminiService, fileDownloader } = getServices();
        imageBuffer = await fileDownloader.downloadFile(imageUrl);
        
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
        
        // Strategy 1: Try different provider
        console.log(`📊 Strategy 1: Trying different provider...`);
        const providersTried = args.provider_tried ? [args.provider_tried] : [];
        const providers = ['gemini', 'openai', 'grok'].filter(p => !providersTried.includes(p));
        
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
                  data: `✅ הצלחתי עם ${provider}! (אסטרטגיה: ספק חלופי)`,
                  imageUrl: result.url,
                  strategy_used: 'different_provider',
                  provider: provider
                };
              }
            } else if (args.task_type === 'video_creation') {
              // Video generation with different providers
              const replicateService = require('./replicateService');
              
              if (provider === 'openai') {
                // Try Sora (OpenAI)
                result = await openaiService.generateVideoForWhatsApp(args.original_prompt, { model: 'sora-2' });
              } else {
                // Try Kling (default for Gemini/others)
                result = await replicateService.generateVideoForWhatsApp(args.original_prompt, { model: 'kling' });
              }
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם ${provider === 'openai' ? 'Sora' : 'Kling'}! (אסטרטגיה: מודל חלופי)`,
                  videoUrl: result.url,
                  strategy_used: 'different_provider',
                  provider: provider
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
                  imageUrl: result.url,
                  strategy_used: 'simplified_prompt',
                  original_prompt: args.original_prompt,
                  simplified_prompt: simplifiedPrompt
                };
              }
            } else if (args.task_type === 'video_creation') {
              const replicateService = require('./replicateService');
              result = await replicateService.generateVideoForWhatsApp(simplifiedPrompt, { model: 'kling' });
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם פרומפט פשוט יותר! (אסטרטגיה: פישוט)`,
                  videoUrl: result.url,
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
                  imageUrl: result.url,
                  strategy_used: 'generic_prompt',
                  original_prompt: args.original_prompt,
                  generic_prompt: genericPrompt
                };
              }
            } else if (args.task_type === 'video_creation') {
              const replicateService = require('./replicateService');
              result = await replicateService.generateVideoForWhatsApp(genericPrompt, { model: 'kling' });
              
              if (!result.error) {
                return {
                  success: true,
                  data: `✅ הצלחתי ליצור וידאו עם גרסה כללית יותר! (אסטרטגיה: הכללה)`,
                  videoUrl: result.url,
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
        return {
          success: false,
          error: `כל האסטרטגיות נכשלו:\n1. ספקים שונים ✗\n2. פישוט פרומפט ✗\n3. פרמטרים כלליים ✗\n\nאולי תנסה לנסח את הבקשה אחרת?`
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
      description: 'נסה ליצור תמונה עם ספק אחר אם הראשון נכשל או לא טוב. אל תשתמש בכלי הזה לפני שניסית ליצור תמונה!',
      parameters: {
        type: 'object',
        properties: {
          original_prompt: {
            type: 'string',
            description: 'הפרומפט המקורי ליצירת התמונה',
          },
          reason: {
            type: 'string',
            description: 'למה לנסות ספק אחר (לדוגמה: "התמונה לא טובה")',
          },
          avoid_provider: {
            type: 'string',
            description: 'איזה ספק לא לנסות (gemini/openai/grok)',
            enum: ['gemini', 'openai', 'grok']
          }
        },
        required: ['original_prompt', 'reason']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] retry_with_different_provider called`);
      
      try {
        const avoidProvider = args.avoid_provider || 'gemini';
        const { geminiService, openaiService, grokService } = getServices();
        
        // Try providers in order, skipping the one that failed
        const providers = ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
        const errors = [];
        
        for (const provider of providers) {
          console.log(`🔄 Trying provider: ${provider}`);
          
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
                data: `ניסיתי עם ${provider} והצלחתי! הסיבה: ${args.reason}`,
                imageUrl: imageResult.url,
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
          imageUrl: result.url,
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
          imageUrl: result.url,
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
          imageUrl: result.url,
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
  }
};

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
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 60000,
    contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  };
  
  const maxIterations = options.maxIterations || agentConfig.maxIterations;
  const model = genAI.getGenerativeModel({ model: agentConfig.model });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
  // System prompt for the agent
  const systemInstruction = `אתה עוזר AI אוטונומי וחכם עם יכולות מתקדמות. יש לך גישה לכלים שיכולים לעזור לך לענות על שאלות.

🚫 **אסור בהחלט - כללי תשובה קריטיים:**
1. **אסור לחלוטין** לכתוב את תהליך החשיבה שלך
2. **אסור בהחלט** לכתוב: "My internal thoughts", "Got it. I need to", "I'll acknowledge"
3. **אסור** לכתוב רשימות כמו: "- Acknowledge the user's request", "- Be friendly", "- Wait for"
4. **אסור** לכתוב משפטים באנגלית על מה שאתה צריך לעשות
5. **רק התשובה הסופית** - ללא הסברים על תהליך החשיבה

✅ **כן - איך לענות:**
- ענה ישירות למשתמש בעברית
- אם אתה צריך לחשוב - תחשוב בשקט (אל תכתוב את זה!)
- רק התוצאה הסופית

❌ **דוגמה לתשובה אסורה:**
"Got it. I need to pivot away from the topic.
My internal thoughts:
- Acknowledge the user's request
- Be friendly"

✅ **דוגמה לתשובה נכונה:**
"הבנתי, אני מוכן לנושא הבא!"

---

כללי שימוש בכלים:

📚 כלי מידע:
1. אם המשתמש שואל שאלה על תוכן השיחה או מתייחס להודעות קודמות - השתמש ב-get_chat_history
2. אם בהיסטוריה יש תמונה רלוונטית לשאלה - השתמש ב-analyze_image_from_history
3. אם אתה צריך מידע עדכני או מידע שאינו זמין לך - השתמש ב-search_web
4. אם אתה צריך הקשר רחב יותר או להבין העדפות משתמש - השתמש ב-get_long_term_memory
   - זיכרון זה כולל סיכומי שיחות קודמות והעדפות שנשמרו
   - שימושי כשהמשתמש מתייחס ל"כמו בפעם הקודמת" או לעניינים שדובר עליהם לפני זמן רב

🖼️ יצירת תמונות:
5. אם צריך ליצור תמונה בסיסית - השתמש ב-create_image
   - ברירת מחדל: gemini
   - אפשר לציין provider אחר (openai/grok)

🎨 Meta-tools (משימות מורכבות - מהירות כפולה!):
6. אם צריך ליצור תמונה ולנתח אותה מיד - השתמש ב-create_and_analyze
7. אם צריך לנתח תמונה מההיסטוריה ואז לערוך אותה - השתמש ב-analyze_and_edit
8. אם צריך לנסות ספק אחר - השתמש ב-retry_with_different_provider
9. אם צריך ליצור מבוסס על היסטוריה ("כמו בפעם הקודמת") - השתמש ב-history_aware_create
   - חוסך קריאות: history + creation במכה אחת!
10. אם צריך ליצור מבוסס על העדפות משתמש - השתמש ב-create_with_memory
   - חוסך קריאות: preferences + creation במכה אחת!
11. אם צריך לחפש באינטרנט ואז ליצור - השתמש ב-search_and_create
   - חוסך קריאות: search + creation במכה אחת!

🧠 Smart Retry (Stage 3 - חדש!):
12. אם משימה נכשלה או המשתמש לא מרוצה מהתוצאה - השתמש ב-smart_execute_with_fallback
   הכלי הזה ינסה אוטומטית:
   - ספקים שונים (Gemini/OpenAI/Grok)
   - פישוט הפרומפט
   - פרמטרים כלליים יותר
   - הצעה לפיצול המשימה
   
   דוגמאות למתי להשתמש:
   - "התמונה לא יצאה טוב"
   - "זה לא עבד"
   - "נסה שוב בצורה אחרת"
   - "פשט את זה"

🔄 Conditional Fallback (חדש!):
13. **אם המשתמש מבקש fallback מראש** - בצע try-catch:
   דוגמאות:
   - "צור תמונה של X ואם נכשל צור עם OpenAI"
   - "create image and if fails use Grok"
   
   **תהליך:**
   1. נסה ליצור עם ברירת מחדל (Gemini)
   2. אם נכשל → קרא ל-smart_execute_with_fallback עם הספק המבוקש
   3. אם הצליח → החזר תוצאה

💡 חשוב: 
- תמיד נסה תחילה את הכלי הרגיל, ורק אם נכשל השתמש ב-smart_execute_with_fallback
- אם המשתמש ציין ספק ספציפי לfallback - העבר אותו ל-smart_execute_with_fallback
- תשיב בעברית, באופן טבעי ונעים
- אם אין צורך בכלים - פשוט ענה ישירות`;


  // 🧠 Context for tool execution (load previous context if enabled)
  let context = {
    chatId,
    previousToolResults: {},
    toolCalls: [],
    generatedAssets: {
      images: [],
      videos: [],
      audio: []
    }
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
      
      return {
        success: true,
        text: text,
        toolsUsed: Object.keys(context.previousToolResults),
        iterations: iterationCount
      };
    }
    
    // Execute function calls (in parallel for better performance)
    console.log(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);
    
    // Execute all tools in parallel (they're independent)
    const toolPromises = functionCalls.map(async (call) => {
      const toolName = call.name;
      const toolArgs = call.args;
      
      console.log(`   → Calling tool: ${toolName} with args:`, toolArgs);
      
      const tool = agentTools[toolName];
      if (!tool) {
        console.error(`❌ Unknown tool: ${toolName}`);
        return {
          name: toolName,
          response: {
            success: false,
            error: `Unknown tool: ${toolName}`
          }
        };
      }
      
      try {
        // Execute the tool
        const toolResult = await tool.execute(toolArgs, context);
        
        // Save result for future tool calls
        context.previousToolResults[toolName] = toolResult;
        
        // 🧠 Track tool call for context memory
        context.toolCalls.push({
          tool: toolName,
          args: toolArgs,
          success: toolResult.success !== false,
          timestamp: Date.now()
        });
        
        // 🧠 Track generated assets for context memory
        if (toolResult.imageUrl) {
          context.generatedAssets.images.push({
            url: toolResult.imageUrl,
            prompt: toolArgs.prompt,
            provider: toolResult.provider || toolArgs.provider,
            timestamp: Date.now()
          });
        }
        if (toolResult.videoUrl) {
          context.generatedAssets.videos.push({
            url: toolResult.videoUrl,
            prompt: toolArgs.prompt,
            timestamp: Date.now()
          });
        }
        
        return {
          name: toolName,
          response: toolResult
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
          name: toolName,
          response: {
            success: false,
            error: `Tool execution failed: ${error.message}`
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
      iterations: iterationCount
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
        timeout: true
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
  // Use agent if:
  // 1. Question refers to chat history/previous messages
  // 2. Complex multi-step requests (create + analyze, create + retry, etc.)
  // 3. Question about media in the conversation
  // 4. Requests that need web search + something else
  
  const agentPatterns = [
    // History-related
    /מה\s+(אמרתי|אמרת|כתבתי|כתבת|שלחתי|שלחת|דיברתי|דיברת)\s+(קודם|לפני|בהודעה|בשיחה)?/i,
    /על\s+מה\s+(דיברנו|עסקנו|שוחחנו)/i,
    /(ב|מ|על)(ה)?(תמונה|וידאו|הקלטה|הודעה|שיחה)\s+(האחרונה|הקודמת|שבהיסטוריה|מקודם)/i,
    /what\s+(did\s+)?(I|we|you)\s+(say|said|write|wrote|mention|talk|discuss)/i,
    /about\s+the\s+(image|video|audio|message|conversation)/i,
    /in\s+the\s+(previous|last|recent)\s+(message|conversation)/i,
    
    // Multi-step patterns (meta-tools)
    /(צור|תצור).+(ו|אם|ואז).+(נתח|תנתח|בדוק|תבדוק|ערוך|תערוך)/i,  // "צור תמונה ובדוק אם היא טובה"
    /(נתח|תנתח).+(ו|ואז).+(ערוך|תערוך|שפר|תשפר)/i,  // "נתח את התמונה ושפר אותה"
    /(חפש|תחפש).+(ו|ואז).+(תן|תני|צור|תצור|ספר|ספרי)/i,  // "חפש מידע וצור תמונה"
    
    // Conditional fallback patterns - "if X fails, try Y"
    /(אם|ו?אם).+(נכשל|לא\s+עבד|לא\s+הצליח|לא\s+יצא).+(נסה|תנסה|צור|תצור).+(עם|ב)\s+(OpenAI|Gemini|Grok)/i,  // "ואם נכשל צור עם OpenAI"
    /(if|and\s+if).+(fails?|doesn'?t\s+work|error).+(try|create|use).+(with|using)?\s+(OpenAI|Gemini|Grok)/i,  // "and if fails create with OpenAI"
    /(אם|if).+(לא|not).+(נסה|try).+(אחר|different|other)/i,  // "אם זה לא טוב נסה ספק אחר"
    
    /create.+(and|then).+(analyze|check|edit|improve)/i,
    /analyze.+(and|then).+(edit|improve|enhance)/i,
    /search.+(and|then).+(summarize|create|tell)/i,
    /(if|when).+(not\s+good|fails?|doesn'?t\s+work).+(try|use).+(another|different|other)/i,
    
    // Smart retry patterns (Stage 3) - requests that imply need for fallback strategies
    /(זה|ה\w+)\s+(לא\s+)?(עבד|עובד|הצליח|יוצא|יצא)\s+(כמו\s+שצריך|טוב|נכון|כראוי)?/i,  // "זה לא עבד", "התמונה לא יצאה טוב"
    /(נסה|תנסה)\s+(שוב|עוד פעם)\s+(עם|ב|אבל|רק).+/i,  // "נסה שוב עם פישוט", "נסה עוד פעם אבל בפשטות"
    /(this|it)\s+(didn'?t|doesn'?t)\s+(work|come\s+out|turn\s+out)/i,  // "it didn't work well"
    /try\s+(again|once\s+more)\s+(with|but|using).+/i,  // "try again with simplification"
    /(פשט|פשטו|תפשט)\s+(את\s+)?(זה|הפרומפט|הבקשה)/i,  // "פשט את זה"
    /(simplify|make\s+it\s+simpler)/i,  // "simplify the request"
    /too\s+(complex|complicated|detailed)/i  // "too complex"
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

