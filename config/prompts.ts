/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 * 
 * This file now acts as a facade, importing from organized modules
 */

// Import from organized prompt modules
import { agentSystemInstruction, singleStepInstruction, openaiSystemInstruction, grokSystemInstruction, searchSystemInstruction, googleSearchSystemInstruction, googleSearchResponse, googleSearchExample } from './prompts/system';
import { multiStepPlanner } from './prompts/multiStep';
import { groupCreationParsingPrompt, ttsParsingPrompt, musicVideoParsingPrompt } from './prompts/parsing';
import { pollGenerationPrompt, locationMapsPrompt, locationGeneralPrompt, chatSummaryPrompt, translationPrompt } from './prompts/special';

const prompts = {
  // System prompts
  agentSystemInstruction,
  singleStepInstruction,
  openaiSystemInstruction,
  grokSystemInstruction,
  searchSystemInstruction,
  googleSearchSystemInstruction,
  googleSearchResponse,
  googleSearchExample,

  // Multi-step planning
  multiStepPlanner,

  // Parsing prompts
  groupCreationParsingPrompt,
  ttsParsingPrompt,
  musicVideoParsingPrompt,

  // Special purpose prompts
  pollGenerationPrompt,
  locationMapsPrompt,
  locationGeneralPrompt,
  chatSummaryPrompt,
  translationPrompt,

  /**
   * Language instructions mapping
   * These are used in system prompts to ensure responses match input language
   */
  languageInstructions: {
    'he': 'חשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.',
    'en': 'IMPORTANT: You must respond in English only. The answer must be in English.',
    'ar': 'مهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.',
    'ru': 'Очень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.'
  } as Record<string, string>
};

// Export for ES modules
export default prompts;

// CommonJS compatibility - this ensures require() works correctly
// This must come after the export default
module.exports = prompts;
module.exports.default = prompts;

