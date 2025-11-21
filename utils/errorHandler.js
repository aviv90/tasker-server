/**
 * Error handling utilities for consistent error processing
 */

const logger = require('./logger');

/**
 * Extract error message from various error formats
 * @param {any} error - The error object (can be string, object, or complex structure)
 * @param {string} fallback - Fallback message if no error message found
 * @returns {string} - Clean error message
 */
function extractErrorMessage(error, fallback = 'Unknown error occurred') {
    if (!error) {
        return fallback;
    }

    // If it's already a string
    if (typeof error === 'string') {
        return error;
    }

    // If it's an Error object
    if (error instanceof Error) {
        return error.message;
    }

    // If it's an object with multiple possible error fields
    if (typeof error === 'object') {
        // Try common error message fields
        const message = error.message || 
                       error.error || 
                       error.detail || 
                       error.statusMessage ||
                       error.blockReasonMessage;
        
        if (message) {
            return typeof message === 'string' ? message : JSON.stringify(message);
        }

        // If no direct message, try to create from object properties
        const errorDetails = Object.entries(error)
            .filter(([key, value]) => value !== undefined && value !== null)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');

        return errorDetails || JSON.stringify(error);
    }

    // Last resort
    return error.toString();
}

/**
 * Check if a result object indicates an error
 * @param {any} result - The result object to check
 * @returns {boolean|any} - Returns the error value if found, or false if no error
 */
function isErrorResult(result) {
    // Match the exact behavior of: !result || result.error
    return !result || result.error;
}

/**
 * Serialize error object to ensure it's properly JSON serializable
 * @param {any} error - The error to serialize
 * @returns {any} - JSON-serializable error object
 */
function serializeError(error) {
    if (!error) {
        return null;
    }

    // If it's already a string, return as-is
    if (typeof error === 'string') {
        return error;
    }

    // If it's an Error object, extract all enumerable properties
    if (error instanceof Error) {
        const serialized = {
            name: error.name,
            message: error.message,
            stack: error.stack
        };

        // Add any additional enumerable properties
        Object.getOwnPropertyNames(error).forEach(key => {
            if (!serialized.hasOwnProperty(key)) {
                serialized[key] = error[key];
            }
        });

        return serialized;
    }

    // If it's an object, ensure it's properly serializable
    if (typeof error === 'object') {
        try {
            // Test if it can be JSON stringified and parsed
            JSON.parse(JSON.stringify(error));
            return error;
        } catch (e) {
            // If not serializable, convert to a serializable format
            const serialized = {};
            Object.getOwnPropertyNames(error).forEach(key => {
                try {
                    const value = error[key];
                    if (typeof value !== 'function') {
                        serialized[key] = value;
                    }
                } catch (e) {
                    serialized[key] = '[Non-serializable value]';
                }
            });
            return serialized;
        }
    }

    // For primitives, return as-is
    return error;
}

/**
 * Get standardized error object for task storage
 * @param {any} error - The error to process
 * @param {string} context - Optional context for logging only
 * @returns {object} - Standardized error object with full error details
 */
function getTaskError(error, context = '') {
    // Log for server debugging
    if (context) {
        logger.error(`❌ Error in ${context}`, { 
            error: serializeError(error),
            context 
        });
    }

    return {
        status: 'error',
        error: serializeError(error) // Pass the full serialized error object
    };
}

/**
 * Check if error is critical (should stop processing)
 * @param {any} error - The error to check
 * @returns {boolean} - True if error is critical
 */
function isCriticalError(error) {
    if (!error) return false;
    
    const errorObj = typeof error === 'object' ? error : {};
    
    // Check for critical error conditions
    return errorObj.code === 'insufficientCredits' ||
           errorObj.status === 'error' ||
           (errorObj.response?.status >= 400 && errorObj.response?.status < 500);
}

/**
 * Ensure user-facing error messages consistently include the red X emoji.
 * Keeps the original text "as-is" after the prefix.
 * This is the SSOT for error message formatting - ensures all user-facing errors have ❌ prefix.
 * @param {string} message - Error message to format
 * @returns {string} - Formatted error message with ❌ prefix
 */
function formatErrorMessage(message) {
    if (!message || typeof message !== 'string') {
        return '❌ שגיאה לא ידועה';
    }

    const trimmed = message.trim();
    if (!trimmed) {
        return '❌ שגיאה לא ידועה';
    }

    if (trimmed.startsWith('❌')) {
        return trimmed;
    }

    return `❌ ${trimmed}`;
}

/**
 * Extract error message from various error formats AND format it for user display.
 * This is a combined function that does both extraction and formatting.
 * @param {any} error - The error object (can be string, object, or complex structure)
 * @param {string} fallback - Fallback message if no error message found
 * @returns {string} - Formatted error message ready for user display
 */
function formatUserFacingError(error, fallback = 'שגיאה לא ידועה') {
    const message = extractErrorMessage(error, fallback);
    return formatErrorMessage(message);
}

/**
 * Format error message with provider name prefix
 * Format: ❌ שגיאה ב-<provider name>: <error message as-is>
 * @param {string} provider - Provider name (will be formatted using formatProviderName)
 * @param {string|any} errorMessage - Error message (will be extracted if not string)
 * @returns {string} - Formatted error message with provider prefix
 */
function formatProviderError(provider, errorMessage) {
    // Import formatProviderName dynamically to avoid circular dependencies
    const { formatProviderName } = require('../services/agent/utils/providerUtils');
    
    // Format provider name
    const providerName = formatProviderName(provider);
    
    // Extract error message if needed
    const errorText = typeof errorMessage === 'string' 
        ? errorMessage 
        : extractErrorMessage(errorMessage, 'שגיאה לא ידועה');
    
    // Remove any existing ❌ prefix from error message (we'll add it at the start)
    const cleanError = errorText.replace(/^❌\s*/, '').trim();
    
    // Format: ❌ שגיאה ב-<provider>: <error>
    return `❌ שגיאה ב-${providerName}: ${cleanError}`;
}

module.exports = {
    extractErrorMessage,
    formatErrorMessage,
    formatUserFacingError,
    formatProviderError,
    isErrorResult,
    getTaskError,
    isCriticalError,
    serializeError
};
