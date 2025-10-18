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
  // Hebrew patterns: "עם [ספק]", "ב[ספק]", "באמצעות [ספק]", "דרך [ספק]", "בעזרת [ספק]", "ל[ספק]", "את [ספק]"
  // English patterns: "with [provider]", "using [provider]", "via [provider]", "by [provider]", "to [provider]"
  // Works anywhere in the prompt: beginning, middle, or end
  
  const providerPatterns = [
    // Pattern 1: Provider with connection word (עם גרוק, with Grok, את גרוק, etc.)
    // Including attached "ל" prefix (לגרוק = ל+גרוק)
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(open\s*ai|openai|gpt|chat\s*gpt|chatgpt|dall[\s-]*e|dalle|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(grok|x\s*ai|xai|גרוק)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(gemini|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(veo\s*3(\.1)?|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(kling|קלינג)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(runway|רנוויי|ראנוויי)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(suno|סונו)/gi,
    /\s+(עם|ב|באמצעות|דרך|בעזרת|את|using|with|via|by|to)\s+(eleven\s*labs|elevenlabs|אלוון\s*לאבס|אלבן\s*לאבס)/gi,
    
    // Pattern 1b: Hebrew "ל" prefix attached to provider (לגרוק, לג'מיני, etc.)
    // Works with or without space before ל (שאל לגרוק, שאללגרוק)
    /\s*ל(grok|גרוק|gemini|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני|kling|קלינג|suno|סונו|open\s*ai|openai|chat\s*gpt|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי)/gi,
    /\s*ל(veo\s*3(\.1)?|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?)/gi,
    
    // Pattern 2: Provider at start (^גרוק, ^Grok, etc.) - standalone word
    /^(grok|גרוק)\s+/gi,
    /^(veo\s*3(\.1)?|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?)\s+/gi,
    /^(kling|קלינג)\s+/gi,
    /^(gemini|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני)\s+/gi,
    /^(open\s*ai|openai|gpt|chat\s*gpt|chatgpt|dall[\s-]*e|dalle|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי)\s+/gi,
    /^(runway|רנוויי|ראנוויי)\s+/gi,
    /^(suno|סונו)\s+/gi,
    /^(eleven\s*labs|elevenlabs|אלוון\s*לאבס|אלבן\s*לאבס)\s+/gi,
    
    // Pattern 3: Provider in middle without connection words (צור גרוק תמונה)
    // Replace with single space to preserve word separation
    /\s+(grok|גרוק)\s+/gi,
    /\s+(veo\s*3(\.1)?|ויאו\s*3(\.1)?|וו[יא]ו\s*3(\.1)?)\s+/gi,
    /\s+(kling|קלינג)\s+/gi,
    /\s+(gemini|ג'מיני|ג׳מיני|ג׳ימיני|ג'ימיני)\s+/gi,
    /\s+(open\s*ai|openai|gpt(?!\s*image)|chat\s*gpt|chatgpt|dall[\s-]*e|dalle|דאל[\s-]*אי|צ'אט\s*ג'יפיטי|צ׳אט\s*ג׳יפיטי)\s+/gi,
    /\s+(runway|רנוויי|ראנוויי)\s+/gi,
    /\s+(suno|סונו)\s+/gi
  ];

  // Apply all patterns, but preserve spacing
  for (const pattern of providerPatterns) {
    cleaned = cleaned.replace(pattern, ' '); // Replace with space instead of empty string
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

