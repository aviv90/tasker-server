/**
 * Prompt Utility Functions
 * Helper functions for prompt manipulation and simplification
 */

/**
 * Simplify a complex prompt by removing unnecessary details
 * @param {string} prompt - Original prompt
 * @returns {string} - Simplified prompt
 */
function simplifyPrompt(prompt) {
  if (!prompt) return prompt;
  
  // Remove excessive details, adjectives, and complex descriptions
  let simplified = prompt;
  
  // Remove multiple adjectives (keep only core nouns/verbs)
  // "beautiful, stunning, amazing cat" → "cat"
  simplified = simplified.replace(/(\w+,\s*){2,}(\w+)\s+(\w+)/gi, '$3');
  
  // Remove very specific style requests
  simplified = simplified.replace(/\b(in the style of|בסגנון|כמו|like)\s+.+?(,|\.|$)/gi, '');
  
  // Remove detailed background descriptions
  simplified = simplified.replace(/\b(with (a |an )?background|ברקע|עם רקע)\s+.+?(,|\.|$)/gi, '');
  
  // Remove complex lighting/atmosphere descriptions
  simplified = simplified.replace(/\b(lighting|תאורה|אווירה|atmosphere):?\s+.+?(,|\.|$)/gi, '');
  
  // Trim and clean up
  simplified = simplified.trim().replace(/\s+/g, ' ');
  
  // If we removed too much, return original
  if (simplified.length < 10) return prompt;
  
  return simplified;
}

/**
 * Check if a prompt is too complex and should be split
 * @param {string} prompt - Prompt to check
 * @returns {boolean} - True if should split
 */
function shouldSplitTask(prompt) {
  if (!prompt) return false;
  
  // Check for multiple independent requests
  const hasMultipleRequests = /\bו(גם|אז|אחר כך|לאחר מכן)\b/gi.test(prompt) || 
                              /\b(and then|after that|also|plus)\b/gi.test(prompt);
  
  // Check for conditional logic
  const hasConditional = /\b(אם|if|when|כש|במידה)\b/gi.test(prompt);
  
  // Check for multiple steps explicitly mentioned
  const hasSteps = /\b(קודם|ראשון|שני|שלישי|אחרון|first|second|third|last|step)\b/gi.test(prompt);
  
  // Check prompt length (very long prompts often need splitting)
  const isTooLong = prompt.length > 200;
  
  return (hasMultipleRequests || hasConditional || hasSteps) && isTooLong;
}

/**
 * Make a prompt more generic by removing specific details
 * @param {string} prompt - Original prompt
 * @returns {string} - Generic version
 */
function makePromptMoreGeneric(prompt) {
  if (!prompt) return prompt;
  
  let generic = prompt;
  
  // Remove specific names/brands
  generic = generic.replace(/\b(של|מבית|by|from)\s+[A-Z][a-z]+\b/g, '');
  
  // Remove specific years/dates
  generic = generic.replace(/\b(מ?שנת|from|in)\s+(19|20)\d{2}\b/gi, '');
  
  // Remove very specific technical terms
  generic = generic.replace(/\b(resolution|רזולוציה|quality|איכות):\s*\d+[a-z]*/gi, '');
  
  // Remove specific color codes
  generic = generic.replace(/#[0-9A-Fa-f]{6}\b/g, 'color');
  
  // Simplify comparative language
  generic = generic.replace(/\b(very|extremely|super|incredibly|מאוד|סופר|במיוחד)\s+/gi, '');
  
  // Trim
  generic = generic.trim().replace(/\s+/g, ' ');
  
  return generic;
}

module.exports = {
  simplifyPrompt,
  shouldSplitTask,
  makePromptMoreGeneric
};

