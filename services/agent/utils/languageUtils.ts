import prompts from '../../../config/prompts';

export type LanguageCode = keyof typeof prompts.languageInstructions;

export function getLanguageInstruction(langCode: string): string {
  const code = langCode as LanguageCode;
  return prompts.languageInstructions[code] ?? prompts.languageInstructions.he ?? '';
}

/**
 * Detect primary language in text
 * @param text - Text to analyze
 * @returns Detected language code (default: 'he')
 */
export function detectLanguage(text: string | null | undefined): string {
  if (!text) return 'he';

  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const russianChars = (text.match(/[\u0400-\u04FF]/g) || []).length;

  const total = hebrewChars + englishChars + arabicChars + russianChars;
  if (total === 0) return 'he';

  const max = Math.max(hebrewChars, englishChars, arabicChars, russianChars);
  if (max === hebrewChars) return 'he';
  if (max === englishChars) return 'en';
  if (max === arabicChars) return 'ar';
  if (max === russianChars) return 'ru';

  return 'he';
}

