/**
 * Agent helper utilities
 * Reusable functions for language detection, text cleaning, etc.
 */

/**
 * Detect primary language in text
 */
function detectLanguage(text) {
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
 */
function cleanThinkingPatterns(text) {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove step markers
  cleaned = cleaned.replace(/✅\s*Step\s+\d+\/\d+\s+completed[\.!]?\s*/gi, '');
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
 */
function extractDetectionText(prompt) {
  if (!prompt) return '';
  
  // Remove everything after first bracket (metadata like [הרשאות], [פקודה קודמת])
  const bracketIndex = prompt.indexOf('[');
  if (bracketIndex > 0) {
    return prompt.substring(0, bracketIndex).trim();
  }
  
  // Fallback: first line only
  return prompt.split('\n')[0].trim();
}

module.exports = {
  detectLanguage,
  cleanThinkingPatterns,
  extractDetectionText
};

