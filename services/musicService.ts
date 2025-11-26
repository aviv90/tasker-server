/**
 * Music Service
 * Main service for music generation operations
 */

import { MusicGeneration } from './music/generation';
import { MusicCallbacks } from './music/callbacks';
import { MusicVideo } from './music/video';
import { MusicWhatsAppDelivery, WhatsAppContext, MusicResult } from './music/whatsappDelivery';

/**
 * Music generation options
 */
export interface MusicGenerationOptions {
  whatsappContext?: WhatsAppContext | null;
  makeVideo?: boolean;
  model?: string;
  style?: string;
  title?: string;
  tags?: string[];
  duration?: number;
  [key: string]: unknown;
}

/**
 * Music Service interface for managers
 * This is the interface that managers expect
 */
export interface MusicServiceInterface {
  baseUrl: string;
  headers: Record<string, string>;
  pendingTasks?: Map<string, unknown>;
  pendingVideoTasks?: Map<string, unknown>;
}

/**
 * Music Service class
 */
class MusicService implements MusicServiceInterface {
  private apiKey: string | undefined;
  public baseUrl: string;
  public headers: Record<string, string>;
  public generationManager: MusicGeneration;
  public callbacksManager: MusicCallbacks;
  public videoManager: MusicVideo;
  public whatsappDelivery: MusicWhatsAppDelivery;
  public pendingTasks: Map<string, unknown>;
  public pendingVideoTasks: Map<string, unknown>;

  constructor() {
    this.apiKey = process.env.KIE_API_KEY;
    this.baseUrl = 'https://api.kie.ai';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    
    // Initialize managers
    this.generationManager = new MusicGeneration(this as MusicServiceInterface);
    this.callbacksManager = new MusicCallbacks(this as MusicServiceInterface);
    this.videoManager = new MusicVideo(this as MusicServiceInterface);
    this.whatsappDelivery = new MusicWhatsAppDelivery();
    
    // Task tracking maps
    this.pendingTasks = new Map();
    this.pendingVideoTasks = new Map();
  }

  // ═══════════════════ GENERATION ═══════════════════

  async generateMusicWithLyrics(prompt: string, options: MusicGenerationOptions = {}): Promise<unknown> {
    if (!this.generationManager) {
      throw new Error('MusicService: generationManager is not initialized');
    }
    return this.generationManager.generateMusicWithLyrics(prompt, options);
  }

  async generateInstrumentalMusic(prompt: string, options: MusicGenerationOptions = {}): Promise<unknown> {
    if (!this.generationManager) {
      throw new Error('MusicService: generationManager is not initialized');
    }
    return this.generationManager.generateInstrumentalMusic(prompt, options);
  }

  async generateAdvancedMusic(prompt: string, options: MusicGenerationOptions = {}): Promise<unknown> {
    if (!this.generationManager) {
      throw new Error('MusicService: generationManager is not initialized');
    }
    return this.generationManager.generateAdvancedMusic(prompt, options);
  }

  async generateSongFromSpeech(audioBuffer: Buffer, options: MusicGenerationOptions = {}): Promise<unknown> {
    if (!this.generationManager) {
      throw new Error('MusicService: generationManager is not initialized');
    }
    return this.generationManager.generateSongFromSpeech(audioBuffer, options);
  }

  // ═══════════════════ CALLBACKS ═══════════════════

  async handleCallbackCompletion(taskId: string, callbackData: unknown): Promise<unknown> {
    return this.callbacksManager.handleCallbackCompletion(taskId, callbackData as Parameters<typeof this.callbacksManager.handleCallbackCompletion>[1]);
  }

  // ═══════════════════ VIDEO ═══════════════════

  async generateMusicVideo(musicTaskId: string, audioId: string, options: unknown = {}): Promise<unknown> {
    return this.videoManager.generateMusicVideo(musicTaskId, audioId, options as import('./music/video').VideoGenerationOptions);
  }

  async handleVideoCallbackCompletion(videoTaskId: string, callbackData: unknown): Promise<unknown> {
    return this.videoManager.handleVideoCallbackCompletion(videoTaskId, callbackData as Parameters<typeof this.videoManager.handleVideoCallbackCompletion>[1]);
  }

  async convertVideoForWhatsApp(inputPath: string, outputPath: string): Promise<boolean> {
    return this.videoManager.convertVideoForWhatsApp(inputPath, outputPath);
  }

  // ═══════════════════ WHATSAPP DELIVERY ═══════════════════

  async sendMusicToWhatsApp(whatsappContext: WhatsAppContext, musicResult: MusicResult): Promise<void> {
    return this.whatsappDelivery.sendMusicToWhatsApp(whatsappContext, musicResult);
  }
}

// Create and export instance
const musicService = new MusicService();

export default musicService;

// Also export individual methods for backward compatibility
export const {
  generateMusicWithLyrics,
  generateInstrumentalMusic,
  generateAdvancedMusic,
  generateSongFromSpeech,
  handleCallbackCompletion,
  generateMusicVideo,
  handleVideoCallbackCompletion,
  sendMusicToWhatsApp
} = musicService;

