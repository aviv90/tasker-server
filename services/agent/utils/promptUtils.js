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
  
  let simplified = prompt;
  
  // Remove multiple adjectives
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

/**
 * Placeholder for shouldSplitTask - not used with LLM-first approach
 * Kept for backwards compatibility
 */
function shouldSplitTask(prompt) {
  return false; // Always false - using LLM planner instead
}

module.exports = {
  simplifyPrompt,
  shouldSplitTask,
  makePromptMoreGeneric
};

