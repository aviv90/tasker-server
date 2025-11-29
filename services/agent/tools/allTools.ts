/**
 * All Agent Tools
 * 
 * Central registry for all agent tools, combining:
 * - Basic tools (contextTools, creationTools, etc.)
 * - Meta tools (composite/advanced tools)
 * 
 * Phase 4 Refactoring - All tools now modular
 * Phase 6 - Cleaned up to use ES6 imports only
 */

// Import modular tools from different categories using ES6 imports
import allContextTools from './contextTools';
import allCreationTools from './creationTools';
import allAnalysisTools from './analysisTools';
import allEditingTools from './editingTools';
import allSearchTools from './searchTools';
import allLocationTools from './locationTools';
import allGroupTools from './groupTools';
import allAudioTools from './audioTools';
import allSummaryTools from './summaryTools';
import allRetryTools from './retryTools';

// Import meta tools (advanced composite tools)
import allMetaTools from './metaTools';

/**
 * Get all available agent tools
 * @returns {Record<string, unknown>} - All tools combined
 */
export function getAllTools(): Record<string, unknown> {
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

export default { getAllTools };
