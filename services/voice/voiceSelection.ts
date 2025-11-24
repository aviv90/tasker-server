/**
 * Voice selection helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

/**
 * Voice service context (for this binding)
 */
interface VoiceServiceContext {
  initializeClient: () => ElevenLabsClient;
  getVoices: () => Promise<{ voices?: unknown[]; error?: string }>;
  getVoiceForLanguage: (languageCode: string) => Promise<{ voiceId?: string; error?: string }>;
  textToSpeech: (voiceId: string, text: string, options?: unknown) => Promise<{ error?: string; [key: string]: unknown }>;
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
    
    const voices = (voicesResult.voices || []) as Voice[];
    if (voices.length === 0) {
      return { error: 'No voices available' };
    }
    
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
      console.log(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);
      
      return {
        voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
        voiceName: selectedVoice.name,
        voiceCategory: selectedVoice.category
      };
    }
    
    const randomIndex = Math.floor(Math.random() * availableVoices.length);
    const selectedVoice = availableVoices[randomIndex];
    if (!selectedVoice) {
      return { error: 'No voices available' };
    }
    
    console.log(`🎲 Selected random voice: ${selectedVoice.name}`);
    
    return {
      voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
      voiceName: selectedVoice.name,
      voiceCategory: selectedVoice.category
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Error getting random voice:', errorMessage);
    return { error: errorMessage || 'Failed to get random voice' };
  }
}

/**
 * Get voice for specific language
 */
export async function getVoiceForLanguage(this: VoiceServiceContext, languageCode: string): Promise<VoiceResult> {
  try {
    const voicesResult = await this.getVoices();
    if (voicesResult.error) {
      return { error: voicesResult.error };
    }
    
    const voices = (voicesResult.voices || []) as Voice[];
    if (voices.length === 0) {
      return { error: 'No voices available' };
    }
    
    const languageVoicePreferences: Record<string, string[]> = {
      'he': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold', 'Adam', 'Callum', 'Charlie', 'Daniel'],
      'en': ['Rachel', 'Drew', 'Clyde', 'Paul', 'Domi'],
      'es': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'fr': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'de': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'it': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'pt': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'ru': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'ar': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'zh': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'ja': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
      'hi': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold']
    };
    
    const preferredVoices = languageVoicePreferences[languageCode] || languageVoicePreferences['en'] || [];
    
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
      console.log(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);
      
      return {
        voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
        voiceName: selectedVoice.name,
        voiceCategory: selectedVoice.category
      };
    }
    
    for (const preferredName of preferredVoices) {
      const preferredVoice = availableVoices.find(voice => 
        voice.name && voice.name.toLowerCase().includes(preferredName.toLowerCase())
      );
      
      if (preferredVoice) {
        console.log(`🎯 Found preferred voice for ${languageCode}: ${preferredVoice.name}`);
        return {
          voiceId: preferredVoice.voice_id || preferredVoice.voiceId || preferredVoice.id,
          voiceName: preferredVoice.name,
          voiceCategory: preferredVoice.category
        };
      }
    }
    
    const randomIndex = Math.floor(Math.random() * availableVoices.length);
    const selectedVoice = availableVoices[randomIndex];
    if (!selectedVoice) {
      return { error: 'No voices available' };
    }
    
    console.log(`🎲 Selected random voice for ${languageCode}: ${selectedVoice.name}`);
    
    return {
      voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
      voiceName: selectedVoice.name,
      voiceCategory: selectedVoice.category
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('❌ Error getting voice for language:', errorMessage);
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
): Promise<{ error?: string; [key: string]: unknown }> {
  try {
    console.log(`🎲 Starting TTS with random voice for text: "${text.substring(0, 50)}..."`);
    
    const detectedLanguage = this.detectLanguage(text);
    console.log(`🌐 Detected language: ${detectedLanguage}`);
    
    const voiceResult = await this.getVoiceForLanguage(detectedLanguage);
    if (voiceResult.error || !voiceResult.voiceId) {
      return { error: `Failed to get voice for language ${detectedLanguage}: ${voiceResult.error || 'No voice ID'}` };
    }
    
    const { voiceId, voiceName, voiceCategory } = voiceResult as VoiceResult;
    console.log(`🎤 Using voice: ${voiceName} (category: ${voiceCategory}) for language: ${detectedLanguage}`);
    console.log(`🔤 Text contains Hebrew: ${text.match(/[\u0590-\u05FF]|[א-ת]/) ? 'YES' : 'NO'}`);
    
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
    console.error('❌ Error in TTS with random voice:', errorMessage);
    return { error: errorMessage || 'Text-to-speech with random voice failed' };
  }
}

