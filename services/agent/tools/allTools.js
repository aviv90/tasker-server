/**
 * All Agent Tools
 * 
 * This file temporarily exports all tools from the original agentService.js
 * This allows us to maintain functionality while refactoring
 * 
 * TODO: Gradually split tools into separate modules (contextTools, creationTools, etc.)
 */

// Import context tools (already refactored)
const {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
} = require('./contextTools');

// For now, we need to extract tools from the original agentService.js
// We'll do this by requiring the original file and extracting the agentTools object
// This is a temporary solution until we finish the refactoring

// Read the original file to extract agentTools
// We'll need to do this carefully to avoid circular dependencies
const fs = require('fs');
const path = require('path');

// This is a workaround - we'll need to refactor this properly
// For now, we'll export a function that returns all tools
function getAllTools() {
  // Import the original agentService to get agentTools
  // We need to be careful about circular dependencies
  const originalService = require('../../agentService');
  
  // The original service doesn't export agentTools directly
  // We'll need to extract it from the file or refactor the original service
  // For now, let's create a hybrid approach
  
  // We'll build the tools object by combining refactored tools with original ones
  const tools = {
    // Context tools (refactored)
    get_chat_history,
    analyze_image_from_history,
    save_user_preference,
    get_long_term_memory,
    
    // TODO: Add remaining tools as they are refactored
    // For now, we'll need to keep using the original agentService.js
  };
  
  return tools;
}

module.exports = {
  getAllTools
};

