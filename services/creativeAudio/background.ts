/**
 * Creative Audio Background Music
 * 
 * Handles background music generation (synthetic and Suno instrumental)
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import musicService from '../musicService';
import { getTempDir, ensureTempDir } from '../../utils/tempFileUtils';
import logger from '../../utils/logger';
import ffmpegStatic from 'ffmpeg-static';

const ffmpegBin = ffmpegStatic || 'ffmpeg';

const execAsync = promisify(exec);

interface InstrumentalStyle {
  name: string;
  prompt: string;
  style: string;
  mood: string;
  tempo: string;
}

interface BackgroundMusicConfig {
  name: string;
  command: string;
  description: string;
}

interface PendingCallback {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Suno instrumental music styles
 */
export const INSTRUMENTAL_STYLES: Record<string, InstrumentalStyle> = {
  chill_lofi: {
    name: '🌙 Chill Lofi',
    prompt: 'chill lofi hip hop instrumental, soft piano, gentle drums, relaxing atmosphere',
    style: 'lofi',
    mood: 'chill',
    tempo: 'slow'
  },
  ambient_electronic: {
    name: '🌌 Ambient Electronic',
    prompt: 'ambient electronic instrumental, atmospheric pads, subtle synthesizers, dreamy soundscape',
    style: 'ambient',
    mood: 'dreamy',
    tempo: 'slow'
  },
  acoustic_guitar: {
    name: '🎸 Acoustic Guitar',
    prompt: 'acoustic guitar instrumental, fingerpicking, warm and organic, peaceful melody',
    style: 'acoustic',
    mood: 'peaceful',
    tempo: 'medium'
  },
  jazz_instrumental: {
    name: '🎷 Jazz Instrumental',
    prompt: 'smooth jazz instrumental, saxophone, piano, sophisticated and melodic',
    style: 'jazz',
    mood: 'sophisticated',
    tempo: 'medium'
  },
  classical_piano: {
    name: '🎹 Classical Piano',
    prompt: 'classical piano instrumental, elegant melody, soft dynamics, contemplative',
    style: 'classical',
    mood: 'elegant',
    tempo: 'slow'
  },
  electronic_dance: {
    name: '🎧 Electronic Dance',
    prompt: 'electronic dance instrumental, upbeat synthesizers, driving rhythm, energetic',
    style: 'electronic',
    mood: 'energetic',
    tempo: 'fast'
  },
  cinematic_epic: {
    name: '🎬 Cinematic Epic',
    prompt: 'cinematic orchestral instrumental, epic strings, powerful brass, dramatic',
    style: 'cinematic',
    mood: 'dramatic',
    tempo: 'medium'
  },
  blues_instrumental: {
    name: '🎵 Blues Instrumental',
    prompt: 'blues guitar instrumental, soulful melody, warm tone, emotional',
    style: 'blues',
    mood: 'soulful',
    tempo: 'medium'
  }
};

/**
 * Background music templates (short loops)
 */
export const BACKGROUND_MUSIC: Record<string, BackgroundMusicConfig> = {
  upbeat: {
    name: '🎉 Upbeat Pop',
    command: '-filter:a "volume=0.3"',
    description: 'Energetic pop background'
  },
  chill: {
    name: '🌊 Chill Vibes',
    command: '-filter:a "volume=0.25"',
    description: 'Relaxed ambient background'
  },
  dramatic: {
    name: '🎭 Dramatic',
    command: '-filter:a "volume=0.35"',
    description: 'Cinematic dramatic background'
  },
  electronic: {
    name: '⚡ Electronic',
    command: '-filter:a "volume=0.3"',
    description: 'Electronic dance background'
  },
  jazz: {
    name: '🎷 Jazz',
    command: '-filter:a "volume=0.25"',
    description: 'Smooth jazz background'
  }
};

// Store pending callbacks for Suno instrumental generation
const pendingCallbacks = new Map<string, PendingCallback>();

/**
 * Get random background music
 * @returns {Object} Random background music configuration
 */
