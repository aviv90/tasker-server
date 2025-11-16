/**
 * WhatsApp Service Constants
 * Centralized constants and regex patterns for WhatsApp message processing
 * Following SSOT (Single Source of Truth) principle
 */

// ════════════════════ REGEX PATTERNS ════════════════════

/**
 * Image edit detection patterns (Hebrew + English with ALL conjugations)
 */
const IMAGE_EDIT_PATTERN = /שנה|תשנה|תשני|שני|ערוך|תערוך|ערכי|עדכן|תעדכן|תקן|תתקן|סדר|תסדר|סדרי|תסדרי|הוסף|תוסיף|תוסיפי|הוסיפי|מחק|תמחק|מחקי|תמחקי|הורד|תוריד|הורידי|תורידי|סיר|תסיר|סירי|תסירי|צייר|תצייר|ציירי|תצרי|הפוך|תהפוך|המר|תהמר|שפר|תשפר|שפרי|תשפרי|תחליף|החלף|החליפי|תחליפי|צור|תצור|צורי|תצרי|edit|change|modify|update|fix|correct|add|remove|delete|draw|paint|replace|swap|improve|enhance|create|make|transform/i;

/**
 * Implicit edit pattern (wearing/dressed patterns)
 */
const IMAGE_IMPLICIT_EDIT_PATTERN = /^(לבוש|לבושה|לובש|לובשת|עם|כ(?!מה)|בתור)|^\b(wearing|dressed|with\s+a|as\s+a|in\s+a)\b/i;

/**
 * TTS keywords pattern (for detecting voice output requests)
 */
const TTS_KEYWORDS_PATTERN = /אמור|אמרי|אמרו|תאמר|תאמרי|תאמרו|הקרא|הקראי|הקראו|תקרא|תקראי|תקראו|הקריא|הקריאי|הקריאו|תקריא|תקריאי|תקריאו|דבר|דברי|דברו|תדבר|תדברי|תדברו|בקול|קולית|\b(say|speak|tell|voice|read\s+aloud)\b/i;

/**
 * Translation keywords pattern (for detecting text-only translation)
 */
const TRANSLATE_KEYWORDS_PATTERN = /תרגם|תרגמי|תרגמו|תתרגם|תתרגמי|תתרגמו|תרגום|\b(translate|translation)\b/i;

/**
 * Just transcription pattern (no other processing requested)
 */
const JUST_TRANSCRIPTION_PATTERN = /^(תמלל|תמליל|transcribe|transcript)$/i;

// ════════════════════ AUDIO & VOICE SETTINGS ════════════════════

/**
 * Minimum audio duration required for voice cloning (ElevenLabs requirement)
 */
const MIN_DURATION_FOR_CLONING = 4.6; // seconds

/**
 * ElevenLabs TTS default settings
 */
const ELEVENLABS_TTS_DEFAULTS = {
  model_id: 'eleven_v3',
  optimize_streaming_latency: 0,
  output_format: 'mp3_44100_128'
};

/**
 * Speech-to-text transcription default settings
 */
const TRANSCRIPTION_DEFAULTS = {
  model: 'scribe_v1_experimental', // Excellent multilingual support
  language: null, // Auto-detect (Hebrew, English, Spanish, etc.)
  removeNoise: true,
  removeFiller: true,
  optimizeLatency: 0,
  format: 'ogg' // WhatsApp audio format
};

// ════════════════════ MESSAGE PROCESSING ════════════════════

/**
 * Chat history limit for context retrieval
 */
const CHAT_HISTORY_LIMIT = 30;

// ════════════════════ EXPORTS ════════════════════

module.exports = {
  // Regex patterns
  IMAGE_EDIT_PATTERN,
  IMAGE_IMPLICIT_EDIT_PATTERN,
  TTS_KEYWORDS_PATTERN,
  TRANSLATE_KEYWORDS_PATTERN,
  JUST_TRANSCRIPTION_PATTERN,
  
  // Audio & Voice settings
  MIN_DURATION_FOR_CLONING,
  ELEVENLABS_TTS_DEFAULTS,
  TRANSCRIPTION_DEFAULTS,
  
  // Message processing
  CHAT_HISTORY_LIMIT
};

