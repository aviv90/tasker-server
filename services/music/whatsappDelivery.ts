/**
 * WhatsApp delivery for music results
 */

import { normalizeStaticFileUrl } from '../../utils/urlUtils';
import { extractQuotedMessageId } from '../../utils/messageHelpers';
import { sendErrorToUser } from '../../utils/errorSender';
import logger from '../../utils/logger';

/**
 * WhatsApp context structure
 */
export interface WhatsAppContext {
  chatId: string;
  senderName?: string;
  originalMessageId?: string;
}

/**
 * Music result structure
 */
export interface MusicResult {
  result: string;
  audioBuffer: Buffer;
  metadata?: {
    title?: string;
    duration?: number;
    model?: string;
    hasVideo?: boolean;
    lyrics?: string;
    lyric?: string;
    prompt?: string;
    gptDescriptionPrompt?: string;
  };
}

/**
 * WhatsApp delivery for music results
 */
export class MusicWhatsAppDelivery {
  /**
   * Send music result to WhatsApp
   * Handles audio conversion and metadata sending
   */
  async sendMusicToWhatsApp(whatsappContext: WhatsAppContext, musicResult: MusicResult): Promise<void> {
    try {
      const { chatId } = whatsappContext;
      logger.info(`📱 Sending music to WhatsApp: ${chatId}`);
      
      // Import WhatsApp functions dynamically to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { audioConverterService } = require('../audioConverterService');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendFileByUrl, sendTextMessage } = require('../greenApiService');
      
      // Get quotedMessageId from whatsappContext if available (needed for all messages)
      const quotedMessageId = extractQuotedMessageId({ originalMessageId: whatsappContext?.originalMessageId });
      
      // Note: Video is now handled separately via /api/v1/mp4/generate and its own callback
      // This function only sends the audio as voice note
      
      // Convert MP3 to Opus for voice note
      logger.info('🔄 Converting music to Opus format for voice note...', { chatId });
      const conversionResult = await audioConverterService.convertAndSaveAsOpus(musicResult.audioBuffer, 'mp3');
      
      if (!conversionResult.success) {
        logger.error('❌ Audio conversion failed:', { error: conversionResult.error, chatId });
        // Fallback: send as regular MP3 file
        const fileName = `suno_music_${Date.now()}.mp3`;
        const fullAudioUrl = normalizeStaticFileUrl(musicResult.result);
        await sendFileByUrl(chatId, fullAudioUrl, fileName, '', quotedMessageId || undefined, 1000);
      } else {
        // Send as voice note with Opus format
        const fullAudioUrl = normalizeStaticFileUrl(conversionResult.fileName || '');
        await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '', quotedMessageId || undefined, 1000);
        logger.info(`✅ Music sent as voice note: ${conversionResult.fileName}`, { chatId });
      }
      
      // Send song information and lyrics as separate text message
      let songInfo = '';
      if (musicResult.metadata) {
        const meta = musicResult.metadata;
        
        songInfo = `🎵 **${meta.title || 'שיר חדש'}**\n`;
        if (meta.duration) songInfo += `⏱️ משך: ${Math.round(meta.duration)}s\n`;
        if (meta.model) songInfo += `🤖 מודל: ${meta.model}\n`;
        if (meta.hasVideo) songInfo += `🎬 קליפ: כלול\n`;
        
        // Add lyrics if available - with better fallback logic
        if (meta.lyrics && meta.lyrics.trim()) {
          songInfo += `\n📝 **מילות השיר:**\n${meta.lyrics}`;
        } else if (meta.lyric && meta.lyric.trim()) {
          songInfo += `\n📝 **מילות השיר:**\n${meta.lyric}`;
        } else if (meta.prompt && meta.prompt.trim()) {
          songInfo += `\n📝 **מילות השיר:**\n${meta.prompt}`;
        } else if (meta.gptDescriptionPrompt && meta.gptDescriptionPrompt.trim()) {
          songInfo += `\n📝 **תיאור השיר:**\n${meta.gptDescriptionPrompt}`;
        } else {
          songInfo += `\n📝 **מילות השיר:** לא זמינות`;
        }
      } else {
        songInfo = '🎵 השיר מוכן!';
        logger.warn('⚠️ No metadata available for song', { chatId });
      }
      await sendTextMessage(chatId, songInfo, quotedMessageId || undefined, 1000);
      
      logger.info(`✅ Music delivered to WhatsApp: ${musicResult.metadata?.title || 'Generated Music'}`, { chatId });
    } catch (error: unknown) {
      logger.error('❌ Error sending music to WhatsApp:', { error, chatId: whatsappContext.chatId });
      // Try to send error message to user
      try {
        const quotedMessageId = extractQuotedMessageId({ originalMessageId: whatsappContext.originalMessageId });
        await sendErrorToUser(whatsappContext.chatId, error, { 
          context: 'SENDING_SONG', 
          quotedMessageId: quotedMessageId || undefined 
        });
      } catch (sendError: unknown) {
        logger.error('❌ Failed to send error message:', { error: sendError, chatId: whatsappContext.chatId });
      }
      throw error;
    }
  }
}

