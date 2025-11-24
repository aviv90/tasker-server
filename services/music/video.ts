/**
 * Video operations for music service
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getApiUrl, getStaticFileUrl } from '../../utils/urlUtils';
import { extractQuotedMessageId } from '../../utils/messageHelpers';
import { FILE_SIZE } from '../../utils/constants';

/**
 * Music service interface
 */
interface MusicService {
  baseUrl: string;
  headers: Record<string, string>;
  pendingVideoTasks?: Map<string, VideoTaskInfo>;
}

/**
 * Video task information
 */
interface VideoTaskInfo {
  videoTaskId: string;
  musicTaskId: string;
  audioId: string;
  timestamp: number;
  whatsappContext?: {
    chatId: string;
    originalMessageId?: string;
    senderName?: string;
  } | null;
}

/**
 * Video generation options
 */
export interface VideoGenerationOptions {
  whatsappContext?: {
    chatId: string;
    originalMessageId?: string;
    senderName?: string;
  } | null;
  author?: string;
  domainName?: string;
}

/**
 * Video generation result
 */
export interface VideoGenerationResult {
  videoTaskId?: string;
  status?: string;
  message?: string;
  error?: string;
}

/**
 * Video callback result
 */
export interface VideoCallbackResult {
  success?: boolean;
  videoUrl?: string;
  fileName?: string;
  error?: string;
}

/**
 * Video operations for music service
 */
export class MusicVideo {
  private musicService: MusicService;

  constructor(musicService: MusicService) {
    this.musicService = musicService;
  }

