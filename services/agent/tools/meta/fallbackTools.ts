/**
 * Fallback Tools
 *
 * Tools for automatic retry and fallback mechanisms when operations fail.
 * Refactored to use modular components (Phase 5.3)
 */

import retryProvider from './fallbackTools/retryProvider';

const fallbackTools = {
  retry_with_different_provider: retryProvider
};

export default fallbackTools;
