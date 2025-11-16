/**
 * Meta Tools - Advanced composite tools that combine multiple operations
 * 
 * These tools chain multiple basic tools together for complex workflows:
 * - create_and_analyze: Create image then analyze it
 * - analyze_and_edit: Analyze image then edit based on findings
 * - history_aware_create: Create based on chat history context
 * - retry_with_different_provider: Automatic fallback to alternative providers
 * - search_and_create: Web search then create content based on results
 * 
 * Extracted from agentService.js for better modularity (Phase 4)
 */

const conversationManager = require('../../conversationManager');
const { getServices } = require('../utils/serviceLoader');
const { formatProviderName, normalizeProviderKey } = require('../utils/providerUtils');
const { VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('../config/constants');


const metaTools = {
  // Tool 1: Analyze image from history
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

  // Tool 3: Search web
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
            
            // ✅ CRITICAL: Send Ack BEFORE attempting the provider
            const ackMessage = `🎨 מנסה לערוך עם ${formatProviderName(provider)}...`;
            try {
              await greenApiService.sendTextMessage(context.chatId, ackMessage);
              console.log(`📢 [Fallback Ack] Sent: "${ackMessage}"`);
            } catch (ackError) {
              console.error('❌ Failed to send fallback Ack:', ackError);
            }
            
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
              
              // ✅ CRITICAL: Send error message to user as-is (Rule 2)
              const errorMessage = `❌ ${formatProviderName(provider)} נכשל בעריכה: ${editResult?.error || 'Unknown error'}`;
              errors.push(errorMessage);
              console.log(`❌ ${provider} edit failed: ${editResult?.error}`);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, errorMessage);
                console.log(`📢 [Fallback Error] Sent to user: "${errorMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send error to user:', sendError);
              }
              
            } catch (providerError) {
              // ✅ CRITICAL: Send exception error to user as-is (Rule 2)
              const exceptionMessage = `❌ ${formatProviderName(provider)} נכשל בעריכה: ${providerError.message}`;
              errors.push(exceptionMessage);
              console.error(`❌ ${provider} edit threw error:`, providerError);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, exceptionMessage);
                console.log(`📢 [Fallback Exception] Sent to user: "${exceptionMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send exception to user:', sendError);
              }
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
            
            // ✅ CRITICAL: Send Ack BEFORE attempting the provider
            const ackMessage = `🎬 מנסה עם ${formatProviderName(displayProvider)}...`;
            try {
              await greenApiService.sendTextMessage(context.chatId, ackMessage);
              console.log(`📢 [Fallback Ack] Sent: "${ackMessage}"`);
            } catch (ackError) {
              console.error('❌ Failed to send fallback Ack:', ackError);
            }
            
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
              
              // ✅ CRITICAL: Send error message to user as-is (Rule 2)
              const errorMessage = `❌ ${formatProviderName(displayProvider)} נכשל: ${result?.error || 'Unknown error'}`;
              errors.push(errorMessage);
              console.log(`❌ ${displayProvider} failed: ${result?.error}`);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, errorMessage);
                console.log(`📢 [Fallback Error] Sent to user: "${errorMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send error to user:', sendError);
              }
              
            } catch (providerError) {
              // ✅ CRITICAL: Send exception error to user as-is (Rule 2)
              const exceptionMessage = `❌ ${formatProviderName(displayProvider)} נכשל: ${providerError.message}`;
              errors.push(exceptionMessage);
              console.error(`❌ ${displayProvider} threw error:`, providerError);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, exceptionMessage);
                console.log(`📢 [Fallback Exception] Sent to user: "${exceptionMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send exception to user:', sendError);
              }
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
            
            // ✅ CRITICAL: Send Ack BEFORE attempting the provider
            const ackMessage = `🎨 מנסה עם ${formatProviderName(provider)}...`;
            try {
              await greenApiService.sendTextMessage(context.chatId, ackMessage);
              console.log(`📢 [Fallback Ack] Sent: "${ackMessage}"`);
            } catch (ackError) {
              console.error('❌ Failed to send fallback Ack:', ackError);
            }
            
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
              
              // ✅ CRITICAL: Send error message to user as-is (Rule 2)
              const errorMessage = `❌ ${formatProviderName(provider)} נכשל: ${imageResult.error}`;
              errors.push(errorMessage);
              console.log(`❌ ${provider} failed: ${imageResult.error}`);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, errorMessage);
                console.log(`📢 [Fallback Error] Sent to user: "${errorMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send error to user:', sendError);
              }
              
            } catch (providerError) {
              // ✅ CRITICAL: Send exception error to user as-is (Rule 2)
              const exceptionMessage = `❌ ${formatProviderName(provider)} נכשל: ${providerError.message}`;
              errors.push(exceptionMessage);
              console.error(`❌ ${provider} threw error:`, providerError);
              
              try {
                await greenApiService.sendTextMessage(context.chatId, exceptionMessage);
                console.log(`📢 [Fallback Exception] Sent to user: "${exceptionMessage}"`);
              } catch (sendError) {
                console.error('❌ Failed to send exception to user:', sendError);
              }
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

  // Tool: Convert image to video

  // Tool: Analyze video

  // Tool: Create music

  // Tool: Transcribe audio

  // Tool: Text to speech

  // Tool: Chat summary
  // Tool: Send random location

  // ═══════════════════ ADVANCED TOOLS: Editing, Audio, Translation ═══════════════════

  // Tool: Edit image

  // Tool: Edit video

  // Tool: Voice clone and speak

  // Tool: Creative audio mix

  // Tool: Translate text

};

module.exports = metaTools;

