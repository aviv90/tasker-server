/**
 * Agent Tools Index
 * Central registry for all agent tools
 * 
 * This file imports and exports all tools from their respective modules
 */

// Context tools
const {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
} = require('./contextTools');

// For now, we'll import tools from the original agentService.js
// This will be gradually refactored to use separate tool files
// TODO: Split remaining tools into separate modules

// Import all tools from the original file temporarily
// This allows us to maintain functionality while refactoring
const originalAgentService = require('../../agentService');

// Extract agentTools from the original service
// We'll need to refactor this to use the new structure
let agentTools = {};

// Add context tools
agentTools.get_chat_history = get_chat_history;
agentTools.analyze_image_from_history = analyze_image_from_history;
agentTools.save_user_preference = save_user_preference;
agentTools.get_long_term_memory = get_long_term_memory;

// For now, we need to get the rest from the original file
// This is a temporary solution until we finish the refactoring
// We'll need to read the original file and extract the tools

module.exports = {
  agentTools,
  // Export individual tools for easier access
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
};

