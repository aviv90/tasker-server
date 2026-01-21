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
  image_to_video: 'ממיר תמונה לווידאו מונפש עם __PROVIDER__... 🎞️',
  create_music: 'יוצר מוזיקה... 🎵',
  text_to_speech: 'ממיר לדיבור... 🎤',

  // Analysis tools
  analyze_image: 'מנתח תמונה... 🔍',
  analyze_image_from_history: 'מנתח תמונה... 🔍',
  analyze_video: 'מנתח וידאו... 🎥',

  // Edit tools (with provider placeholder for images, Runway for video)
  edit_image: 'עורך תמונה עם __PROVIDER__... ✏️',
  edit_video: 'עורך וידאו עם __PROVIDER__... 🎞️',

  // Info tools
  search_web: 'מחפש מידע... 🔍',
  // Flight
  // Flight
  random_flight: 'מחפש טיסה... ✈️',
  // Shopping
  random_amazon_product: 'מחפש מוצר באמזון... 🛒',

  search_google_drive: 'מחפש ב-Google Drive... 📁',
  get_chat_history: 'שולף היסטוריה... 📜',
  get_long_term_memory: 'בודק העדפות... 💾',
  translate_text: 'מתרגם... 🌐',
  translate_and_speak: 'מתרגם ומקריא... 🗣️',
  schedule_message: 'מתזמן הודעה... 📅',
  transcribe_audio: 'מתמלל הקלטה... 🎤📝',
  chat_summary: 'מסכם שיחה... 📝',

  // WhatsApp tools
  create_poll: 'יוצר סקר... 📊',
  send_location: 'שולח מיקום... 📍',
  create_group: 'יוצר קבוצה... 👥',

  // Audio tools
  voice_clone_and_speak: 'משכפל קול... 🎙️',
  creative_audio_mix: 'מערבב אודיו... 🎧',
  create_sound_effect: 'מייצר אפקט קולי... 🔊',
  edit_voice_style: 'עורך את הסגנון הקולי... 🎼',

  // Search & Infools
  history_aware_create: 'יוצר עם context... 🧠',
  create_with_memory: 'יוצר בהתאמה אישית... 💡',
  search_and_create: 'מחפש ומייצר... 🔍➡️🎨',
  create_and_analyze: 'מייצר ומנתח... 🎨➡️🔍',
  analyze_and_edit: 'מנתח ועורך... 🔍➡️✏️',
  // retry_with_different_provider REMOVED - NO AUTOMATIC FALLBACKS
  retry_last_command: 'חוזר על הפעולה... ↩️',
  // smart_execute_with_fallback REMOVED - NO AUTOMATIC FALLBACKS

  // Preferences
  save_user_preference: 'שומר העדפה... 💾'
};



/**
 * Video provider display name mapping
 */
export const VIDEO_PROVIDER_DISPLAY_MAP: Record<string, string> = {
  kling: 'Kling',
  veo3: 'Veo 3',
  sora: 'Sora 2',
  'sora-pro': 'Sora 2 Pro',
  runway: 'Runway'
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
  PROVIDERS.VIDEO.KLING,
  PROVIDERS.VIDEO.SORA,
  PROVIDERS.VIDEO.SORA_PRO
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
// DEFAULT_IMAGE_PROVIDERS array REMOVED - NO AUTOMATIC FALLBACKS

/**
 * Default video providers (fallback order)
 */
// DEFAULT_VIDEO_PROVIDERS array REMOVED - NO AUTOMATIC FALLBACKS

/**
 * Patterns to identify system Ack messages (to filter from history)
 */
export const ACK_PATTERNS = {
  PREFIXES: [
    'יוצר', 'מבצע', 'חושב', 'מנתח', 'מחפש', 'מתמלל', 'מתרגם',
    'עורך', 'ממיר', 'שולף', 'בודק', 'שומר', 'מתזמן', 'מסכם',
    'שולח', 'משכפל', 'מערבב'
  ],
  SUFFIXES_OR_EMOJIS: [
    '... ⚙️', '... 🎨', '... 🎬', '... 🔍', '... ✏️', '... 🎞️',
    '... 🎵', '... 🎤', '... ✈️', '... 🛒', '... 📁', '... 📜',
    '... 💾', '... 🌐', '... 🗣️', '... 📅', '... 📝', '... 📊',
    '... 📍', '... 👥', '... 🎙️', '... 🎧', '... 🧠', '... 💡',
    '... 🔄', '... 🔁', '... ↩️', '... 🔊'
  ]
};
