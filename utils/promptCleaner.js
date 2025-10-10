/**
 * Prompt Cleaner Utility
 * Removes provider/model mentions from prompts before sending to AI services
 */

/**
 * Clean provider and model names from prompt
 * Removes mentions like "with Grok", "עם OpenAI", "with Veo 3", etc.
 * 
 * @param {string} prompt - Original prompt
 * @returns {string} - Cleaned prompt without provider mentions
 */
function cleanPromptFromProviders(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return prompt;
  }

  let cleaned = prompt;

  // Remove provider mentions (case-insensitive, space-flexible)
  // Hebrew patterns: "עם [ספק]", "ב[ספק]", "באמצעות [ספק]", "דרך [ספק]", "בעזרת [ספק]"
  // English patterns: "with [provider]", "using [provider]", "via [provider]", "by [provider]"
  
  const providerPatterns = [
    // OpenAI variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(open\s*ai|openai|gpt|chat\s*gpt|chatgpt|dall[\s-]*e|dalle|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי)/gi,
    
    // Grok variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(grok|x\s*ai|xai|גרוק)/gi,
    
    // Gemini variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(gemini|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני)/gi,
    
    // Veo variations (including "Veo 3", "veo3", etc. - English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(veo\s*3?|ויאו\s*3?|וו[יא]ו\s*3?)/gi,
    
    // Kling variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(kling|קלינג)/gi,
    
    // Runway variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(runway|רנוויי|ראנוויי)/gi,
    
    // Suno variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(suno|סונו)/gi,
    
    // ElevenLabs variations (English + Hebrew)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|using|with|via|by)\s+(eleven\s*labs|elevenlabs|אלוון\s*לאבס|אלבן\s*לאבס)/gi
  ];

  // Apply all patterns
  for (const pattern of providerPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up multiple spaces that might result from removals
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  // Log if we cleaned something
  if (cleaned !== prompt) {
    console.log(`🧹 Cleaned prompt:`);
    console.log(`   Before: "${prompt}"`);
    console.log(`   After: "${cleaned}"`);
  }

  return cleaned;
}

module.exports = {
  cleanPromptFromProviders
};

