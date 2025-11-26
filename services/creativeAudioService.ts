/**
 * Creative Audio Processing Service
 * 
 * Orchestrator for creative audio effects, background music, and mixing.
 * Refactored to use modular components (Phase P1-1)
 */

import { ensureTempDir } from '../utils/tempFileUtils';
import { getRandomEffect, applyCreativeEffect, Effect, EFFECTS } from './creativeAudio/effects';
import {
  getRandomBackground,
  getRandomInstrumentalStyle,
  generateBackgroundMusic,
  generateSunoInstrumental,
  handleSunoCallback
} from './creativeAudio/background';
import { mixWithBackground, processVoiceCreatively } from './creativeAudio/mixing';
import logger from '../utils/logger';

interface InstrumentalStyle {
  name: string;
  prompt: string;
  style: string;
  mood: string;
  tempo: string;
}

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

  async applyCreativeEffect(audioBuffer: Buffer, inputFormat: string = 'mp3', effect: string | Effect): Promise<{ success: boolean; audioBuffer: Buffer; size: number }> {
    let effectObj: Effect;
    if (typeof effect === 'string') {
      // Try to find by key
      if (EFFECTS[effect]) {
        effectObj = EFFECTS[effect];
      } else {
         // If effect string matches a name in the values
         const found = Object.values(EFFECTS).find(e => e.name === effect);
         if (found) {
            effectObj = found;
         } else {
            // Default fallback or error?
            // For now, let's pick a default if unknown, or maybe 'robot'
            logger.warn(`Unknown effect '${effect}', defaulting to robot`);
            effectObj = EFFECTS['robot']!;
         }
      }
    } else {
      effectObj = effect;
    }
    
    const result = await applyCreativeEffect(audioBuffer, inputFormat, effectObj);
    return {
        success: result.success,
        audioBuffer: result.audioBuffer!,
        size: result.size!
    };
  }

  // Delegate to background module
  getRandomBackground(): unknown {
    return getRandomBackground();
  }

  getRandomInstrumentalStyle(): unknown {
    return getRandomInstrumentalStyle();
  }

  async generateBackgroundMusic(duration: number, style: string = 'upbeat'): Promise<string> {
    return await generateBackgroundMusic(duration, style);
  }

  async generateSunoInstrumental(duration: number, style: Record<string, unknown>): Promise<string> {
    // Cast style to InstrumentalStyle, filling in defaults if missing or assume safe if coming from valid source
    const typedStyle = style as unknown as InstrumentalStyle;
    return await generateSunoInstrumental(duration, typedStyle);
  }

  async handleSunoCallback(taskId: string, audioBuffer: Buffer): Promise<void> {
    return handleSunoCallback(taskId, audioBuffer);
  }

  // Delegate to mixing module
  async mixWithBackground(voiceBuffer: Buffer, voiceFormat: string = 'mp3', backgroundPath: string): Promise<{ success: boolean; audioBuffer: Buffer; size: number }> {
    const result = await mixWithBackground(voiceBuffer, voiceFormat, backgroundPath);
    return {
        success: result.success,
        audioBuffer: result.audioBuffer!,
        size: result.size!
    };
  }

  async processVoiceCreatively(audioBuffer: Buffer, inputFormat: string = 'mp3'): Promise<{ success: boolean; audioBuffer?: Buffer; size?: number; effect?: string; background?: string; description?: string; error?: string }> {
    return await processVoiceCreatively(audioBuffer, inputFormat);
  }
}

// Create and export instance
const creativeAudioService = new CreativeAudioService();

export default creativeAudioService;

// Export for backward compatibility
export { creativeAudioService };
export { CreativeAudioService };
