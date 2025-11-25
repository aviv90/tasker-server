/**
 * Creation Tools - Image, Video, Music, Poll generation
 * Clean, modular tool definitions following SOLID principles
 */

import { formatProviderName } from '../utils/providerUtils';
import { getServices } from '../utils/serviceLoader';
import { cleanMarkdown } from '../../../utils/textSanitizer';
import { ProviderFallback, ProviderResult } from '../../../utils/providerFallback';
import logger from '../../../utils/logger';
import * as replicateService from '../../replicateService';
import { generateMusicWithLyrics } from '../../musicService';
import { parseMusicRequest } from '../../geminiService';

type AgentToolContext = {
  chatId?: string;
  expectedMediaType?: string | null;
  originalInput?: {
    userText?: string;
    language?: string;
    originalMessageId?: string;
    senderData?: {
      senderId?: string;
      sender?: string;
      senderName?: string;
      senderContactName?: string;
      chatName?: string;
    };
  };
  normalized?: {
    text?: string;
    language?: string;
  };
  [key: string]: unknown;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
  [key: string]: unknown;
}>;

type CreateImageArgs = {
  prompt?: string;
  provider?: 'gemini' | 'openai' | 'grok';
};

type CreateVideoArgs = {
  prompt?: string;
  provider?: 'veo3' | 'sora' | 'sora-pro' | 'kling';
};

type ImageToVideoArgs = {
  image_url?: string;
  prompt?: string;
  provider?: 'veo3' | 'sora' | 'sora-pro' | 'kling';
};

type CreateMusicArgs = {
  prompt?: string;
  make_video?: boolean;
};

type CreatePollArgs = {
  topic?: string;
  with_rhyme?: boolean;
  options?: unknown;
};

type ProviderTaggedResult = ProviderResult & {
  providerUsed?: string;
};

type ImageProviderResult = ProviderTaggedResult & {
  imageUrl?: string;
  description?: string;
  revisedPrompt?: string;
  textOnly?: boolean;
  fileName?: string;
};

type VideoProviderResult = ProviderTaggedResult & {
  videoUrl?: string;
  url?: string;
};

type MusicGenerationResponse = {
  error?: string;
  status?: 'pending' | 'completed' | string;
  message?: string;
  taskId?: string;
  result?: string;
  url?: string;
  lyrics?: string;
};

/**
 * Tool: Create Image
 */
