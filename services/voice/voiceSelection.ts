/**
 * Voice selection helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import logger from '../../utils/logger';

/**
 * Voice service context (for this binding)
 */
interface VoiceServiceContext {
  initializeClient: () => ElevenLabsClient;
  getVoices: () => Promise<{ voices?: unknown[]; error?: string }>;
  getVoiceForLanguage: (languageCode: string, voiceDescription?: string) => Promise<{ voiceId?: string; error?: string }>;
  textToSpeech: (voiceId: string, text: string, options?: unknown) => Promise<{ error?: string;[key: string]: unknown }>;
  detectLanguage: (text: string) => string;
}

/**
 * Voice result
 */
interface VoiceResult {
  voiceId?: string;
  voiceName?: string;
  voiceCategory?: string;
  error?: string;
}

/**
 * Voice object structure
 */
interface Voice {
  voice_id?: string;
  voiceId?: string;
  id?: string;
  name?: string;
  category?: string;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Get random voice
 */
export async function getRandomVoice(this: VoiceServiceContext): Promise<VoiceResult> {
  try {
    const voicesResult = await this.getVoices();
    if (voicesResult.error) {
      return { error: voicesResult.error };
    }

    // Convert generic type to typed array
    const voices = (voicesResult.voices || []) as Voice[];
    if (voices.length === 0) {
      return { error: 'No voices available' };
    }

    // Filter out cloned voices for general selection (unless requested?)
    // Actually, we usually want pre-made voices for stability, but we can allow cloned if they match description?
    // Let's stick to non-cloned for now as safer default.
    const availableVoices = voices.filter(voice =>
      (voice.voice_id || voice.voiceId || voice.id) &&
      voice.category !== 'cloned'
    );

    if (availableVoices.length === 0) {
      const randomIndex = Math.floor(Math.random() * voices.length);
      const selectedVoice = voices[randomIndex];
      if (!selectedVoice) {
        return { error: 'No voices available' };
      }
      logger.debug(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);

      return {
        voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
        voiceName: selectedVoice.name,
        voiceCategory: selectedVoice.category
      };
    }

    // Pick random
    const randomIndex = Math.floor(Math.random() * availableVoices.length);
    const selectedVoice = availableVoices[randomIndex]!;

    logger.debug(`🎲 Selected random voice: ${selectedVoice.name}`);

    return {
      voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
      voiceName: selectedVoice.name,
      voiceCategory: selectedVoice.category
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error getting random voice:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Failed to get random voice' };
  }
}

/**
 * Get voice for specific language and optional description
 */
export async function getVoiceForLanguage(this: VoiceServiceContext, _languageCode: string, voiceDescription?: string): Promise<VoiceResult> {
  try {
    const voicesResult = await this.getVoices();
    if (voicesResult.error) {
      return { error: voicesResult.error };
    }

    // Convert generic type to typed array
    const voices = (voicesResult.voices || []) as Voice[];
    if (voices.length === 0) {
      return { error: 'No voices available' };
    }

    // Filter out cloned voices for general selection (unless requested?)
    // Actually, we usually want pre-made voices for stability, but we can allow cloned if they match description?
    // Let's stick to non-cloned for now as safer default.
    const availableVoices = voices.filter(voice =>
      (voice.voice_id || voice.voiceId || voice.id) &&
      voice.category !== 'cloned'
    );

    if (availableVoices.length === 0) {
      return { error: 'No valid voices available' };
    }

    // 1. Dynamic Filtering based on Description (AI-First approach)
    if (voiceDescription) {
      const descLower = voiceDescription.toLowerCase();
      logger.debug(`🎤 Searching for voice matching: "${descLower}"`);

      const matchedVoices = availableVoices.filter(voice => {
        // Check labels (gender, accent, age, etc)
        const labels = (voice.labels || {}) as Record<string, string>;
        const labelValues = Object.values(labels).map(v => String(v).toLowerCase());

        // Check Name
        const nameLower = (voice.name || '').toLowerCase();

        // Simple keyword matching
        // Does the description contain the label value? (e.g. desc="american male", label="american")
        const labelMatch = labelValues.some(val => val && descLower.includes(val));

        // Does the description contain the name? (e.g. desc="use Josh", name="Josh")
        const nameMatch = descLower.includes(nameLower);

        // Helper for gender/age specific
        const genderMatch = (descLower.includes('male') && !descLower.includes('female') && labels.gender === 'male') ||
          (descLower.includes('female') && labels.gender === 'female');

        return labelMatch || nameMatch || genderMatch;
      });

      if (matchedVoices.length > 0) {
        // Pick random from matches to add variety
        const selected = matchedVoices[Math.floor(Math.random() * matchedVoices.length)]!;
        logger.debug(`🎯 Found ${matchedVoices.length} matching voices. Selected: ${selected.name}`);
        return {
          voiceId: selected.voice_id || selected.voiceId || selected.id,
          voiceName: selected.name,
          voiceCategory: selected.category
        };
      }

      logger.debug(`⚠️ No voice matched description "${descLower}", falling back to random.`);
    }

    // 2. Fallback: Random (No hardcoded preferences!)
    // We just pick a random voice.
    // ElevenLabs V2+ is multilingual, so almost any voice works for any language.
    // But sometimes accents matter. 'Rachel' is American.
    // If the user didn't specify, we shouldn't force 'Bella' for Hebrew.

    const randomIndex = Math.floor(Math.random() * availableVoices.length);
    const selectedVoice = availableVoices[randomIndex]!;

    logger.debug(`🎲 Selected random voice: ${selectedVoice.name}`);

    return {
      voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
      voiceName: selectedVoice.name,
      voiceCategory: selectedVoice.category
    };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error getting voice for language:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Failed to get voice for language' };
  }
}

/**
 * Detect language from text
 */
export function detectLanguage(text: string): string {
  if (!text || typeof text !== 'string') {
    return 'en';
  }

  const hebrewRegex = /[\u0590-\u05FF]|[א-ת]/;
  if (hebrewRegex.test(text)) {
    const hebrewChars = (text.match(/[\u0590-\u05FF]|[א-ת]/g) || []).length;
    const totalChars = text.replace(/[\s\n\r\t]/g, '').length;
    const hebrewRatio = hebrewChars / Math.max(totalChars, 1);

    if (hebrewRatio >= 0.3) {
      return 'he';
    }
  }

  const arabicRegex = /[\u0600-\u06FF]/;
  if (arabicRegex.test(text)) {
    return 'ar';
  }

  const russianRegex = /[\u0400-\u04FF]/;
  if (russianRegex.test(text)) {
    return 'ru';
  }

  const spanishRegex = /[ñáéíóúüÑÁÉÍÓÚÜ]/;
  if (spanishRegex.test(text)) {
    return 'es';
  }

  const frenchRegex = /[àâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/;
  if (frenchRegex.test(text)) {
    return 'fr';
  }

  const germanRegex = /[äöüßÄÖÜ]/;
  if (germanRegex.test(text)) {
    return 'de';
  }

  return 'en';
}

/**
 * Text-to-speech with random voice
 */
export async function textToSpeechWithRandomVoice(
  this: VoiceServiceContext,
  text: string,
  options: Record<string, unknown> = {}
): Promise<{ error?: string;[key: string]: unknown }> {
  try {
    logger.debug(`🎲 Starting TTS with random voice for text: "${text.substring(0, 50)}..."`);

    const detectedLanguage = this.detectLanguage(text);
    logger.debug(`🌐 Detected language: ${detectedLanguage}`);

    const voiceResult = await this.getVoiceForLanguage(detectedLanguage);
    if (voiceResult.error || !voiceResult.voiceId) {
      return { error: `Failed to get voice for language ${detectedLanguage}: ${voiceResult.error || 'No voice ID'}` };
    }

    const { voiceId, voiceName, voiceCategory } = voiceResult as VoiceResult;
    logger.debug(`🎤 Using voice: ${voiceName} (category: ${voiceCategory}) for language: ${detectedLanguage}`);
    logger.debug(`🔤 Text contains Hebrew: ${text.match(/[\u0590-\u05FF]|[א-ת]/) ? 'YES' : 'NO'}`);

    if (!voiceId) {
      return { error: 'No voice ID received from voice selection' };
    }

    const ttsOptions = {
      ...options,
      languageCode: detectedLanguage,
      modelId: options.modelId || 'eleven_v3'
    };

    const ttsResult = await this.textToSpeech(voiceId, text, ttsOptions);

    if (ttsResult.error) {
      return { error: ttsResult.error };
    }

    return {
      ...ttsResult,
      voiceInfo: {
        voiceId,
        voiceName,
        voiceCategory
      }
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error in TTS with random voice:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Text-to-speech with random voice failed' };
  }
}

