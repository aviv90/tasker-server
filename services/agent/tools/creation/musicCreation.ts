/**
 * Music Creation Tool
 * Clean, modular tool definition following SOLID principles
 */

import logger from '../../../../utils/logger';
import { extractCommandPrompt } from '../../../../utils/commandUtils';
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
    description: `Create a new song/music from scratch using Suno AI (lyrics + melody).
WHEN TO USE: 'create song', 'make music', 'song with melody'.
WHEN *NOT* TO USE: 'write song lyrics' (use text generation - just write it), 'link to song' (use search_web).`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Song description - style, topic, mood, lyrics'
        },
        make_video: {
          type: 'boolean',
          description: 'Create a video clip for the song? (true/false)'
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
      const cleanedOriginal = extractCommandPrompt(String(originalUserText));

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

