/**
 * Timeout Utility
 * 
 * Provides timeout functionality for async operations.
 * Prevents hanging requests and improves system reliability.
 * 
 * Usage:
 *   const { withTimeout } = require('./utils/timeout');
 *   
 *   // With default timeout (30s)
 *   const result = await withTimeout(asyncOperation());
 *   
 *   // With custom timeout
 *   const result = await withTimeout(asyncOperation(), 60000);
 *   
 *   // With custom error message
 *   const result = await withTimeout(
 *     asyncOperation(),
 *     60000,
 *     'Operation took too long'
 *   );
 */

const logger = require('./logger');

/**
 * Create a promise that rejects after specified timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} message - Error message
 * @returns {Promise<never>} Promise that rejects with timeout error
 */
function createTimeoutPromise(timeoutMs, message = 'Operation timed out') {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`${message} (${timeoutMs}ms)`);
      error.code = 'TIMEOUT';
      error.timeout = timeoutMs;
      reject(error);
    }, timeoutMs);
  });
}

/**
 * Wrap async operation with timeout
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @param {string} operationName - Operation name for logging (optional)
 * @returns {Promise<any>} Promise that resolves/rejects based on operation or timeout
 */
async function withTimeout(promise, timeoutMs = 30000, operationName = null) {
  const operationLabel = operationName || 'Operation';
  
  try {
    const result = await Promise.race([
      promise,
      createTimeoutPromise(timeoutMs, `${operationLabel} timed out`)
    ]);
    
    return result;
  } catch (error) {
    if (error.code === 'TIMEOUT') {
      logger.warn(`⏱️ Timeout occurred`, {
        operation: operationLabel,
        timeout: timeoutMs,
        error: error.message
      });
    }
    throw error;
  }
}

/**
 * Timeout presets (in milliseconds)
 */
const TimeoutPresets = {
  SHORT: 5000,        // 5 seconds - quick operations
  MEDIUM: 30000,      // 30 seconds - standard operations
  LONG: 60000,        // 60 seconds - AI generation
  VERY_LONG: 120000,  // 2 minutes - video generation
  UPLOAD: 300000,     // 5 minutes - file uploads
};

/**
 * Create timeout wrapper for specific operation type
 * @param {string} operationType - Type of operation (for better error messages)
 * @param {number} defaultTimeout - Default timeout for this operation type
 * @returns {Function} Timeout wrapper function
 */
function createTimeoutWrapper(operationType, defaultTimeout = TimeoutPresets.MEDIUM) {
  return async (promise, timeoutMs = defaultTimeout) => {
    return withTimeout(promise, timeoutMs, operationType);
  };
}

/**
 * Common timeout wrappers
 */
const timeouts = {
  // Database operations
  database: createTimeoutWrapper('Database operation', TimeoutPresets.MEDIUM),
  
  // API calls
  apiCall: createTimeoutWrapper('API call', TimeoutPresets.LONG),
  
  // AI generation
  aiGeneration: createTimeoutWrapper('AI generation', TimeoutPresets.VERY_LONG),
  
  // File operations
  fileOperation: createTimeoutWrapper('File operation', TimeoutPresets.MEDIUM),
  
  // Upload operations
  upload: createTimeoutWrapper('Upload operation', TimeoutPresets.UPLOAD),
  
  // Quick operations
  quick: createTimeoutWrapper('Quick operation', TimeoutPresets.SHORT),
};

module.exports = {
  withTimeout,
  createTimeoutPromise,
  createTimeoutWrapper,
  TimeoutPresets,
  timeouts
};

