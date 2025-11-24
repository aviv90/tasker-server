/**
 * Music callbacks handling
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { extractQuotedMessageId } from '../../utils/messageHelpers';
import { sendErrorToUser } from '../../utils/errorSender';

/**
 * Music service interface
 */
interface MusicService {
  pendingTasks?: Map<string, unknown>;
  pendingVideoTasks?: Map<string, unknown>;
  videoManager?: {
    generateMusicVideo: (taskId: string, audioId: string, options: unknown) => Promise<unknown>;
  };
  whatsappDelivery?: {
    sendMusicToWhatsApp: (context: unknown, result: unknown) => Promise<void>;
  };
}

/**
 * Task information structure (matches generation.ts)
 */
interface TaskInfo {
  taskId: string;
  type: string;
  musicOptions?: {
    prompt?: string;
    title?: string;
  };
  timestamp: number;
  whatsappContext?: {
    chatId: string;
    originalMessageId?: string;
    senderName?: string;
  } | null;
  wantsVideo?: boolean;
  extendOptions?: unknown;
  coverOptions?: unknown;
  instrumentalOptions?: unknown;
}

/**
 * Task information structure
 */
interface TaskInfo {
  taskId: string;
  type: string;
  musicOptions?: {
    prompt?: string;
    title?: string;
  };
  timestamp: number;
  whatsappContext?: {
    chatId: string;
    originalMessageId?: string;
    senderName?: string;
  } | null;
  wantsVideo?: boolean;
  extendOptions?: unknown;
  coverOptions?: unknown;
  instrumentalOptions?: unknown;
}

/**
 * Song data structure from callback
 */
interface SongData {
  id?: string;
  title?: string;
  duration?: number;
  tags?: string[];
  modelName?: string;
  lyric?: string;
  lyrics?: string;
  prompt?: string;
  gptDescriptionPrompt?: string;
  audioUrl?: string;
  audio_url?: string;
  url?: string;
  stream_audio_url?: string;
  source_stream_audio_url?: string;
}

/**
 * Callback data structure
 */
interface CallbackData {
  code?: number;
  msg?: string;
  data?: {
    callbackType?: string;
    data?: SongData[];
  };
}

/**
 * Callback result structure
 */
interface CallbackResult {
  status?: string;
  message?: string;
  error?: string;
  text?: string;
  audioBuffer?: Buffer;
  result?: string;
  metadata?: {
    title?: string;
    duration?: number;
    tags?: string[];
    model?: string;
    type?: string;
    totalTracks?: number;
    lyrics?: string;
  };
}

/**
 * Music callbacks handling
 */
export class MusicCallbacks {
  private musicService: MusicService;

  constructor(musicService: MusicService) {
    this.musicService = musicService;
  }

  /**
   * Method to handle callback completion
   */
  async handleCallbackCompletion(taskId: string, callbackData: CallbackData): Promise<CallbackResult | undefined> {
    try {
      const taskInfo = this.musicService.pendingTasks?.get(taskId) as TaskInfo | undefined;
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
          const firstSong = songs[0] as SongData;
          console.log(`🎵 First song: ${firstSong.title || 'Unknown'} (${firstSong.duration || 0}s)`);
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
                    
            const result: CallbackResult = {
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
            if (taskInfo.whatsappContext && this.musicService.whatsappDelivery) {
              console.log(`📱 Sending music to WhatsApp client: ${taskInfo.whatsappContext.chatId}`);
              
              try {
                await this.musicService.whatsappDelivery.sendMusicToWhatsApp(taskInfo.whatsappContext, result);
                console.log('✅ Music sent to WhatsApp successfully');
              } catch (whatsappError: unknown) {
                console.error('❌ Failed to send music to WhatsApp:', whatsappError);
              }
            }
                    
            // If video was requested, generate it now (separate API call)
            if (taskInfo.wantsVideo && firstSong.id && this.musicService.videoManager) {
              console.log('🎬 Initiating video generation');
              
              try {
                const videoResult = await this.musicService.videoManager.generateMusicVideo(taskId, firstSong.id, {
                  whatsappContext: taskInfo.whatsappContext,
                  author: taskInfo.whatsappContext?.senderName
                }) as { error?: string; videoTaskId?: string };
                
                if (videoResult.error) {
                  console.error('❌ Failed to start video generation:', videoResult.error);
                  // Send error message to user
                  if (taskInfo.whatsappContext) {
                    const quotedMessageId = extractQuotedMessageId({ originalMessageId: taskInfo.whatsappContext.originalMessageId });
                    await sendErrorToUser(taskInfo.whatsappContext.chatId, videoResult.error, { 
                      customMessage: `⚠️ השיר נוצר אבל הייתה בעיה ביצירת הוידאו: ${videoResult.error}`,
                      quotedMessageId: quotedMessageId || undefined
                    });
                  }
                } else {
                  console.log(`✅ Video generation started: ${videoResult.videoTaskId}`);
                  // Notify user that video is being generated
                  if (taskInfo.whatsappContext) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { sendTextMessage } = require('../greenApiService');
                    const quotedMessageId = extractQuotedMessageId({ originalMessageId: taskInfo.whatsappContext?.originalMessageId });
                    await sendTextMessage(
                      taskInfo.whatsappContext.chatId,
                      '🎬 מייצר קליפ לשיר... אשלח בעוד כמה רגעים! ⏳',
                      quotedMessageId || undefined,
                      1000
                    );
                  }
                }
              } catch (videoError: unknown) {
                console.error('❌ Error initiating video generation:', videoError);
              }
            } else if (taskInfo.wantsVideo && !firstSong.id) {
              console.warn('⚠️ Video was requested but no audio ID available');
            }
                    
            // Clean up task info
            this.musicService.pendingTasks?.delete(taskId);
                    
            // Notify creativeAudioService if it's waiting for this callback
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { creativeAudioService } = require('../creativeAudioService');
              if (creativeAudioService.pendingCallbacks && creativeAudioService.pendingCallbacks.has(taskId)) {
                const callback = creativeAudioService.pendingCallbacks.get(taskId) as { resolve: (buffer: Buffer) => void };
                creativeAudioService.pendingCallbacks.delete(taskId);
                callback.resolve(finalAudioBuffer);
              }
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              console.warn(`⚠️ Could not notify creativeAudioService: ${errorMessage}`);
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
        console.log('⚠️ No songs found in callback or callback type not supported');
        console.log(`📋 Callback code: ${callbackData.code}, type: ${callbackData.data?.callbackType}`);
      }

      // Clean up task info
      this.musicService.pendingTasks?.delete(taskId);
      return { error: 'Callback processing failed' };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error processing callback for task ${taskId}:`, errorMessage);
      this.musicService.pendingTasks?.delete(taskId);
      return { error: errorMessage || 'Callback processing failed' };
    }
  }
}

