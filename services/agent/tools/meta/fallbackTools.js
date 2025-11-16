/**
 * Fallback Tools
 * 
 * Tools for automatic retry and fallback mechanisms when operations fail.
 * These tools handle errors gracefully by trying alternative providers or strategies.
 * 
 * Extracted from metaTools.js (Phase 5.2)
 */

const { getServices } = require('../../utils/serviceLoader');
const { formatProviderName, normalizeProviderKey } = require('../../utils/providerUtils');
const { VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('../../config/constants');
const { simplifyPrompt, makePromptMoreGeneric } = require('../../utils/promptUtils');

const fallbackTools = {
  // Tool: Smart execute with fallback
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
              const replicateService = require('../../../replicateService');
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
              const voiceService = require('../../../voiceService');
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
              const replicateService = require('../../../replicateService');
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
              const voiceService = require('../../../voiceService');
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
              const replicateService = require('../../../replicateService');
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
              const voiceService = require('../../../voiceService');
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

  // Tool: Retry with different provider
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
        const replicateService = require('../../../replicateService');
        
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
  }
};

module.exports = fallbackTools;

