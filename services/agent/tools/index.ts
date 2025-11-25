/**
 * Tools Index - Central export for all agent tools
 * Single Source of Truth for tool exports
 * 
 * This file consolidates all tool modules into one unified interface.
 * Import this file to get access to ALL agent tools.
 */

// Context tools (history, memory, preferences)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const contextToolsModule = require('./contextTools');
const {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
} = contextToolsModule.default || contextToolsModule;

// Creation tools (image, video, music, poll)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const creationToolsModule = require('./creationTools');
const {
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll
} = creationToolsModule.default || creationToolsModule;

// Analysis tools (image, video analysis)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const analysisToolsModule = require('./analysisTools');
const {
  analyze_image,
  analyze_video
} = analysisToolsModule.default || analysisToolsModule;

// Editing tools (image, video editing)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const editingToolsModule = require('./editingTools');
const {
  edit_image,
  edit_video
} = editingToolsModule.default || editingToolsModule;

// Audio tools (transcribe, TTS, voice clone, translate)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audioToolsModule = require('./audioTools');
const {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
} = audioToolsModule.default || audioToolsModule;

// Search tools (web search)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const searchToolsModule = require('./searchTools');
const {
  search_web
} = searchToolsModule.default || searchToolsModule;

// Location tools (random location)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const locationToolsModule = require('./locationTools');
const {
  send_location
} = locationToolsModule.default || locationToolsModule;

// Summary tools (chat summary)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const summaryToolsModule = require('./summaryTools');
const {
  chat_summary
} = summaryToolsModule.default || summaryToolsModule;

// Group tools (WhatsApp group creation)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const groupToolsModule = require('./groupTools');
const {
  create_group
} = groupToolsModule.default || groupToolsModule;

// Retry tools (command retry)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const retryToolsModule = require('./retryTools');
const {
  retry_last_command,
  setAgentToolsReference
} = retryToolsModule.default || retryToolsModule;

/**
 * Tool declaration interface
 */
interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool interface
 */
interface Tool {
  declaration: ToolDeclaration;
  execute: (args: unknown, context: unknown) => Promise<unknown>;
}

/**
 * All Agent Tools - Complete collection
 * Organized by category for easy reference
 */
const allTools: Record<string, Tool> = {
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
 * @returns {ToolDeclaration[]} Array of tool declarations
 */
function getToolDeclarations(): ToolDeclaration[] {
  return Object.values(allTools)
    .filter((tool): tool is Tool => tool !== null && tool !== undefined && typeof tool === 'object' && 'declaration' in tool)
    .map(tool => tool.declaration);
}

/**
 * Get tool by name
 * @param {string} name - Tool name
 * @returns {Tool | null} Tool object or null if not found
 */
function getToolByName(name: string): Tool | null {
  return (allTools[name] as Tool) || null;
}

/**
 * Get all tool names
 * @returns {string[]} Array of tool names
 */
function getAllToolNames(): string[] {
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
