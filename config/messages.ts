/**
 * Centralized Messages Configuration
 * All user-facing text messages in one place for easy maintenance and updates
 * 
 * SSOT (Single Source of Truth) for Hebrew error messages and UI text
 */

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const entityTypes = {
  group: 'קבוצה',
  contact: 'איש קשר'
} as const;

export function getEntityType(isGroup: boolean): EntityType {
  return isGroup ? entityTypes.group : entityTypes.contact;
}

// ═══════════════════════════════════════════════════════════════════════════
// USER ROLES
// ═══════════════════════════════════════════════════════════════════════════

export const roles = {
  user: 'משתמש',
  bot: 'בוט'
} as const;

export type RoleType = 'user' | 'bot' | 'assistant' | string;

export function getRole(role: RoleType): Role | string {
  if (role === 'user') return roles.user;
  if (role === 'assistant' || role === 'bot') return roles.bot;
  return role || 'לא ידוע';
}

export const defaultSenderName = 'המשתמש';

// ═══════════════════════════════════════════════════════════════════════════
// ERROR MESSAGES - Centralized Hebrew Error Messages (SSOT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Required field errors - "חובה לספק..."
 */
export const REQUIRED = {
  IMAGE_DESCRIPTION: 'חובה לספק תיאור לתמונה',
  VIDEO_DESCRIPTION: 'חובה לספק תיאור לסרטון',
  SONG_DESCRIPTION: 'חובה לספק תיאור לשיר',
  POLL_TOPIC: 'חובה לספק נושא לסקר',
  SEARCH_QUERY: 'חובה לציין שאילתת חיפוש',
  IMAGE_URL_FOR_EDIT: 'חובה לספק קישור לתמונה לעריכה',
  VIDEO_URL_FOR_EDIT: 'חובה לספק קישור לוידאו לעריכה',
  IMAGE_URL_FOR_CONVERT: 'חובה להעביר קישור לתמונה להמרה',
  ANIMATION_DESCRIPTION: 'חובה להעביר תיאור לאנימציה',
  EDIT_INSTRUCTIONS_IMAGE: 'חובה לספק הוראות עריכה לתמונה',
  EDIT_INSTRUCTIONS_VIDEO: 'חובה לספק הוראות עריכה לוידאו',
  IMAGE_QUESTION: 'חובה לציין שאלה לניתוח התמונה',
  PREFERENCE_KEY_VALUE: 'חובה לציין מפתח וערך להעדפה'
} as const;

/**
 * Not found errors - "לא נמצא..."
 */
export const NOT_FOUND = {
  CHAT_ID: 'לא נמצא chatId',
  CHAT_ID_FOR_GROUP: 'לא נמצא chatId עבור יצירת הקבוצה',
  CHAT_ID_FOR_SUMMARY: 'לא נמצא chatId עבור יצירת הסיכום',
  CHAT_ID_FOR_RETRY: 'לא נמצא chatId לביצוע retry',
  CHAT_ID_FOR_PREFERENCE: 'לא נמצא chatId לשמירת ההעדפה',
  CHAT_ID_FOR_MEMORY: 'לא נמצא chatId לקריאת הזיכרון',
  PARTICIPANTS: 'לא נמצאו משתתפים תואמים ליצירת הקבוצה',
  ADDITIONAL_PARTICIPANTS: 'לא נמצאו משתתפים נוספים ליצירת הקבוצה',
  AUDIO_URL: 'לא נמצא URL של הקלטה. צטט הודעה קולית ונסה שוב.',
  imageById: (id: number) => `לא נמצאה תמונה עם המזהה ${id}`,
  voiceForLanguage: (error: string) => `לא נמצא קול לשפה: ${error}`,
  matchingSteps: (stepsInfo: string) => `לא נמצאו שלבים תואמים. השלבים הזמינים: ${stepsInfo}`
} as const;

/**
 * Failed operation errors - "...נכשל"
 */
