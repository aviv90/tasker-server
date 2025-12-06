/**
 * Music Creation Tool
 * Clean, modular tool definition following SOLID principles
 */

import logger from '../../../../utils/logger';
import { generateMusicWithLyrics } from '../../../musicService';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { REQUIRED, FAILED, ERROR } from '../../../../config/messages';
import type {
  AgentToolContext,
  ToolResult,
  CreateMusicArgs,
  MusicGenerationResponse
} from './types';

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
    logger.debug(`🔧 [Agent Tool] create_music called`);

    try {
      if (!args.prompt && !context.originalInput?.userText) {
        return {
          success: false,
          error: REQUIRED.SONG_DESCRIPTION
        };
      }

      const originalUserText = context.originalInput?.userText || args.prompt || '';
      const cleanedOriginal = String(originalUserText).replace(/^#\s*/, '').trim();

      const cleanPrompt = args.prompt || cleanedOriginal || '';
      const wantsVideo = Boolean(args.make_video);

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
          error: FAILED.MUSIC_CREATION(result.error)
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
        ...formatErrorForLogging(error),
        prompt: args.prompt?.substring(0, 100),
        makeVideo: args.make_video,
        chatId: context?.chatId
      });
      return {
        success: false,
        error: ERROR.generic(error instanceof Error ? error.message : String(error))
      };
    }
  }
};

