/**
 * Creative Audio Processing Service
 * 
 * Orchestrator for creative audio effects, background music, and mixing.
 * Refactored to use modular components (Phase P1-1)
 */

import { ensureTempDir } from '../utils/tempFileUtils';
import { getRandomEffect, applyCreativeEffect } from './creativeAudio/effects';
import {
  getRandomBackground,
  getRandomInstrumentalStyle,
  generateBackgroundMusic,
  generateSunoInstrumental,
  handleSunoCallback
} from './creativeAudio/background';
import { mixWithBackground, processVoiceCreatively } from './creativeAudio/mixing';

/**
 * Creative Audio Processing Service
 * Handles creative audio effects and remixing using FFmpeg
 */
class CreativeAudioService {
  constructor() {
    ensureTempDir();
  }

  // Delegate to effects module
  getRandomEffect(): unknown {
    return getRandomEffect();
  }

  async applyCreativeEffect(audioBuffer: Buffer, inputFormat: string = 'mp3', effect: string): Promise<{ success: boolean; audioBuffer: Buffer; size: number }> {
    return await applyCreativeEffect(audioBuffer, inputFormat, effect) as { success: boolean; audioBuffer: Buffer; size: number };
  }

  // Delegate to background module
  getRandomBackground(): unknown {
    return getRandomBackground();
  }

  getRandomInstrumentalStyle(): unknown {
    return getRandomInstrumentalStyle();
  }

  async generateBackgroundMusic(duration: number, style: string = 'upbeat'): Promise<string> {
    return await generateBackgroundMusic(duration, style) as string;
  }

  async generateSunoInstrumental(duration: number, style: Record<string, unknown>): Promise<string> {
    return await generateSunoInstrumental(duration, style) as string;
  }

  async handleSunoCallback(taskId: string, audioBuffer: Buffer): Promise<void> {
    return await handleSunoCallback(taskId, audioBuffer);
  }

  // Delegate to mixing module
  async mixWithBackground(voiceBuffer: Buffer, voiceFormat: string = 'mp3', backgroundPath: string): Promise<{ success: boolean; audioBuffer: Buffer; size: number }> {
    return await mixWithBackground(voiceBuffer, voiceFormat, backgroundPath) as { success: boolean; audioBuffer: Buffer; size: number };
  }

  async processVoiceCreatively(audioBuffer: Buffer, inputFormat: string = 'mp3'): Promise<{ success: boolean; audioBuffer?: Buffer; size?: number; effect?: string; background?: string; description?: string; error?: string }> {
    return await processVoiceCreatively(audioBuffer, inputFormat) as { success: boolean; audioBuffer?: Buffer; size?: number; effect?: string; background?: string; description?: string; error?: string };
  }
}

// Create and export instance
const creativeAudioService = new CreativeAudioService();

export default creativeAudioService;

// Export for backward compatibility
export { creativeAudioService };
export { CreativeAudioService };