export const FAILED = {
  TTS: (error: string) => `TTS נכשל: ${error}`,
  VOICE_CLONE: (error: string) => `שיבוט קול נכשל: ${error}`,
  VOICE_CLONE_NO_ID: 'שיבוט קול נכשל: לא הוחזר Voice ID',
  CLONED_VOICE_SPEAK: (error: string) => `דיבור עם קול משובט נכשל: ${error}`,
  TRANSCRIPTION: (error: string) => `תמלול נכשל: ${error}`,
  TRANSLATION: (error: string) => `תרגום נכשל: ${error}`,
  VIDEO_CONVERSION: (error: string) => `המרה לוידאו נכשלה: ${error}`,
  MUSIC_CREATION: (error: string) => `יצירת מוזיקה נכשלה: ${error}`,
  SUMMARY_CREATION: (error: string) => `יצירת סיכום נכשלה: ${error}`,
  VIDEO_ANALYSIS: (error: string) => `ניתוח וידאו נכשל: ${error}`,
  CREATIVE_MIX: (error: string) => `מיקס יצירתי נכשל: ${error}`,
  ALL_PROVIDERS: (errors: string) => `כל הספקים נכשלו:\n${errors}`,
  ALL_EDIT_PROVIDERS: (errors: string) => `כל ספקי העריכה נכשלו:\n${errors}`
} as const;

/**
 * Unable to / Could not errors - "לא הצלחתי..."
 */
export const UNABLE = {
  CHOOSE_VOICE: 'לא הצלחתי לבחור קול עבור ההקראה',
  RESTORE_PROMPT: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת.',
  RESTORE_VIDEO_PROMPT: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת לוידאו.',
  RESTORE_EDIT_INSTRUCTIONS: 'לא הצלחתי לשחזר את הוראות העריכה או את כתובת התמונה.',
  RESTORE_TTS_TEXT: 'לא הצלחתי לשחזר את הטקסט להמרה לדיבור.',
  RESTORE_MUSIC_PROMPT: 'לא הצלחתי לשחזר את הפרומפט ליצירת המוזיקה.',
  RESTORE_TRANSLATION: 'לא הצלחתי לאחזר את הטקסט או את שפת היעד של הפקודה הקודמת.',
  RESTORE_POLL_TOPIC: 'לא הצלחתי לשחזר את נושא הסקר הקודם.',
  RESTORE_MULTI_STEP_PLAN: 'לא הצלחתי לשחזר את התוכנית של הפקודה הרב-שלבית הקודמת.'
} as const;

/**
 * Generic error wrapper - "שגיאה: ..."
 */
export const ERROR = {
  generic: (message: string) => `שגיאה: ${message}`,
  internal: 'שגיאה פנימית: לא ניתן לבצע retry כרגע.',
  unexpected: 'אירעה שגיאה בלתי צפויה',
  search: (message: string) => `שגיאה בחיפוש: ${message}`,
  searchDrive: (message: string) => `שגיאה בחיפוש ב-Google Drive: ${message}`,
  historyFetch: (message: string) => `שגיאה בשליפת היסטוריה: ${message}`,
  whatsappHistory: (message: string) => `שגיאה בשליפת היסטוריית השיחה מ-WhatsApp: ${message}`,
  imageAnalysis: (message: string) => `שגיאה בניתוח התמונה: ${message}`,
  savePreference: (message: string) => `שגיאה בשמירת העדפה: ${message}`,
  longTermMemory: (message: string) => `שגיאה בגישה לזיכרון ארוך טווח: ${message}`,
  retry: (message: string) => `שגיאה בביצוע חוזר: ${message}`,
  smartMechanism: (message: string) => `שגיאה במנגנון החכם: ${message}`
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export type EntityType = typeof entityTypes[keyof typeof entityTypes];
export type Role = typeof roles[keyof typeof roles];

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default {
  entityTypes,
  getEntityType,
  roles,
  getRole,
  defaultSenderName,
  REQUIRED,
  NOT_FOUND,
  FAILED,
  UNABLE,
  ERROR
};

