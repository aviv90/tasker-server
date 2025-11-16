/**
 * Tools Index - Central export for all agent tools
 * Single Source of Truth for tool exports
 * 
 * This file consolidates all tool modules into one unified interface.
 * Import this file to get access to ALL agent tools.
 */

// Context tools (history, memory, preferences)
const {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
} = require('./contextTools');

// Creation tools (image, video, music, poll)
const {
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll
} = require('./creationTools');

// Analysis tools (image, video analysis)
const {
  analyze_image,
  analyze_video
} = require('./analysisTools');

// Editing tools (image, video editing)
const {
  edit_image,
  edit_video
} = require('./editingTools');

// Audio tools (transcribe, TTS, voice clone, translate)
const {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
} = require('./audioTools');

// Search tools (web search)
const {
  search_web
} = require('./searchTools');

// Location tools (random location)
const {
  send_location
} = require('./locationTools');

// Summary tools (chat summary)
const {
  chat_summary
} = require('./summaryTools');

// Group tools (WhatsApp group creation)
const {
  create_group
} = require('./groupTools');

// Retry tools (command retry)
const {
  retry_last_command,
  setAgentToolsReference
} = require('./retryTools');

/**
 * All Agent Tools - Complete collection
 * Organized by category for easy reference
 */
const allTools = {
  // Context & Memory
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory,
  
  // Creation
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll,
  
  // Analysis
  analyze_image,
  analyze_video,
  
  // Editing
  edit_image,
  edit_video,
  
  // Audio & Voice
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak,
  
  // Search & Info
  search_web,
  chat_summary,
  
  // Location & Social
  send_location,
  create_group,
  
  // Meta & Retry
  retry_last_command
};

// Initialize retry tools with reference to all tools
setAgentToolsReference(allTools);

/**
 * Get tool declarations for Gemini Function Calling
 * @returns {Array} Array of tool declarations
 */
function getToolDeclarations() {
  return Object.values(allTools)
    .filter(tool => tool && tool.declaration)
    .map(tool => tool.declaration);
}

/**
 * Get tool by name
 * @param {string} name - Tool name
 * @returns {Object|null} Tool object or null if not found
 */
function getToolByName(name) {
  return allTools[name] || null;
}

/**
 * Get all tool names
 * @returns {Array<string>} Array of tool names
 */
function getAllToolNames() {
  return Object.keys(allTools);
}

/**
 * Export all tools and utility functions
 */
module.exports = {
  // Main exports
  allTools,
  
  // Utility functions
  getToolDeclarations,
  getToolByName,
  getAllToolNames,
  
  // Direct tool exports for backward compatibility
  ...allTools
};