export const create_image = {
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
  execute: async (args: CreateImageArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] create_image called`, { 
      prompt: args.prompt?.substring(0, 100), 
      provider: args.provider,
      chatId: context?.chatId 
    });
    
    try {
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה לספק תיאור לתמונה'
        };
      }

      if (context?.expectedMediaType === 'video') {
        return {
          success: false,
          error: 'התבקשת ליצור וידאו, לא תמונה. בחר ספק וידאו מתאים או נסה שוב.'
        };
      }

      const requestedProvider = args.provider ?? null;
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
      
      const prompt = args.prompt.trim();
      const providerResult = (await fallback.tryWithFallback<ImageProviderResult>(async provider => {
        let imageResult: ImageProviderResult;
        if (provider === 'openai') {
          imageResult = (await openaiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        } else if (provider === 'grok') {
          imageResult = (await grokService.generateImageForWhatsApp(prompt)) as ImageProviderResult;
        } else {
          imageResult = (await geminiService.generateImageForWhatsApp(prompt, null)) as ImageProviderResult;
        }
        imageResult.providerUsed = provider;
        return imageResult;
      })) as ImageProviderResult;

      if (!providerResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (providerResult.error) {
        const errorMessage =
          typeof providerResult.error === 'string'
            ? providerResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: errorMessage
        };
      }

      const providerKey =
        (providerResult.providerUsed as string | undefined) ||
        requestedProvider ||
        providersToTry[0] ||
        'gemini';
      const formattedProviderName = formatProviderName(providerKey);
      const providerName =
        typeof formattedProviderName === 'string' && formattedProviderName.length > 0
          ? formattedProviderName
          : providerKey;

      if (providerResult.textOnly) {
        let text = providerResult.description || '';
        if (text) {
          text = cleanMarkdown(text);
        }
        return {
          success: true,
          data: text,
          provider: providerName
        };
      }

      let caption = providerResult.description || providerResult.revisedPrompt || '';
      if (caption) {
        caption = cleanMarkdown(caption);
      }

      return {
        success: true,
        data: '✅ תמונה נוצרה בהצלחה!',
        imageUrl: providerResult.imageUrl,
        imageCaption: caption,
        provider: providerName
      };
    } catch (error) {
      logger.error('❌ Error in create_image tool', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

/**
 * Tool: Create Video
 */
export const create_video = {
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
  execute: async (args: CreateVideoArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] create_video called with provider: ${args.provider || 'kling'}`, {
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || 'kling',
      chatId: context?.chatId
    });
    
    try {
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה לספק תיאור לסרטון'
        };
      }

      const { geminiService, openaiService } = getServices();
      const prompt = args.prompt.trim();
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
      
      const videoResult = (await fallback.tryWithFallback<VideoProviderResult>(async provider => {
        if (provider === 'veo3') {
          const result = (await geminiService.generateVideoForWhatsApp(prompt)) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        } else if (provider === 'sora' || provider === 'sora-pro') {
          const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
          const result = (await openaiService.generateVideoWithSoraForWhatsApp(
            prompt,
            null,
            { model }
          )) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        } else {
          const result = (await replicateService.generateVideoWithTextForWhatsApp(prompt)) as VideoProviderResult;
          result.providerUsed = provider;
          return result;
        }
      })) as VideoProviderResult;
      
      context.expectedMediaType = null;
      if (!videoResult) {
        return {
          success: false,
          error: 'לא התקבלה תשובה מהספקים'
        };
      }

      if (videoResult.error) {
        const errorMessage =
          typeof videoResult.error === 'string'
            ? videoResult.error
            : 'הבקשה נכשלה אצל הספק המבוקש';
        return {
          success: false,
          error: errorMessage
        };
      }

      const videoProviderKey =
        (videoResult.providerUsed as string | undefined) ||
        requestedProvider ||
        providersToTry[0] ||
        'kling';
      const formattedVideoProviderName = formatProviderName(videoProviderKey);
      const providerName =
        typeof formattedVideoProviderName === 'string' && formattedVideoProviderName.length > 0
          ? formattedVideoProviderName
          : videoProviderKey;

      return {
        success: true,
        data: `✅ הוידאו נוצר בהצלחה עם ${providerName}!`,
        videoUrl: videoResult.videoUrl || videoResult.url,
        provider: providerName
      };
    } catch (error) {
      context.expectedMediaType = null;
      logger.error('❌ Error in create_video', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

/**
 * Tool: Image to Video
 */
export const image_to_video = {
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
  execute: async (args: ImageToVideoArgs = {}, context: AgentToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] image_to_video called`, {
      imageUrl: args.image_url?.substring(0, 50),
      prompt: args.prompt?.substring(0, 100),
      provider: args.provider || 'kling',
      chatId: context?.chatId
    });
    
    try {
      const { geminiService, openaiService, greenApiService } = getServices();
      const provider = args.provider || 'kling';
      if (!args.image_url) {
        return {
          success: false,
          error: 'חובה להעביר קישור לתמונה להמרה'
        };
      }
      if (!args.prompt) {
        return {
          success: false,
          error: 'חובה להעביר תיאור לאנימציה'
        };
      }
      
      const imageUrl = args.image_url;
      const prompt = args.prompt.trim();
      
      // CRITICAL: All providers need imageBuffer (not URL)!
      // Download the image once, then pass to provider
      const imageBuffer = await greenApiService.downloadFile(imageUrl);
      
      let result: VideoProviderResult & { error?: string };
      if (provider === 'veo3') {
        result = (await geminiService.generateVideoFromImageForWhatsApp(prompt, imageBuffer)) as VideoProviderResult & { error?: string };
      } else if (provider === 'sora' || provider === 'sora-pro') {
        const model = provider === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
        result = (await openaiService.generateVideoWithSoraFromImageForWhatsApp(
          prompt,
          imageBuffer,
          { model }
        )) as VideoProviderResult & { error?: string };
      } else {
        // Kling also needs imageBuffer
        result = (await replicateService.generateVideoFromImageForWhatsApp(imageBuffer, prompt)) as VideoProviderResult & { error?: string };
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
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        imageUrl: args.image_url?.substring(0, 50),
        prompt: args.prompt?.substring(0, 100),
        provider: args.provider,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

/**
 * Tool: Create Music
 */
export const create_music = {
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
  execute: async (args: CreateMusicArgs = {}, context: AgentToolContext = {}): ToolResult => {
    console.log(`🔧 [Agent Tool] create_music called`);
    
    try {
      if (!args.prompt && !context.originalInput?.userText) {
        return {
          success: false,
          error: 'חובה לספק תיאור לשיר'
        };
      }

      const originalUserText = context.originalInput?.userText || args.prompt || '';
      const cleanedOriginal = String(originalUserText).replace(/^#\s*/, '').trim();
      
      let cleanPrompt = args.prompt || cleanedOriginal || '';
      let wantsVideo = Boolean(args.make_video);
      
      try {
        // Fix: ensure argument is string
        const parsingResult = (await parseMusicRequest(cleanedOriginal || args.prompt || '')) as { cleanPrompt?: string; wantsVideo?: boolean };
        if (parsingResult?.cleanPrompt) {
          cleanPrompt = parsingResult.cleanPrompt.trim() || cleanPrompt;
        }
        if (parsingResult?.wantsVideo) {
          wantsVideo = true;
        }
      } catch (parseError) {
        const parseErr = parseError as Error;
        logger.warn('⚠️ create_music: Failed to parse music request for video detection', {
          error: parseErr.message || String(parseErr),
          prompt: args.prompt?.substring(0, 100),
          chatId: context?.chatId
        });
      }
      
      const senderData = context.originalInput?.senderData || {};
      const whatsappContext = context.chatId
        ? {
            chatId: context.chatId,
            senderId: senderData.senderId || senderData.sender || null,
            senderName: senderData.senderName || senderData.senderContactName || '',
            senderContactName: senderData.senderContactName || '',
            chatName: senderData.chatName || ''
          }
        : null;
      
      const result = (await generateMusicWithLyrics(cleanPrompt, {
        whatsappContext,
        makeVideo: wantsVideo
      })) as MusicGenerationResponse;
      
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
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        prompt: args.prompt?.substring(0, 100),
        makeVideo: args.make_video,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
      };
    }
  }
};

/**
 * Tool: Create Poll
 */
export const create_poll = {
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
  execute: async (args: CreatePollArgs = {}, context: AgentToolContext = {}): ToolResult => {
    console.log(`🔧 [Agent Tool] create_poll called with topic: ${args.topic}, with_rhyme: ${args.with_rhyme !== false}`);
    
    try {
      if (!args.topic) {
        return {
          success: false,
          error: 'חובה לספק נושא לסקר'
        };
      }

      const { geminiService } = getServices();
      
      // Default to true (with rhyme) if not specified
      const withRhyme = args.with_rhyme !== false;
      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      
      // Fix: cast pollData to expected type
      const pollData = (await geminiService.generateCreativePoll(args.topic, withRhyme, language)) as { error?: string; question?: string; options?: string[] };
      
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
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        topic: args.topic?.substring(0, 100),
        options: args.options,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: `שגיאה: ${(error as Error).message}`
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