  /**
   * Convert video to WhatsApp-compatible format using FFmpeg
   * @param inputPath - Input video file path
   * @param outputPath - Output video file path
   * @returns Success status
   */
  async convertVideoForWhatsApp(inputPath: string, outputPath: string): Promise<boolean> {
    try {
      console.log('🔄 Converting video to WhatsApp format...');
      console.log(`   Input: ${inputPath}`);
      console.log(`   Output: ${outputPath}`);
      
      // FFmpeg command for WhatsApp-compatible MP4:
      // - H.264 video codec (baseline profile for maximum compatibility)
      // - AAC audio codec
      // - MP4 container with faststart for streaming
      // - Maximum bitrate: FILE_SIZE.MAX_BITRATE (WhatsApp recommendation)
      const ffmpegCommand = `ffmpeg -i "${inputPath}" \
          -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p \
          -c:a aac -b:a 128k -ar 44100 \
          -movflags +faststart \
          -b:v ${FILE_SIZE.MAX_BITRATE}k -maxrate ${FILE_SIZE.MAX_BITRATE}k -bufsize ${FILE_SIZE.MAX_BITRATE_BUFFER}k \
          -y "${outputPath}"`;
      
      execSync(ffmpegCommand, { stdio: 'pipe' });
      
      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg conversion failed - output file not created');
      }
      
      const outputSize = fs.statSync(outputPath).size;
      console.log(`✅ Video converted successfully (${(outputSize / 1024 / 1024).toFixed(2)} MB)`);
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ FFmpeg conversion error:', errorMessage);
      return false;
    }
  }

  /**
   * Generate music video for an existing audio track
   * This is a separate API call that happens AFTER music generation completes
   */
  async generateMusicVideo(
    musicTaskId: string,
    audioId: string,
    options: VideoGenerationOptions = {}
  ): Promise<VideoGenerationResult> {
    try {
      console.log('🎬 Starting music video generation');
      
      const videoOptions: Record<string, unknown> = {
        taskId: musicTaskId,
        audioId: audioId,
        callBackUrl: getApiUrl('/api/video/callback')
      };
      
      // Optional branding parameters
      if (options.author) videoOptions.author = options.author;
      if (options.domainName) videoOptions.domainName = options.domainName;
      
      // Submit video generation task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/mp4/generate`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(videoOptions)
      });

      const generateData = await generateResponse.json() as { code?: number; msg?: string; data?: { taskId?: string } };
      
      if (!generateResponse.ok || generateData.code !== 200) {
        console.error('❌ Music video generation task submission failed:', generateData.msg);
        return { error: generateData.msg || 'Video generation task submission failed' };
      }

      const videoTaskId = generateData.data?.taskId;
      if (!videoTaskId) {
        return { error: 'No task ID returned from video generation API' };
      }

      console.log(`✅ Music video generation task submitted successfully. Video Task ID: ${videoTaskId}`);
      
      // Store video task info for callback handling
      const videoTaskInfo: VideoTaskInfo = {
        videoTaskId: videoTaskId,
        musicTaskId: musicTaskId,
        audioId: audioId,
        timestamp: Date.now(),
        whatsappContext: options.whatsappContext || null
      };
      
      if (!this.musicService.pendingVideoTasks) {
        this.musicService.pendingVideoTasks = new Map();
      }
      this.musicService.pendingVideoTasks.set(videoTaskId, videoTaskInfo);
      
      return {
        videoTaskId: videoTaskId,
        status: 'pending',
        message: '🎬 יצירת הווידאו החלה! ממתין להשלמה...'
      };
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Music video generation error:', errorMessage);
      return { error: errorMessage || 'Unknown error' };
    }
  }

  /**
   * Handle video callback completion
   */
  async handleVideoCallbackCompletion(
    videoTaskId: string,
    callbackData: { code?: number; msg?: string; data?: { video_url?: string } }
  ): Promise<VideoCallbackResult> {
    try {
      const videoTaskInfo = this.musicService.pendingVideoTasks?.get(videoTaskId);
      if (!videoTaskInfo) {
        console.warn(`⚠️ No video task info found for callback: ${videoTaskId}`);
        return { error: 'No video task info found' };
      }
      
      console.log(`🎬 Processing video callback for task: ${videoTaskId}`);
      
      if (callbackData.code === 200) {
        const videoUrl = callbackData.data?.video_url;
        
        if (videoUrl) {
          console.log(`✅ Music video generated successfully: ${videoUrl}`);
          console.log('⏰ Note: Video link is valid for 14 days');
          
          // Download video
          const videoResponse = await fetch(videoUrl);
          if (!videoResponse.ok) {
            throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
          }
          
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          
          // Save original video to temp file
          const originalVideoFileName = `music_video_original_${uuidv4()}.mp4`;
          const originalVideoFilePath = path.join(__dirname, '..', '..', 'public', 'tmp', originalVideoFileName);
          fs.writeFileSync(originalVideoFilePath, videoBuffer);
          
          // Verify original file
          await new Promise(resolve => setTimeout(resolve, 500));
          if (!fs.existsSync(originalVideoFilePath) || fs.statSync(originalVideoFilePath).size < 10000) {
            throw new Error('Original video file was not downloaded successfully');
          }
          
          console.log(`✅ Original video saved: ${originalVideoFileName}`);
          
          // Convert to WhatsApp-compatible format
          const tempVideoFileName = `music_video_${uuidv4()}.mp4`;
          const tempVideoFilePath = path.join(__dirname, '..', '..', 'public', 'tmp', tempVideoFileName);
          
          const conversionSuccess = await this.convertVideoForWhatsApp(originalVideoFilePath, tempVideoFilePath);
          
          if (!conversionSuccess) {
            console.warn('⚠️ FFmpeg conversion failed, using original video');
            // If conversion fails, use original file
            fs.copyFileSync(originalVideoFilePath, tempVideoFilePath);
          } else {
            console.log(`✅ Video converted to WhatsApp format: ${tempVideoFileName}`);
          }
          
          // Delete original file to save space
          try {
            fs.unlinkSync(originalVideoFilePath);
            console.log('🗑️ Deleted original video file');
          } catch (deleteError: unknown) {
            const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
            console.warn('⚠️ Could not delete original file:', errorMessage);
          }
          
          // If WhatsApp context exists, send video
          if (videoTaskInfo.whatsappContext) {
            console.log(`📱 Sending video to WhatsApp: ${videoTaskInfo.whatsappContext.chatId}`);
            
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { sendFileByUrl } = require('../greenApiService');
              const fullVideoUrl = getStaticFileUrl(tempVideoFileName);
              const quotedMessageId = extractQuotedMessageId({ originalMessageId: videoTaskInfo.whatsappContext?.originalMessageId });
              await sendFileByUrl(
                videoTaskInfo.whatsappContext.chatId,
                fullVideoUrl,
                tempVideoFileName,
                '🎬 הקליפ מוכן!',
                quotedMessageId || undefined,
                1000
              );
              console.log('✅ Video sent to WhatsApp successfully');
            } catch (whatsappError: unknown) {
              console.error('❌ Failed to send video to WhatsApp:', whatsappError);
            }
          }
          
          // Clean up task info
          this.musicService.pendingVideoTasks?.delete(videoTaskId);
          
          return {
            success: true,
            videoUrl: videoUrl,
            fileName: tempVideoFileName
          };
        }
      } else {
        console.error('❌ Video generation failed:', callbackData.msg);
      }
      
      // Clean up task info
      this.musicService.pendingVideoTasks?.delete(videoTaskId);
      return { error: callbackData.msg || 'Video generation failed' };
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error processing video callback for task ${videoTaskId}:`, errorMessage);
      this.musicService.pendingVideoTasks?.delete(videoTaskId);
      return { error: errorMessage || 'Video callback processing failed' };
    }
  }
}

