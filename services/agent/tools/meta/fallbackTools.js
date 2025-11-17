/**
 * Fallback Tools
 * 
 * Tools for automatic retry and fallback mechanisms when operations fail.
 * Refactored to use modular components (Phase 5.3)
 */

const smartFallback = require('./fallbackTools/smartFallback');
const retryProvider = require('./fallbackTools/retryProvider');

const fallbackTools = {
  smart_execute_with_fallback: smartFallback,
  retry_with_different_provider: retryProvider
};

module.exports = fallbackTools;