export function getRandomBackground() {
  const backgroundKeys = Object.keys(BACKGROUND_MUSIC);
  if (backgroundKeys.length === 0) throw new Error("No background music defined");
  const randomKey = backgroundKeys[Math.floor(Math.random() * backgroundKeys.length)];

  if (!randomKey) throw new Error("Failed to select random background music");

  return {
    key: randomKey,
    ...BACKGROUND_MUSIC[randomKey]
  };
}

/**
 * Get random instrumental style
 * @returns {Object} Random instrumental style configuration
 */
export function getRandomInstrumentalStyle() {
  const styleKeys = Object.keys(INSTRUMENTAL_STYLES);
  if (styleKeys.length === 0) throw new Error("No instrumental styles defined");
  const randomKey = styleKeys[Math.floor(Math.random() * styleKeys.length)];

  if (!randomKey) throw new Error("Failed to select random instrumental style");

  return INSTRUMENTAL_STYLES[randomKey];
}

/**
 * Generate synthetic background music using FFmpeg
 * @param {number} duration - Duration in seconds
 * @param {string} style - Music style
 * @returns {Promise<string>} Path to generated music file
 */
export async function generateBackgroundMusic(duration: number, style: string = 'upbeat'): Promise<string> {
  try {
    const tempDir = getTempDir();
    ensureTempDir();
    const fileName = `bg_music_${uuidv4()}.mp3`;
    const filePath = path.join(tempDir, fileName);

    logger.debug(`🎵 Generating ${style} background music (${duration}s)...`);

    // Generate melodic synthetic music using FFmpeg with chord progressions
    let musicCommand;
    switch (style) {
      case 'upbeat':
        // C major chord progression: C-E-G with rhythm
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=261.63:duration=${duration}" -f lavfi -i "sine=frequency=329.63:duration=${duration}" -f lavfi -i "sine=frequency=392.00:duration=${duration}" -f lavfi -i "sine=frequency=523.25:duration=${duration}" -filter_complex "[0:a]volume=0.8[bass];[1:a]volume=0.6[mid];[2:a]volume=0.7[high];[3:a]volume=0.5[melody];[bass][mid][high][melody]amix=inputs=4:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
        break;
      case 'chill':
        // Am chord progression: A-C-E with soft tones
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=220.00:duration=${duration}" -f lavfi -i "sine=frequency=261.63:duration=${duration}" -f lavfi -i "sine=frequency=329.63:duration=${duration}" -f lavfi -i "sine=frequency=440.00:duration=${duration}" -filter_complex "[0:a]volume=0.7[bass];[1:a]volume=0.5[mid1];[2:a]volume=0.6[mid2];[3:a]volume=0.4[high];[bass][mid1][mid2][high]amix=inputs=4:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
        break;
      case 'dramatic':
        // Dm chord progression: D-F-A with deep tones
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=146.83:duration=${duration}" -f lavfi -i "sine=frequency=174.61:duration=${duration}" -f lavfi -i "sine=frequency=220.00:duration=${duration}" -f lavfi -i "sine=frequency=293.66:duration=${duration}" -filter_complex "[0:a]volume=0.9[bass];[1:a]volume=0.6[mid1];[2:a]volume=0.7[mid2];[3:a]volume=0.5[high];[bass][mid1][mid2][high]amix=inputs=4:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
        break;
      case 'electronic':
        // F#m chord progression: F#-A-C# with electronic feel
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=185.00:duration=${duration}" -f lavfi -i "sine=frequency=220.00:duration=${duration}" -f lavfi -i "sine=frequency=277.18:duration=${duration}" -f lavfi -i "sine=frequency=369.99:duration=${duration}" -filter_complex "[0:a]volume=0.8[bass];[1:a]volume=0.6[mid1];[2:a]volume=0.7[mid2];[3:a]volume=0.5[high];[bass][mid1][mid2][high]amix=inputs=4:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
        break;
      case 'jazz':
        // G7 chord progression: G-B-D-F with jazz harmony
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=196.00:duration=${duration}" -f lavfi -i "sine=frequency=246.94:duration=${duration}" -f lavfi -i "sine=frequency=293.66:duration=${duration}" -f lavfi -i "sine=frequency=349.23:duration=${duration}" -filter_complex "[0:a]volume=0.7[bass];[1:a]volume=0.5[mid1];[2:a]volume=0.6[mid2];[3:a]volume=0.4[high];[bass][mid1][mid2][high]amix=inputs=4:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
        break;
      default:
        // Default: C major chord
        musicCommand = `${ffmpegBin} -f lavfi -i "sine=frequency=261.63:duration=${duration}" -f lavfi -i "sine=frequency=329.63:duration=${duration}" -f lavfi -i "sine=frequency=392.00:duration=${duration}" -filter_complex "[0:a]volume=0.8[bass];[1:a]volume=0.6[mid];[2:a]volume=0.7[high];[bass][mid][high]amix=inputs=3:duration=first" -c:a libmp3lame -b:a 128k -y "${filePath}"`;
    }

    await execAsync(musicCommand);

    if (!fs.existsSync(filePath)) {
      throw new Error('Background music generation failed');
    }

    logger.debug(`✅ Background music generated: ${fileName}`);
    return filePath;

  } catch (err: any) {
    logger.error('❌ Error generating background music:', { error: err.message || String(err), stack: err.stack });
    throw new Error(`Background music generation failed: ${err.message}`);
  }
}

