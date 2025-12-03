/**
 * Music generation operations
 */

import { sanitizeText } from '../../utils/textSanitizer';
import { getApiUrl } from '../../utils/urlUtils';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { getStaticFileUrl } from '../../utils/urlUtils';
import logger from '../../utils/logger';

import {
  MusicService,
  TaskInfo,
  MusicOptions,
  MusicGenerationOptions,
  GenerationResult,
  UploadResult
} from './types';

/**
 * Music generation operations
 */
export class MusicGeneration {
  private musicService: MusicService;

  constructor(musicService: MusicService) {
    this.musicService = musicService;
  }

  async generateMusicWithLyrics(prompt: string, options: MusicGenerationOptions = {}): Promise<GenerationResult> {
    try {
      logger.info('🎵 Starting Suno music generation with lyrics');

      const cleanPrompt = sanitizeText(prompt);

      // Basic mode - compatible with existing API, enhanced with V5
      const musicOptions: MusicOptions = {
        prompt: cleanPrompt,
        customMode: false, // Let Suno be creative
        instrumental: false, // We want lyrics
        model: options.model || 'V5', // Use V5 for latest and best quality
        callBackUrl: getApiUrl('/api/music/callback')
      };

      // Only add advanced parameters if they are explicitly provided
      if (options.style) musicOptions.style = options.style;
      if (options.title) musicOptions.title = options.title;
      if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
      if (options.duration) musicOptions.duration = options.duration;

      logger.debug('🎼 Using automatic mode');

      // Step 1: Submit music generation task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(musicOptions)
      });

      const generateData = await generateResponse.json() as { code?: number; msg?: string; data?: { taskId?: string } };

      if (!generateResponse.ok || generateData.code !== 200) {
        logger.error('❌ Suno music generation task submission failed:', { error: generateData.msg });
        return { error: generateData.msg || 'Music generation task submission failed' };
      }

      const taskId = generateData.data?.taskId;
      if (!taskId) {
        return { error: 'No task ID returned from generation API' };
      }

      logger.info(`✅ Suno music generation task submitted successfully. Task ID: ${taskId}`);

      logger.debug('📞 Waiting for callback notification instead of polling...');

