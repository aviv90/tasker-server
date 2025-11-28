/**
 * Agent Configuration Constants (TypeScript)
 */

export type ToolAckMessages = Record<string, string>;

/**
 * Map tool names to Hebrew Ack messages
 */
export const TOOL_ACK_MESSAGES: ToolAckMessages = {
  // Creation tools (with provider placeholder)
  create_image: 'יוצר תמונה עם __PROVIDER__... 🎨',
  create_video: 'יוצר וידאו עם __PROVIDER__... 🎬',
  image_to_video: 'ממיר תמונה לוידאו מונפש עם __PROVIDER__... 🎞️',
  create_music: 'יוצר מוזיקה... 🎵',
  text_to_speech: 'ממיר לדיבור... 🎤',

  // Analysis tools
  analyze_image: 'מנתח תמונה... 🔍',
  analyze_image_from_history: 'מנתח תמונה... 🔍',
  analyze_video: 'מנתח וידאו... 🎥',

  // Edit tools (with provider placeholder for images, Runway for video)
  edit_image: 'עורך תמונה עם __PROVIDER__... ✏️',
  edit_video: 'עורך וידאו עם Runway... 🎞️',

  // Info tools
  search_web: 'מחפש באינטרנט... 🔎',
  search_google_drive: 'מחפש ב-Google Drive... 📁',
  get_chat_history: 'שולף היסטוריה... 📜',
  get_long_term_memory: 'בודק העדפות... 💾',
  translate_text: 'מתרגם... 🌐',
  translate_and_speak: 'מתרגם והופך לדיבור... 🌐🗣️',
  transcribe_audio: 'מתמלל הקלטה... 🎤📝',
  chat_summary: 'מסכם שיחה... 📝',

  // WhatsApp tools
  create_poll: 'יוצר סקר... 📊',
  send_location: '',
  create_group: 'יוצר קבוצה... 👥',

  // Audio tools
  voice_clone_and_speak: 'משכפל קול... 🎙️',
  creative_audio_mix: 'מערבב אודיו... 🎧',

  // Meta-tools
  history_aware_create: 'יוצר עם context... 🧠',
  create_with_memory: 'יוצר לפי העדפות... 💡',
  search_and_create: 'מחפש ויוצר... 🔍➡️🎨',
  create_and_analyze: 'יוצר ומנתח... 🎨➡️🔍',
  analyze_and_edit: 'מנתח ועורך... 🔍➡️✏️',
  smart_execute_with_fallback: 'מנסה עם __PROVIDER__... 🔄',
  retry_with_different_provider: 'מנסה עם __PROVIDER__... 🔁',
  retry_last_command: 'חוזר על פקודה קודמת... ↩️',

  // Preferences
  save_user_preference: 'שומר העדפה... 💾'
};

/**
 * Video provider fallback order
 * CRITICAL: Order matters! After Veo 3 fails, try Sora 2 next (not Kling)
 */
export const VIDEO_PROVIDER_FALLBACK_ORDER = ['openai', 'gemini', 'grok'] as const;

/**
 * Video provider display name mapping
 */
export const VIDEO_PROVIDER_DISPLAY_MAP: Record<string, string> = {
  grok: 'kling',
  gemini: 'veo3',
  openai: 'sora-2'
};

/**
 * Tools that should not be persisted for retry functionality
 */
export const NON_PERSISTED_TOOLS = new Set<string>([
  'retry_last_command',
  'get_chat_history',
  'save_user_preference',
  'get_long_term_memory',
  'transcribe_audio'
]);

/**
 * Summary max length for truncation
 */
export const SUMMARY_MAX_LENGTH = 90;

/**
 * Provider Constants
 * SSOT (Single Source of Truth) for all provider names
 */
export const PROVIDERS = {
  // Image providers
  IMAGE: {
    GEMINI: 'gemini',
    OPENAI: 'openai',
    GROK: 'grok'
  } as const,
  
  // Video providers
  VIDEO: {
    VEO3: 'veo3',
    SORA: 'sora',
    SORA_PRO: 'sora-pro',
    KLING: 'kling',
    RUNWAY: 'runway'
  } as const,
  
  // General
  NONE: 'none'
} as const;

/**
 * Image provider enum array (for tool declarations)
 */
export const IMAGE_PROVIDERS = [
  PROVIDERS.IMAGE.GEMINI,
  PROVIDERS.IMAGE.OPENAI,
  PROVIDERS.IMAGE.GROK
] as const;

/**
 * Video provider enum array (for tool declarations)
 */
export const VIDEO_PROVIDERS = [
  PROVIDERS.VIDEO.VEO3,
  PROVIDERS.VIDEO.SORA,
  PROVIDERS.VIDEO.SORA_PRO,
  PROVIDERS.VIDEO.KLING
] as const;

/**
 * All providers enum array (for retry tool)
 */
export const ALL_PROVIDERS = [
  PROVIDERS.IMAGE.GEMINI,
  PROVIDERS.IMAGE.OPENAI,
  PROVIDERS.IMAGE.GROK,
  PROVIDERS.VIDEO.SORA,
  PROVIDERS.VIDEO.VEO3,
  PROVIDERS.VIDEO.KLING,
  PROVIDERS.VIDEO.RUNWAY,
  PROVIDERS.NONE
] as const;

/**
 * Default image providers (fallback order)
 */
export const DEFAULT_IMAGE_PROVIDERS = [
  PROVIDERS.IMAGE.GEMINI,
  PROVIDERS.IMAGE.OPENAI,
  PROVIDERS.IMAGE.GROK
] as const;

/**
 * Default video providers (fallback order)
 */
export const DEFAULT_VIDEO_PROVIDERS = [
  PROVIDERS.VIDEO.KLING,
  PROVIDERS.VIDEO.VEO3,
  PROVIDERS.VIDEO.SORA
] as const;

