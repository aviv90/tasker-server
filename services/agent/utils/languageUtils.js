/**
 * Language Utilities - Language detection and instruction handling
 * 
 * Provides language-specific system instructions for the agent.
 * Extracted from agentService.js (Phase 4.2)
 */

const prompts = require('../../../config/prompts');

/**
 * Get language instruction for system prompt (wrapper for prompts config)
 * @param {string} langCode - Language code (he, en, ar, etc.)
 * @returns {string} - Language-specific instruction
 */
function getLanguageInstruction(langCode) {
  return prompts.languageInstructions[langCode] || prompts.languageInstructions['he'];
}

module.exports = {
  getLanguageInstruction
};

