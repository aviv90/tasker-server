/**
 * Agent helper utilities
 * Reusable functions for language detection, text cleaning, etc.
 */

/**
 * Supported language codes
 */
export type LanguageCode = 'he' | 'en' | 'ar' | 'ru';

/**
 * Detect primary language in text
 * @param text - Text to analyze
 * @returns Detected language code (default: 'he')
 */
export function detectLanguage(text: string | null | undefined): LanguageCode {
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

/**
 * Clean AI "thinking patterns" from response text
 * Removes step markers and English paragraphs when Hebrew is primary language
 * @param text - Text to clean
 * @returns Cleaned text
 */
export function cleanThinkingPatterns(text: string | null | undefined): string {
  if (!text) return '';

  let cleaned = text;

  // Remove step markers
  cleaned = cleaned.replace(/✅\s*Step\s+\d+\/\d+\s+completed[.!]?\s*/gi, '');
  cleaned = cleaned.replace(/Now proceeding to Step \d+\/\d+\.{3,}/gi, '');

  // Remove English paragraphs if Hebrew is primary language
  const hebrewChars = (cleaned.match(/[\u0590-\u05FF]/g) || []).length;
  const englishChars = (cleaned.match(/[a-zA-Z]/g) || []).length;

  if (hebrewChars > englishChars) {
    const paragraphs = cleaned.split('\n\n');
    const filteredParagraphs = paragraphs.filter(para => {
      const paraHebrew = (para.match(/[\u0590-\u05FF]/g) || []).length;
      const paraEnglish = (para.match(/[a-zA-Z]/g) || []).length;
      return paraHebrew >= paraEnglish || paraEnglish < 20;
    });
    cleaned = filteredParagraphs.join('\n\n');
  }

  return cleaned.trim();
}

/**
 * Extract detection text from prompt (remove metadata blocks)
 * Removes everything after first bracket (metadata like [הרשאות], [פקודה קודמת])
 * @param prompt - Prompt text
 * @returns Extracted text for language detection
 */
export function extractDetectionText(prompt: string | null | undefined): string {
  if (!prompt) return '';

  // Remove everything after first bracket (metadata like [הרשאות], [פקודה קודמת])
  const bracketIndex = prompt.indexOf('[');
  if (bracketIndex > 0) {
    return prompt.substring(0, bracketIndex).trim();
  }

  // Fallback: first line only
  return prompt.split('\n')[0]?.trim() || '';
}