/**
 * Generate Suno instrumental music
 * @param {number} duration - Duration in seconds
 * @param {Object} style - Instrumental style configuration
 * @returns {Promise<string>} Path to generated music file
 */
export async function generateSunoInstrumental(duration: number, style: InstrumentalStyle): Promise<string> {
  try {
    logger.debug(`🎵 Generating Suno instrumental: ${style.name}`);

    // Generate music with Suno
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const musicResult: any = await musicService.generateInstrumentalMusic(style.prompt, {
      duration: Math.min(duration, 30), // Suno max duration
      style: style.style,
      mood: style.mood,
      tempo: style.tempo,
      model: 'V5'
    });

    if (musicResult.error) {
      throw new Error(`Suno music generation failed: ${musicResult.error}`);
    }

    const tempDir = getTempDir();
    ensureTempDir();

    // If we have audioBuffer, save it immediately
    if (musicResult.audioBuffer) {
      const fileName = `suno_instrumental_${uuidv4()}.mp3`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, musicResult.audioBuffer);
      logger.debug(`✅ Suno instrumental generated: ${fileName}`);
      return filePath;
    }

    // If status is pending, we need to wait for callback
    if (musicResult.status === 'pending' && musicResult.taskId) {
      logger.debug(`⏳ Suno instrumental task submitted, waiting for callback: ${musicResult.taskId}`);

      // Wait for callback completion using Promise-based approach with timeout
      return new Promise((resolve, reject) => {
        // Set timeout for 5 minutes (300 seconds)
        const timeout = setTimeout(() => {
          pendingCallbacks.delete(musicResult.taskId);
          reject(new Error(`Suno instrumental generation timeout - callback not received within 5 minutes`));
        }, 5 * 60 * 1000);

        pendingCallbacks.set(musicResult.taskId, {
          resolve: (filePath) => {
            clearTimeout(timeout);
            resolve(filePath);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(new Error(`Suno instrumental callback failed: ${error}`));
          }
        });
      });
    }

    throw new Error(`Suno music generation failed: Unexpected result format`);

  } catch (err: any) {
    logger.error('❌ Error generating Suno instrumental:', { error: err.message || String(err), stack: err.stack });
    throw new Error(`Suno instrumental generation failed: ${err.message}`);
  }
}

/**
 * Handle Suno callback completion
 * @param {string} taskId - Task ID
 * @param {Buffer} audioBuffer - Generated audio buffer
 */
export function handleSunoCallback(taskId: string, audioBuffer: Buffer): void {
  const callback = pendingCallbacks.get(taskId);
  if (callback) {
    const tempDir = getTempDir();
    ensureTempDir();

    try {
      const fileName = `suno_instrumental_${uuidv4()}.mp3`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, audioBuffer);
      logger.debug(`✅ Suno instrumental generated via callback: ${fileName}`);
      callback.resolve(filePath);
    } catch (err: any) {
      callback.reject(new Error(`Failed to save Suno instrumental: ${err.message}`));
    }

    pendingCallbacks.delete(taskId);
  }
}