      // Store task info for callback handling
      const taskInfo: TaskInfo = {
        taskId: taskId,
        type: 'with-lyrics',
        musicOptions: musicOptions,
        timestamp: Date.now(),
        // Store WhatsApp context for callback delivery
        whatsappContext: options.whatsappContext || null,
        // Store if video was requested (for separate video generation after music completes)
        wantsVideo: options.makeVideo === true
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת השיר החלה! ממתין להשלמה...'
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Suno music generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return { error: errorMessage || 'Unknown error' };
    }
  }

  async generateInstrumentalMusic(prompt: string, options: MusicGenerationOptions = {}): Promise<GenerationResult> {
    try {
      logger.info('🎼 Starting Suno instrumental music generation');

      const cleanPrompt = sanitizeText(prompt);

      // Basic instrumental mode - compatible with existing API, enhanced with V5
      const musicOptions: MusicOptions = {
        prompt: cleanPrompt,
        customMode: false, // Let Suno be creative  
        instrumental: true, // No lyrics
        model: options.model || 'V5', // Use V5 for latest and best quality
        callBackUrl: getApiUrl('/api/music/callback')
      };

      // Only add advanced parameters if they are explicitly provided
      if (options.style) musicOptions.style = options.style;
      if (options.title) musicOptions.title = options.title;
      if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
      if (options.duration) musicOptions.duration = options.duration;

      logger.debug('🎹 Using automatic instrumental mode');

      // Use the same logic as generateMusicWithLyrics but with instrumental settings
      return await this._generateMusic(musicOptions, 'instrumental');

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Suno instrumental music generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return { error: errorMessage || 'Unknown error' };
    }
  }

  private async _generateMusic(musicOptions: MusicOptions, type: string = 'with-lyrics'): Promise<GenerationResult> {
    // Submit generation task
    const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate`, {
      method: 'POST',
      headers: this.musicService.headers,
      body: JSON.stringify(musicOptions)
    });

    const generateData = await generateResponse.json() as { code?: number; msg?: string; data?: { taskId?: string } };

    if (!generateResponse.ok || generateData.code !== 200) {
      logger.error(`❌ Suno ${type} music task submission failed:`, { error: generateData.msg });
      return { error: generateData.msg || `${type} music generation task submission failed` };
    }

    const taskId = generateData.data?.taskId;
    if (!taskId) {
      return { error: `No task ID returned from ${type} generation API` };
    }

    logger.info(`✅ Suno ${type} music task submitted successfully. Task ID: ${taskId}`);

    logger.debug('📞 Waiting for callback notification instead of polling...');

    // Store task info for callback handling
    const taskInfo: TaskInfo = {
      taskId: taskId,
      type: type,
      musicOptions: musicOptions,
      timestamp: Date.now()
    };

    // Store in a simple in-memory map (in production, use Redis or database)
    if (!this.musicService.pendingTasks) {
      this.musicService.pendingTasks = new Map();
    }
    this.musicService.pendingTasks.set(taskId, taskInfo);

    // Return immediately - callback will handle completion
    return {
      taskId: taskId,
      status: 'pending',
      message: `🎵 יצירת ${type} החלה! ממתין להשלמה...`
    };
  }

  async generateAdvancedMusic(prompt: string, options: MusicGenerationOptions = {}): Promise<GenerationResult> {
    try {
      logger.info('🎵 Starting Suno V5 advanced music generation');

      const cleanPrompt = sanitizeText(prompt);

      // Enhanced music styles for V5
      const musicStyles = [
        'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop',
        'Country', 'Folk', 'R&B', 'Reggae', 'Blues', 'Indie',
        'Alternative', 'Soul', 'Funk', 'Dance', 'Acoustic', 'Lo-fi',
        'Ambient', 'Cinematic', 'World', 'Experimental', 'Synthwave', 'Chill'
      ];

      const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)] || 'Pop';

      // Generate title from prompt
      const generateTitle = (promptText: string): string => {
        const words = promptText.split(' ').slice(0, 4).join(' ');
        const suffixes = ['Song', 'Melody', 'Tune', 'Beat', 'Rhythm', 'Vibe', 'Sound'];
        const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)] || 'Song';
        return `${words} ${randomSuffix}`.substring(0, 80);
      };

      // Advanced V5 configuration with full control
      const musicOptions: MusicOptions = {
        prompt: cleanPrompt,
        customMode: options.customMode !== undefined ? options.customMode : true, // Use custom mode for advanced control
        instrumental: options.instrumental || false,
        model: options.model || 'V5', // Always use V5 for advanced features
        callBackUrl: getApiUrl('/api/music/callback'),
        // V5 advanced parameters
        style: options.style || randomStyle,
        title: options.title || generateTitle(cleanPrompt),
        tags: options.tags || [randomStyle.toLowerCase()],
        duration: options.duration || 60, // V5 supports longer tracks
        genre: options.genre || randomStyle.toLowerCase(),
        mood: options.mood || 'upbeat',
        tempo: options.tempo || 'medium',
        // Advanced V5 features
        instruments: options.instruments || [],
        vocalStyle: options.vocalStyle || 'natural',
        language: options.language || 'english',
        key: options.key || 'C major',
        timeSignature: options.timeSignature || '4/4',
        // Quality settings for V5
        quality: options.quality || 'high',
        stereo: options.stereo !== false, // Default to stereo
        sampleRate: options.sampleRate || 44100
      };

      logger.debug('🎼 Using advanced V5 mode');

      // Use the same generation logic but with advanced options
      return await this._generateMusic(musicOptions, 'advanced');

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Suno V5 advanced music generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return { error: errorMessage || 'Unknown error' };
    }
  }

  async generateSongFromSpeech(audioBuffer: Buffer, options: MusicGenerationOptions = {}): Promise<GenerationResult> {
    try {
      logger.info('🎤 Starting Speech-to-Song generation with Add Instrumental API');

      // Step 1: Upload audio file and get public URL
      const uploadResult = await this._uploadAudioFile(audioBuffer);
      if (uploadResult.error) {
        return { error: `Audio upload failed: ${uploadResult.error}` };
      }

      // Test if upload URL is accessible externally
      if (uploadResult.uploadUrl) {
        logger.debug(`🌐 Testing external accessibility: ${uploadResult.uploadUrl}`);
        try {
          const testResponse = await fetch(uploadResult.uploadUrl, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; KieAI-Test/1.0)'
            }
          });
          logger.debug(`🌐 External access test: ${testResponse.status} ${testResponse.statusText}`);
        } catch (testError: unknown) {
          const errorMessage = testError instanceof Error ? testError.message : String(testError);
          logger.warn('❌ Upload URL accessibility test failed:', { error: errorMessage });
        }
      }

      // Step 2: Try Upload-Extend API with speech-friendly parameters
      const extendOptions: Record<string, unknown> = {
        uploadUrl: uploadResult.uploadUrl,
        defaultParamFlag: false, // Use default parameters to preserve original audio better
        prompt: options.prompt || 'Add very gentle background music while keeping the original speech clear and audible',
        callBackUrl: uploadResult.callbackUrl
      };

      logger.debug('🎼 Using Upload-Extend API with speech preservation:', { extendOptions });

      return await this._generateExtend(extendOptions);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Speech-to-Song generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return { error: errorMessage || 'Unknown error' };
    }
  }

  private async _generateExtend(extendOptions: Record<string, unknown>): Promise<GenerationResult> {
    try {
      logger.debug('🎼 Submitting Upload-Extend request');

      // Submit upload-extend task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate/upload-extend`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(extendOptions)
      });

      const generateData = await generateResponse.json() as { code?: number; message?: string; data?: { taskId?: string } };

      if (!generateResponse.ok || generateData.code !== 200) {
        logger.error('❌ Upload-Extend API error:', { error: generateData });
        return { error: (generateData.message as string) || 'Upload-Extend request failed' };
      }

      const taskId = generateData.data?.taskId;
      if (!taskId) {
        return { error: 'No task ID returned from Upload-Extend API' };
      }

      logger.info(`✅ Upload-Extend task submitted: ${taskId}`);

      logger.debug('📞 Waiting for callback notification instead of polling...');

      // Store task info for callback handling
      const taskInfo: TaskInfo = {
        taskId: taskId,
        type: 'upload-extend',
        musicOptions: extendOptions as unknown as MusicOptions,
        timestamp: Date.now()
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת Upload-Extend החלה! ממתין להשלמה...'
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('❌ Upload-Extend generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return { error: errorMessage || 'Unknown error' };
    }
  }

  // Reserved for future use
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Reserved for future use
  private async _generateCover(_coverOptions: Record<string, unknown>): Promise<GenerationResult> {
    return { error: 'Upload-Cover not yet implemented' };
  }

  private async _uploadAudioFile(audioBuffer: Buffer): Promise<UploadResult> {
    try {
      const filename = `speech_${uuidv4()}.mp3`; // Keep .mp3 extension for compatibility
      const tempFilePath = path.join(__dirname, '..', '..', 'public', 'tmp', filename);
      const outputDir = path.dirname(tempFilePath);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save audio file temporarily
      fs.writeFileSync(tempFilePath, audioBuffer);

      // Verify file was written correctly
      const fileStats = fs.statSync(tempFilePath);
      logger.debug(`💾 Audio file saved: ${filename}, size: ${fileStats.size} bytes`);

      // Create public URL for the uploaded file
      const uploadUrl = getStaticFileUrl(filename);
      const callbackUrl = this._getCallbackUrl();

      logger.info(`✅ Audio file uploaded: ${uploadUrl}`);

      return { uploadUrl, callbackUrl };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Audio upload error:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
      return { error: errorMessage || 'Audio upload failed' };
    }
  }

  // Reserved for future use
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Reserved for future use
  private async _generateInstrumental(_instrumentalOptions: Record<string, unknown>): Promise<GenerationResult> {
    return { error: 'Add Instrumental not yet implemented' };
  }

  private _getCallbackUrl(): string {
    return getApiUrl('/api/music/callback');
  }
}

