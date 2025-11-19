/**
 * Creation Tools - Image, Video, Music, Poll generation
 * Clean, modular tool definitions following SOLID principles
 */

const { formatProviderName } = require('../utils/providerUtils');
const { sendToolAckMessage } = require('../utils/ackUtils');
const { formatErrorMessage } = require('../utils/errorUtils');
const { getServices } = require('../utils/serviceLoader');
const { cleanMarkdown } = require('../../../utils/textSanitizer');

/**
 * Tool: Create Image
 */
const create_image = {
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

      const requestedProvider = args.provider || null;
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : ['gemini', 'openai', 'grok'];
      const { geminiService, openaiService, grokService, greenApiService } = getServices();
      const errorStack = [];
      const chatId = context?.chatId || null;
      
      for (let idx = 0; idx < providersToTry.length; idx++) {
        const provider = providersToTry[idx];
        try {
          console.log(`🎨 [create_image] Trying provider: ${provider}`);
          
          if (idx > 0 && chatId) {
            await sendToolAckMessage(chatId, [{ name: 'create_image', args: { provider } }]);
          }
          
          let imageResult;
          if (provider === 'openai') {
            imageResult = await openaiService.generateImageForWhatsApp(args.prompt);
          } else if (provider === 'grok') {
            imageResult = await grokService.generateImageForWhatsApp(args.prompt);
          } else {
            imageResult = await geminiService.generateImageForWhatsApp(args.prompt);
          }
          
          if (imageResult?.error) {
            const providerName = formatProviderName(provider);
            const message = imageResult.error || `שגיאה ביצירת תמונה עם ${providerName}`;
            errorStack.push({ provider: providerName, message });
            console.warn(`❌ [create_image] ${providerName} failed: ${message}`);
            if (chatId && greenApiService) {
              await greenApiService.sendTextMessage(chatId, formatErrorMessage(message));
            }
            continue;
          }
          
          // Clean markdown code blocks from caption (AI services sometimes return markdown)
          let caption = imageResult.description || imageResult.revisedPrompt || '';
          if (caption) {
            caption = cleanMarkdown(caption);
          }
          
          return {
            success: true,
            data: `✅ תמונה נוצרה בהצלחה!`,
            imageUrl: imageResult.imageUrl,
            imageCaption: caption,
            provider: provider
          };
        } catch (error) {
          const providerName = formatProviderName(provider);
          const message = `שגיאה ביצירת תמונה עם ${providerName}: ${error.message || 'Unknown error'}`;
          errorStack.push({ provider: providerName, message });
          console.error(`❌ [create_image] ${providerName} threw error: ${message}`);
          if (chatId && greenApiService) {
            await greenApiService.sendTextMessage(chatId, formatErrorMessage(message));
          }
        }
      }
      
      if (requestedProvider) {
        const failure = errorStack[0];
        return {
          success: false,
          error: `שגיאה ביצירת תמונה עם ${failure?.provider || formatProviderName(requestedProvider)}: ${failure?.message || 'סיבה לא ידועה'}`
        };
      }
      
      const failureDetails = errorStack.length > 0
        ? errorStack.map(err => `• ${err.provider}: ${err.message}`).join('\n')
        : 'לא התקבלה תשובת שגיאה מהספקים.';
      return {
        success: false,
        error: `כל הספקים נכשלו ביצירת התמונה:\n${failureDetails}`
      };
    } catch (error) {
      console.error('❌ Error in create_image tool:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Create Video
 */
const create_video = {
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
      const { geminiService, openaiService, greenApiService } = getServices();
      const replicateService = require('../../replicateService');
      const requestedProvider = args.provider || null;
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : ['kling', 'veo3', 'sora'];
      const errorStack = [];
      context.expectedMediaType = 'video';
      const chatId = context?.chatId || null;
      
      for (let idx = 0; idx < providersToTry.length; idx++) {
        const provider = providersToTry[idx];
        try {
          console.log(`🎬 [create_video] Trying provider: ${provider}`);
          
          if (idx > 0 && chatId) {
            await sendToolAckMessage(chatId, [{ name: 'create_video', args: { provider } }]);
          }
          
          let result;
          if (provider === 'veo3') {
            result = await geminiService.generateVideoForWhatsApp(args.prompt);
          } else if (provider === 'sora' || provider === 'sora-pro') {
            const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
            result = await openaiService.generateVideoWithSoraForWhatsApp(args.prompt, null, { model });
          } else {
            result = await replicateService.generateVideoWithTextForWhatsApp(args.prompt);
          }
          
          if (result?.error) {
            const providerName = formatProviderName(provider);
            const message = result.error || `יצירת וידאו נכשלה עם ${providerName}`;
            errorStack.push({ provider: providerName, message });
            console.warn(`❌ [create_video] ${providerName} failed: ${message}`);
            if (chatId && greenApiService) {
              await greenApiService.sendTextMessage(chatId, formatErrorMessage(message));
            }
            continue;
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
          const providerName = formatProviderName(provider);
          const message = `שגיאה ביצירת וידאו עם ${providerName}: ${error.message || 'Unknown error'}`;
          errorStack.push({ provider: providerName, message });
          console.error(`❌ [create_video] ${providerName} threw error: ${message}`);
          if (chatId && greenApiService) {
            await greenApiService.sendTextMessage(chatId, formatErrorMessage(message));
          }
        }
      }
      
      context.expectedMediaType = null;
      if (requestedProvider) {
        const failure = errorStack[0];
        return {
          success: false,
          error: `יצירת וידאו נכשלה עם ${failure?.provider || formatProviderName(requestedProvider)}: ${failure?.message || 'סיבה לא ידועה'}`
        };
      }
      
      const failureDetails = errorStack.length > 0
        ? errorStack.map(err => `• ${err.provider}: ${err.message}`).join('\n')
        : 'לא התקבלה שגיאה מפורטת מהספקים.';
      return {
        success: false,
        error: `כל ספקי הוידאו נכשלו:\n${failureDetails}`
      };
    } catch (error) {
      console.error('❌ Error in create_video:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Image to Video
 */
const image_to_video = {
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
      const replicateService = require('../../replicateService');
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
};

/**
 * Tool: Create Music
 */
const create_music = {
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
      const { generateMusicWithLyrics } = require('../../musicService');
      const { parseMusicRequest } = require('../../geminiService');
      
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
};

/**
 * Tool: Create Poll
 */
const create_poll = {
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
};

module.exports = {
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll
};

