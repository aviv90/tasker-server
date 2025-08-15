/**
 * Error handling utilities for consistent error processing
 */

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
 * Get standardized error object for task storage
 * @param {any} error - The error to process
 * @param {string} fallback - Fallback message
 * @returns {object} - Standardized error object
 */
function getTaskError(error, fallback = 'Task failed without error details') {
    return {
        status: 'error',
        error: extractErrorMessage(error, fallback)
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

module.exports = {
    extractErrorMessage,
    isErrorResult,
    getTaskError,
    isCriticalError
};
