/**
 * Creation Tools - Image, Video, Music, Poll generation
 * Clean, modular tool definitions following SOLID principles
 */

const { formatProviderName } = require('../utils/providerUtils');
const { getServices } = require('../utils/serviceLoader');
const { cleanMarkdown } = require('../../../utils/textSanitizer');
const { ProviderFallback } = require('../../../utils/providerFallback');
const logger = require('../../../utils/logger');

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
    logger.debug(`🔧 [Agent Tool] create_image called`, { 
      prompt: args.prompt?.substring(0, 100), 
      provider: args.provider,
      chatId: context?.chatId 
    });
    
    try {
      if (context?.expectedMediaType === 'video') {
        return {
          success: false,
          error: 'התבקשת ליצור וידאו, לא תמונה. בחר ספק וידאו מתאים או נסה שוב.'
        };
      }

      const requestedProvider = args.provider || null;
      // If user requested a specific provider, only try that one (no fallback)
      // If no provider specified (default), try all providers with fallback
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : ['gemini', 'openai', 'grok'];
      const { geminiService, openaiService, grokService } = getServices();
      
      // Use ProviderFallback utility for DRY code
      const fallback = new ProviderFallback({
        toolName: 'create_image',
        providersToTry,
        requestedProvider,
        context
      });
      
      const result = await fallback.tryWithFallback(async (provider, services) => {
        let imageResult;
        if (provider === 'openai') {
          imageResult = await openaiService.generateImageForWhatsApp(args.prompt);
        } else if (provider === 'grok') {
          imageResult = await grokService.generateImageForWhatsApp(args.prompt);
        } else {
          imageResult = await geminiService.generateImageForWhatsApp(args.prompt);
        }
        return imageResult;
      }, {
        onSuccess: (imageResult, provider) => {
          // Handle text-only response (no image but text returned)
          if (imageResult.textOnly) {
            // Clean markdown from text
            let text = imageResult.description || '';
            if (text) {
              const { cleanMarkdown } = require('../../../utils/textSanitizer');
              text = cleanMarkdown(text);
            }
            
            return {
              success: true,
              data: text, // Just return the text, no error message
              provider: provider
            };
          }
          
          // Normal image response
          // Clean markdown code blocks from caption (AI services sometimes return markdown)
          let caption = imageResult.description || imageResult.revisedPrompt || '';
          if (caption) {
            const { cleanMarkdown } = require('../../../utils/textSanitizer');
            caption = cleanMarkdown(caption);
          }
          
          return {
            success: true,
            data: `✅ תמונה נוצרה בהצלחה!`,
            imageUrl: imageResult.imageUrl,
            imageCaption: caption,
            provider: provider
          };
        }
      });
      
      return result;
    } catch (error) {
      logger.error('❌ Error in create_image tool', {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
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
    logger.debug(`🔧 [Agent Tool] create_video called with provider: ${args.provider || 'kling'}`, {
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || 'kling',
      chatId: context?.chatId
    });
    
    try {
      const { geminiService, openaiService } = getServices();
      const replicateService = require('../../replicateService');
      const requestedProvider = args.provider || null;
      // If user requested a specific provider, only try that one (no fallback)
      // If no provider specified (default), try all providers with fallback
      const providersToTry = requestedProvider
        ? [requestedProvider]
        : ['kling', 'veo3', 'sora'];
      context.expectedMediaType = 'video';
      
      // Use ProviderFallback utility for DRY code
      const fallback = new ProviderFallback({
        toolName: 'create_video',
        providersToTry,
        requestedProvider,
        context
      });
      
      const result = await fallback.tryWithFallback(async (provider, services) => {
        if (provider === 'veo3') {
          return await geminiService.generateVideoForWhatsApp(args.prompt);
        } else if (provider === 'sora' || provider === 'sora-pro') {
          const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
          return await openaiService.generateVideoWithSoraForWhatsApp(args.prompt, null, { model });
        } else {
          return await replicateService.generateVideoWithTextForWhatsApp(args.prompt);
        }
      }, {
        onSuccess: (result, provider) => {
          context.expectedMediaType = null;
          return {
            success: true,
            data: `✅ הוידאו נוצר בהצלחה עם ${formatProviderName(provider)}!`,
            videoUrl: result.videoUrl || result.url,
            provider: provider
          };
        }
      });
      
      context.expectedMediaType = null;
      return result;
    } catch (error) {
      logger.error('❌ Error in create_video', {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
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
    logger.debug(`🔧 [Agent Tool] image_to_video called`, {
      imageUrl: args.image_url?.substring(0, 50),
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || 'kling',
      chatId: context?.chatId
    });
    
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
      logger.error('❌ Error in image_to_video', {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        imageUrl: args.image_url?.substring(0, 50),
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
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
    description: `יוצר שיר/מוזיקה חדש מאפס עם Suno AI (כולל מילים ומלודיה).

**מתי להשתמש בכלי הזה (חובה!):**
• "צור שיר" / "יצירת שיר" / "create song" / "make music" / "generate song"
• "שיר עם מנגינה" / "song with melody" / "music with tune"
• "שיר עם Suno" / "song with Suno" / "create song with Suno"
• כל בקשה מפורשת ליצירת מוזיקה/שיר עם מלודיה

**מתי לא להשתמש בכלי הזה (חשוב!):**
• "כתוב שיר" / "לכתוב שיר" / "write song" / "write lyrics" → זה רק מילים (טקסט), לא להשתמש בכלי! פשוט כתוב שיר בטקסט.
• "שיר מילולי" / "lyrics only" / "just words" → רק טקסט, לא כלי.
• בקשה ללינק לשיר קיים → השתמש ב-search_web במקום.

**הכלי מייצר שיר מקורי עם מילים ומלודיה באמצעות Suno AI.`,
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
        logger.warn('⚠️ create_music: Failed to parse music request for video detection', {
          error: parseError.message,
          prompt: args.prompt?.substring(0, 100),
          chatId: context?.chatId
        });
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
      logger.error('❌ Error in create_music', {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        prompt: args.prompt?.substring(0, 100),
        makeVideo: args.make_video,
        chatId: context?.chatId
      });
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
      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      
      const pollData = await geminiService.generateCreativePoll(args.topic, withRhyme, language);
      
      if (pollData.error) {
        return {
          success: false,
          error: language === 'he' 
            ? `יצירת סקר נכשלה: ${pollData.error}`
            : `Poll generation failed: ${pollData.error}`
        };
      }
      
      return {
        success: true,
        data: language === 'he'
          ? `✅ הסקר נוצר${withRhyme ? ' עם חרוזים' : ' בלי חרוזים'}!`
          : `✅ Poll generated${withRhyme ? ' with rhymes' : ' without rhymes'}!`,
        poll: pollData
      };
    } catch (error) {
      logger.error('❌ Error in create_poll', {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        question: args.question?.substring(0, 100),
        options: args.options,
        chatId: context?.chatId
      });
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

