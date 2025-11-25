/**
 * Meta Tools - Advanced composite tools
 *
 * This file is now an index that combines all meta tool categories:
 * - Context & Memory Tools (analyze_image_from_history, save_user_preference, get_long_term_memory)
 * - Fallback Tools (smart_execute_with_fallback, retry_with_different_provider)
 *
 * NOTE: Combined creation tools (create_and_analyze, analyze_and_edit, history_aware_create,
 * create_with_memory, search_and_create) were REMOVED in Phase 5.2 because they are redundant:
 * The Planner can chain tools automatically, making these composite tools unnecessary.
 *
 * Extracted and modularized in Phase 5.2
 */

import contextAndMemoryTools from './meta/contextAndMemoryTools';
import fallbackTools from './meta/fallbackTools';

const metaTools = {
  ...contextAndMemoryTools,
  ...fallbackTools
};

module.exports = metaTools;
