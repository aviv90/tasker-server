const { getStaticFileUrl } = require('../../utils/urlUtils');

/**
 * WhatsApp delivery for music results
 */
class MusicWhatsAppDelivery {
  /**
   * Send music result to WhatsApp
   * Handles audio conversion and metadata sending
   */
  async sendMusicToWhatsApp(whatsappContext, musicResult) {
    try {
      const { chatId, senderName } = whatsappContext;
      console.log(`📱 Sending music to WhatsApp: ${chatId}`);
      
      // Import WhatsApp functions dynamically to avoid circular dependency
      const { audioConverterService } = require('../audioConverterService');
      const { sendFileByUrl, sendTextMessage } = require('../greenApiService');
      
      // Note: Video is now handled separately via /api/v1/mp4/generate and its own callback
      // This function only sends the audio as voice note
      
      // Convert MP3 to Opus for voice note
      console.log(`🔄 Converting music to Opus format for voice note...`);
      const conversionResult = await audioConverterService.convertAndSaveAsOpus(musicResult.audioBuffer, 'mp3');
      
      if (!conversionResult.success) {
        console.error('❌ Audio conversion failed:', conversionResult.error);
        // Fallback: send as regular MP3 file
        const fileName = `suno_music_${Date.now()}.mp3`;
        const fullAudioUrl = musicResult.result.startsWith('http') 
          ? musicResult.result 
          : getStaticFileUrl(musicResult.result.replace('/static/', ''));
        await sendFileByUrl(chatId, fullAudioUrl, fileName, '');
      } else {
        // Send as voice note with Opus format
        const fullAudioUrl = getStaticFileUrl(conversionResult.fileName);
        await sendFileByUrl(chatId, fullAudioUrl, conversionResult.fileName, '');
        console.log(`✅ Music sent as voice note: ${conversionResult.fileName}`);
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
        songInfo = `🎵 השיר מוכן!`;
        console.log('⚠️ No metadata available for song');
      }
      
      await sendTextMessage(chatId, songInfo);
      
      console.log(`✅ Music delivered to WhatsApp: ${musicResult.metadata?.title || 'Generated Music'}`);
    } catch (error) {
      console.error('❌ Error sending music to WhatsApp:', error);
      // Try to send error message to user
      try {
        const { sendTextMessage } = require('../greenApiService');
        const quotedMessageId = whatsappContext.originalMessageId || null;
        await sendTextMessage(whatsappContext.chatId, `❌ שגיאה בשליחת השיר: ${error.message || error}`, quotedMessageId);
      } catch (sendError) {
        console.error('❌ Failed to send error message:', sendError);
      }
      throw error;
    }
  }
}

module.exports = MusicWhatsAppDelivery;

