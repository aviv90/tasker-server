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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allContextToolsMod = require('./contextTools');
const allContextTools = allContextToolsMod.default || allContextToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allCreationToolsMod = require('./creationTools');
const allCreationTools = allCreationToolsMod.default || allCreationToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allAnalysisToolsMod = require('./analysisTools');
const allAnalysisTools = allAnalysisToolsMod.default || allAnalysisToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allEditingToolsMod = require('./editingTools');
const allEditingTools = allEditingToolsMod.default || allEditingToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allSearchToolsMod = require('./searchTools');
const allSearchTools = allSearchToolsMod.default || allSearchToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allLocationToolsMod = require('./locationTools');
const allLocationTools = allLocationToolsMod.default || allLocationToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allGroupToolsMod = require('./groupTools');
const allGroupTools = allGroupToolsMod.default || allGroupToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allAudioToolsMod = require('./audioTools');
const allAudioTools = allAudioToolsMod.default || allAudioToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allSummaryToolsMod = require('./summaryTools');
const allSummaryTools = allSummaryToolsMod.default || allSummaryToolsMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allRetryToolsMod = require('./retryTools');
const allRetryTools = allRetryToolsMod.default || allRetryToolsMod;

// Import meta tools (advanced composite tools)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allMetaToolsMod = require('./metaTools');
const allMetaTools = allMetaToolsMod.default || allMetaToolsMod;

/**
 * Get all available agent tools
 * @returns {Record<string, unknown>} - All tools combined
 */
function getAllTools(): Record<string, unknown> {
  return {
    // CRITICAL: metaTools comes FIRST so basic tools can override any duplicates
    // This ensures we use the clean, modular implementations from specialized files
    ...allMetaTools,
    ...allContextTools,
    ...allCreationTools,
    ...allAnalysisTools,
    ...allEditingTools,
    ...allSearchTools,
    ...allLocationTools,
    ...allGroupTools,
    ...allAudioTools,
    ...allSummaryTools,
    ...allRetryTools
  };
}

module.exports = {
  getAllTools
};
