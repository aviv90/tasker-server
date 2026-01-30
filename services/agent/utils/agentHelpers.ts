/**
 * Agent helper utilities
 * Reusable functions for language detection, text cleaning, etc.
 */


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

  // Remove "Status: ... Information: ..." blocks (CRITICAL for multi-step)
  cleaned = cleaned.replace(/Status:\s*[\s\S]*?Information:\s*[\s\S]*?(?=\n\n|$)/gi, '');
  // Remove "Status: ... Information: ..." blocks (CRITICAL for multi-step)
  cleaned = cleaned.replace(/Status:\s*[\s\S]*?Information:\s*[\s\S]*?(?=\n\n|$)/gi, '');
  cleaned = cleaned.replace(/Activity ID:\s*[\s\S]*?(?=\n\n|$)/gi, '');
  cleaned = cleaned.replace(/Time:\s*[\d:.]+\s*[\s\S]*?(?=\n\n|$)/gi, '');

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

/**
 * Check if the prompt is a "pure creation" request (image/video/music) that should probably NOT see history
 * strictly to avoid hallucinations or context bleeding.
 * @param prompt - User prompt
 * @returns true if history should be suppressed
 */
export function isPureCreationRequest(prompt: string): boolean {
  if (!prompt) return false;
  const p = prompt.toLowerCase();

  // Keywords that suggest creation
  const creationKeywords = [
    'create image', 'generate image', 'draw', 'make a picture',
    'create video', 'generate video', 'make a video',
    'create music', 'generate music', 'make a song',
    'צייר', 'צור תמונה', 'תכין תמונה', 'ג׳נרט תמונה',
    'צור וידאו', 'תכין וידאו', 'ג׳נרט וידאו',
    'צור שיר', 'תכין שיר'
  ];

  // Keywords that suggest context dependency (which means we SHOULD keep history)
  const contextKeywords = [
    'like the last one', 'similar to', 'modify', 'change', 'edit',
    'כמו הקודם', 'דומה ל', 'תשנה', 'תערוך', 'אותו דבר', 'עוד אחד כזה'
  ];

  const hasCreation = creationKeywords.some(k => p.includes(k));
  const hasContextRef = contextKeywords.some(k => p.includes(k));

  // If it's a creation request AND does NOT refer to context -> Pure creation -> Suppress history
  return hasCreation && !hasContextRef;
}

/**
 * Check if the prompt is a "simple" query that doesn't require multi-step planning.
 * Greetings, status checks, or very short messages.
 * @param prompt - User prompt
 * @returns true if planning can be skipped
 */
export function isSimpleQuery(prompt: string): boolean {
  if (!prompt) return true;
  const p = prompt.toLowerCase().trim();

  // Very short messages (likely greetings or single words)
  if (p.length < 10 && !p.includes('?')) return true;

  // Common greetings and simple phrases
  const simplePhrases = [
    'היי', 'שלום', 'מה נשמע', 'אהלן', 'מה קורה', 'בוקר טוב', 'ערב טוב', 'לילה טוב',
    'hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good evening',
    'עזרה', 'help', 'מה אתה יודע לעשות', 'מי אתה', 'מה התפקיד שלך',
    'תודה', 'thanks', 'thank you', 'בוטל', 'cancel', 'stop'
  ];

  if (simplePhrases.some(phrase => p === phrase || p.startsWith(phrase + ' '))) {
    // If it's just the basic phrase or starts with it followed by space
    // and isn't too long, it's likely simple.
    if (p.length < 30) return true;
  }

  return false;
}
