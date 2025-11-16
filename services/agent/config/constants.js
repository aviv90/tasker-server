/**
 * Agent Configuration Constants
 * Centralized configuration for agent behavior
 */

/**
 * Map tool names to Hebrew Ack messages
 */
const TOOL_ACK_MESSAGES = {
  // Creation tools (with provider placeholder)
  'create_image': 'יוצר תמונה עם __PROVIDER__... 🎨',
  'create_video': 'יוצר וידאו עם __PROVIDER__... 🎬',
  'image_to_video': 'ממיר תמונה לוידאו מונפש עם __PROVIDER__... 🎞️',
  'create_music': 'יוצר מוזיקה... 🎵',
  'text_to_speech': 'ממיר לדיבור... 🎤',
  
  // Analysis tools
  'analyze_image': 'מנתח תמונה... 🔍',
  'analyze_image_from_history': 'מנתח תמונה... 🔍',
  'analyze_video': 'מנתח וידאו... 🎥',
  
  // Edit tools (with provider placeholder)
  'edit_image': 'עורך תמונה עם __PROVIDER__... ✏️',
  'edit_video': 'עורך וידאו עם __PROVIDER__... 🎞️',
  
  // Info tools
  'search_web': 'מחפש באינטרנט... 🔎',
  'get_chat_history': 'שולף היסטוריה... 📜',
  'get_long_term_memory': 'בודק העדפות... 💾',
  'translate_text': 'מתרגם... 🌐',
  'translate_and_speak': 'מתרגם והופך לדיבור... 🌐🗣️',
  'transcribe_audio': 'מתמלל הקלטה... 🎤📝',
  'chat_summary': 'מסכם שיחה... 📝',
  
  // WhatsApp tools
  'create_poll': 'יוצר סקר... 📊',
  'send_location': '',
  'create_group': 'יוצר קבוצה... 👥',
  
  // Audio tools
  'voice_clone_and_speak': 'משכפל קול... 🎙️',
  'creative_audio_mix': 'מערבב אודיו... 🎧',
  
  // Meta-tools
  'history_aware_create': 'יוצר עם context... 🧠',
  'create_with_memory': 'יוצר לפי העדפות... 💡',
  'search_and_create': 'מחפש ויוצר... 🔍➡️🎨',
  'create_and_analyze': 'יוצר ומנתח... 🎨➡️🔍',
  'analyze_and_edit': 'מנתח ועורך... 🔍➡️✏️',
  'smart_execute_with_fallback': 'מנסה עם __PROVIDER__... 🔄',
  'retry_with_different_provider': 'מנסה עם __PROVIDER__... 🔁',
  'retry_last_command': 'חוזר על פקודה קודמת... ↩️',
  
  // Preferences
  'save_user_preference': 'שומר העדפה... 💾'
};

/**
 * Video provider fallback order
 * CRITICAL: Order matters! After Veo 3 fails, try Sora 2 next (not Kling)
 */
const VIDEO_PROVIDER_FALLBACK_ORDER = ['openai', 'gemini', 'grok'];

/**
 * Video provider display name mapping
 */
const VIDEO_PROVIDER_DISPLAY_MAP = {
  grok: 'kling',
  gemini: 'veo3',
  openai: 'sora-2'
};

/**
 * Tools that should not be persisted for retry functionality
 */
const NON_PERSISTED_TOOLS = new Set([
  'retry_last_command',
  'get_chat_history',
  'save_user_preference',
  'get_long_term_memory',
  'transcribe_audio'
]);

/**
 * Summary max length for truncation
 */
const SUMMARY_MAX_LENGTH = 90;

module.exports = {
  TOOL_ACK_MESSAGES,
  VIDEO_PROVIDER_FALLBACK_ORDER,
  VIDEO_PROVIDER_DISPLAY_MAP,
  NON_PERSISTED_TOOLS,
  SUMMARY_MAX_LENGTH
};

