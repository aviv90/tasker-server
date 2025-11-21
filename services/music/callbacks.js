const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Music callbacks handling
 */
class MusicCallbacks {
  constructor(musicService) {
    this.musicService = musicService;
  }

  // Method to handle callback completion
  async handleCallbackCompletion(taskId, callbackData) {
    try {
      const taskInfo = this.musicService.pendingTasks?.get(taskId);
      if (!taskInfo) {
        console.warn(`⚠️ No task info found for callback: ${taskId}`);
        return;
      }

      console.log(`🎵 Processing callback for ${taskInfo.type} music task: ${taskId}`);
      console.log(`📋 Callback received: ${callbackData.data?.callbackType} for task ${taskId}`);

      if (callbackData.code === 200 && callbackData.data?.callbackType === 'complete') {
        const songs = callbackData.data.data || [];
        console.log(`🎵 Found ${songs.length} songs in callback`);
        
        if (songs.length > 0) {
          const firstSong = songs[0];
          console.log(`🎵 First song: ${firstSong.title} (${firstSong.duration}s)`);
          const songUrl = firstSong.audioUrl || firstSong.audio_url || firstSong.url || firstSong.stream_audio_url || firstSong.source_stream_audio_url;
          console.log(`🎵 Song URL: ${songUrl}`);
          
          if (songUrl) {
            // Download and process the audio
            const audioResponse = await fetch(songUrl);
            if (!audioResponse.ok) {
              throw new Error(`Failed to download audio: HTTP ${audioResponse.status}`);
            }

            const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            
            // Save to temp file
            const tempFileName = `temp_music_${uuidv4()}.mp3`;
            const tempFilePath = path.join(__dirname, '..', '..', 'public', 'tmp', tempFileName);
            const tmpDir = path.dirname(tempFilePath);

            if (!fs.existsSync(tmpDir)) {
              fs.mkdirSync(tmpDir, { recursive: true });
            }

            fs.writeFileSync(tempFilePath, audioBuffer);

            // Verify file
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size < 10000) {
              throw new Error('Audio file was not downloaded successfully');
            }

            console.log(`✅ Suno ${taskInfo.type} music generated successfully via callback`);
        
            const finalAudioBuffer = fs.readFileSync(tempFilePath);
            const filename = path.basename(tempFilePath);
            const publicPath = `/static/${filename}`;
                    
            const result = {
              text: taskInfo.musicOptions?.prompt || taskInfo.musicOptions?.title || `Generated ${taskInfo.type} music`,
              audioBuffer: finalAudioBuffer,
              result: publicPath,
              metadata: {
                title: firstSong.title,
                duration: firstSong.duration,
                tags: firstSong.tags,
                model: firstSong.modelName,
                type: taskInfo.type,
                totalTracks: songs.length,
                lyrics: firstSong.lyric || firstSong.lyrics || firstSong.prompt || firstSong.gptDescriptionPrompt || ''
              }
            };
                    
            // If WhatsApp context exists, send result directly to WhatsApp client
            if (taskInfo.whatsappContext) {
              console.log(`📱 Sending music to WhatsApp client: ${taskInfo.whatsappContext.chatId}`);
              
              try {
                await this.musicService.whatsappDelivery.sendMusicToWhatsApp(taskInfo.whatsappContext, result);
                console.log(`✅ Music sent to WhatsApp successfully`);
              } catch (whatsappError) {
                console.error(`❌ Failed to send music to WhatsApp:`, whatsappError);
              }
            }
                    
            // If video was requested, generate it now (separate API call)
            if (taskInfo.wantsVideo && firstSong.id) {
              console.log(`🎬 Initiating video generation`);
              
              try {
                const videoResult = await this.musicService.videoManager.generateMusicVideo(taskId, firstSong.id, {
                  whatsappContext: taskInfo.whatsappContext,
                  author: taskInfo.whatsappContext?.senderName
                });
                
                if (videoResult.error) {
                  console.error(`❌ Failed to start video generation:`, videoResult.error);
                  // Send error message to user
                  if (taskInfo.whatsappContext) {
                    const { sendTextMessage } = require('../greenApiService');
                    const quotedMessageId = taskInfo.whatsappContext.originalMessageId || null;
                    await sendErrorToUser(taskInfo.whatsappContext.chatId, videoResult.error, { 
                      customMessage: `⚠️ השיר נוצר אבל הייתה בעיה ביצירת הוידאו: ${videoResult.error}`,
                      quotedMessageId 
                    });
                  }
                } else {
                  console.log(`✅ Video generation started: ${videoResult.videoTaskId}`);
                  // Notify user that video is being generated
                  if (taskInfo.whatsappContext) {
                    const { sendTextMessage } = require('../greenApiService');
                    const quotedMessageId = taskInfo.whatsappContext?.originalMessageId || null;
                    await sendTextMessage(taskInfo.whatsappContext.chatId, '🎬 מייצר קליפ לשיר... אשלח בעוד כמה רגעים! ⏳', quotedMessageId, 1000);
                  }
                }
              } catch (videoError) {
                console.error(`❌ Error initiating video generation:`, videoError);
              }
            } else if (taskInfo.wantsVideo && !firstSong.id) {
              console.warn(`⚠️ Video was requested but no audio ID available`);
            }
                    
            // Clean up task info
            this.musicService.pendingTasks.delete(taskId);
                    
            // Notify creativeAudioService if it's waiting for this callback
            try {
              const { creativeAudioService } = require('../creativeAudioService');
              if (creativeAudioService.pendingCallbacks && creativeAudioService.pendingCallbacks.has(taskId)) {
                const callback = creativeAudioService.pendingCallbacks.get(taskId);
                creativeAudioService.pendingCallbacks.delete(taskId);
                callback.resolve(finalAudioBuffer);
              }
            } catch (err) {
              console.warn(`⚠️ Could not notify creativeAudioService: ${err.message}`);
            }
        
            return result;
          }
        }
      } else if (callbackData.data?.callbackType === 'text') {
        console.log(`📝 Text generation completed for task ${taskId}, waiting for complete callback...`);
        // Don't process yet, wait for 'complete' callback
        return { status: 'text_complete', message: '📝 יצירת הטקסט הושלמה, ממתין לאודיו...' };
      } else if (callbackData.data?.callbackType === 'first') {
        console.log(`🎵 First track completed for task ${taskId}, waiting for complete callback...`);
        // Don't process yet, wait for 'complete' callback
        return { status: 'first_complete', message: '🎵 המסלול הראשון הושלם, ממתין לכל המסלולים...' };
      } else {
        console.log(`⚠️ No songs found in callback or callback type not supported`);
        console.log(`📋 Callback code: ${callbackData.code}, type: ${callbackData.data?.callbackType}`);
      }

      // Clean up task info
      this.musicService.pendingTasks.delete(taskId);
      return { error: 'Callback processing failed' };

    } catch (error) {
      console.error(`❌ Error processing callback for task ${taskId}:`, error);
      this.musicService.pendingTasks?.delete(taskId);
      return { error: error.message || 'Callback processing failed' };
    }
  }
}

module.exports = MusicCallbacks;

