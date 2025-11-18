/**
 * Gemini Utils - Shared utility functions
 * Clean, reusable utilities for Gemini service
 */

const THINKING_SECTION_PATTERNS = [
  /\*\*My internal thoughts?:?\*\*[\s\S]*?(?=\n\n|\*\*[A-Z]|$)/gi,
  /\[Internal (thought|reasoning|analysis):[\s\S]*?\]/gi,
  /\(thinking:[\s\S]*?\)/gi,
];

const PARENTHETICAL_PATTERNS = [
  /\((?:I think|I believe|I should|I'll|Let me|This (is|will|should)|For example|In this case)[\s\S]*?\)/gi,
];

/**
 * Extract the actual error message from Gemini response
 * Uses finishMessage if available, otherwise constructs from finishReason
 * @param {Object} candidate - Gemini candidate object
 * @param {Object} promptFeedback - Gemini promptFeedback object
 * @returns {string} - User-friendly error message
 */
function getGeminiErrorMessage(candidate, promptFeedback = null) {
  // Priority 1: Use finishMessage if available (contains detailed explanation)
  if (candidate?.finishMessage) {
    return candidate.finishMessage;
  }
  
  // Priority 2: Use promptFeedback blockReasonMessage if available
  if (promptFeedback?.blockReasonMessage) {
    return promptFeedback.blockReasonMessage;
  }
  
  // Priority 3: Construct from finishReason
  if (candidate?.finishReason) {
    const reason = candidate.finishReason;
    
    if (reason === 'SAFETY' || reason === 'IMAGE_SAFETY') {
      return 'Gemini blocked the request due to safety concerns. Try a different image or prompt.';
    }
    if (reason === 'RECITATION') {
      return 'Gemini blocked the request due to potential copyright issues. Try a different prompt.';
    }
    if (reason === 'PROHIBITED_CONTENT') {
      return 'Gemini blocked the request due to prohibited content. Try a different image or prompt.';
    }
    
    return `Gemini returned no content (reason: ${reason})`;
  }
  
  // Fallback
  return 'No response from Gemini';
}

/**
 * Clean thinking patterns and meta-text from Gemini responses
 * Removes English meta-linguistic phrases, thinking sections, and duplicates
 * @param {string} text - Raw Gemini response text
 * @returns {string} - Cleaned text
 */
function cleanThinkingPatterns(text) {
  if (!text || typeof text !== 'string') return text;
  
  let cleaned = text;
  const originalLength = text.length;
  
  // 1. Remove "My internal thoughts:" or similar sections (CRITICAL!)
  for (const pattern of THINKING_SECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // 2. Remove parenthetical thinking/reasoning in English
  for (const pattern of PARENTHETICAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // 3. Remove duplicate paragraphs/sentences
  // Sometimes Gemini repeats the same text twice
  const lines = cleaned.split('\n');
  const uniqueLines = [];
  const seenLines = new Set();
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    // Skip empty lines in deduplication (but keep them in output)
    if (trimmedLine === '') {
      uniqueLines.push(line);
      continue;
    }
    
    // Only add non-duplicate content lines
    if (!seenLines.has(trimmedLine)) {
      seenLines.add(trimmedLine);
      uniqueLines.push(line);
    } else {
      console.log(`🧹 Removed duplicate line: "${trimmedLine.substring(0, 50)}..."`);
    }
  }
  
  cleaned = uniqueLines.join('\n');
  
  // 4. Remove consecutive duplicate words (sometimes Gemini stutters)
  // Example: "אני מבין מבין את השאלה" -> "אני מבין את השאלה"
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/g, '$1');
  
  // 5. Detect and handle mixed languages - remove English paragraphs if main content is Hebrew
  // Count Hebrew vs English characters to determine primary language
  const hebrewChars = (cleaned.match(/[\u0590-\u05FF]/g) || []).length;
  const englishChars = (cleaned.match(/[a-zA-Z]/g) || []).length;
  
  // If primary language is Hebrew (Hebrew chars > English chars), remove English-only paragraphs
  if (hebrewChars > englishChars && hebrewChars > 10) {
    console.log(`🌐 Detected Hebrew as primary language (${hebrewChars} Hebrew vs ${englishChars} English chars)`);
    
    // Split by double newlines (paragraphs)
    const paragraphs = cleaned.split(/\n\n+/);
    const filteredParagraphs = [];
    
    for (const para of paragraphs) {
      const paraHebrew = (para.match(/[\u0590-\u05FF]/g) || []).length;
      const paraEnglish = (para.match(/[a-zA-Z]/g) || []).length;
      
      // Keep paragraph if it has Hebrew OR if it's very short (like a single word/emoji)
      if (paraHebrew > 0 || para.trim().length < 20) {
        filteredParagraphs.push(para);
      } else if (paraEnglish > paraHebrew * 2) {
        // This paragraph is mostly English - likely meta-text
        console.log(`🧹 Removed English-only paragraph: "${para.substring(0, 60)}..."`);
      } else {
        // Keep it if unclear
        filteredParagraphs.push(para);
      }
    }
    
    cleaned = filteredParagraphs.join('\n\n');
  }
  
  // 6. Trim extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
  cleaned = cleaned.trim();
  
  // Log if significant cleaning happened
  if (cleaned.length < originalLength * 0.8) {
    console.log(`🧹 Cleaned thinking patterns: ${originalLength} -> ${cleaned.length} chars (removed ${originalLength - cleaned.length})`);
  }
  
  return cleaned;
}

module.exports = {
  getGeminiErrorMessage,
  cleanThinkingPatterns
};

