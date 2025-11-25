/**
 * Fallback Tools
 *
 * Tools for automatic retry and fallback mechanisms when operations fail.
 * Refactored to use modular components (Phase 5.3)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const smartFallbackModule = require('./fallbackTools/smartFallback');
const smartFallback = smartFallbackModule.default || smartFallbackModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const retryProviderModule = require('./fallbackTools/retryProvider');
const retryProvider = retryProviderModule.default || retryProviderModule;

const fallbackTools = {
  smart_execute_with_fallback: smartFallback,
  retry_with_different_provider: retryProvider
};

export default fallbackTools;
module.exports = fallbackTools;
