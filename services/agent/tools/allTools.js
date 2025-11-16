/**
 * All Agent Tools
 * 
 * Central registry for all agent tools, combining:
 * - Basic tools (contextTools, creationTools, etc.)
 * - Meta tools (composite/advanced tools)
 * 
 * Phase 4 Refactoring - All tools now modular
 */

// Import modular tools from different categories
const contextTools = require('./contextTools');
const creationTools = require('./creationTools');
const analysisTools = require('./analysisTools');
const editingTools = require('./editingTools');
const searchTools = require('./searchTools');
const locationTools = require('./locationTools');
const groupTools = require('./groupTools');
const audioTools = require('./audioTools');
const summaryTools = require('./summaryTools');
const retryTools = require('./retryTools');

// Import meta tools (advanced composite tools)
const metaTools = require('./metaTools');

/**
 * Get all available agent tools
 * @returns {Object} - All tools combined
 */
function getAllTools() {
  return {
    // CRITICAL: metaTools comes FIRST so basic tools can override any duplicates
    // This ensures we use the clean, modular implementations from specialized files
    ...metaTools,
    ...contextTools,
    ...creationTools,
    ...analysisTools,
    ...editingTools,
    ...searchTools,
    ...locationTools,
    ...groupTools,
    ...audioTools,
    ...summaryTools,
    ...retryTools
  };
}

module.exports = {
  getAllTools
};

