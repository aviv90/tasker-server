/**
 * Error handling utilities for consistent error processing
 */

import logger from './logger';

/**
 * Error object structure that may contain error information
 */
interface ErrorObject {
  message?: string;
  error?: string | unknown;
  detail?: string;
  statusMessage?: string;
  blockReasonMessage?: string;
  code?: string;
  status?: string;
  response?: {
    status?: number;
  };
  [key: string]: unknown;
}

/**
 * Serialized error structure
 */
export interface SerializedError {
  name?: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Task error structure
 */
export interface TaskError {
  status: 'error';
  error: SerializedError | string | null;
}

/**
 * Extract error message from various error formats
 * @param error - The error object (can be string, object, or complex structure)
 * @param fallback - Fallback message if no error message found
 * @returns Clean error message
 */
export function extractErrorMessage(error: unknown, fallback: string = 'Unknown error occurred'): string {
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
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as ErrorObject;
    
    // Try common error message fields
    const message = errorObj.message || 
                   errorObj.error || 
                   errorObj.detail || 
                   errorObj.statusMessage ||
                   errorObj.blockReasonMessage;
    
    if (message) {
      return typeof message === 'string' ? message : JSON.stringify(message);
    }

    // If no direct message, try to create from object properties
    const errorDetails = Object.entries(errorObj)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    return errorDetails || JSON.stringify(errorObj);
  }

  // Last resort
  return String(error);
}

/**
 * Check if a result object indicates an error
 * @param result - The result object to check
 * @returns Returns the error value if found, or false if no error
 */
export function isErrorResult(result: unknown): unknown {
  // Match the exact behavior of: !result || result.error
  if (!result) {
    return result;
  }
  
  if (typeof result === 'object' && result !== null) {
    const resultObj = result as { error?: unknown };
    return resultObj.error || false;
  }
  
  return false;
}

/**
 * Serialize error object to ensure it's properly JSON serializable
 * @param error - The error to serialize
 * @returns JSON-serializable error object
 */
export function serializeError(error: unknown): SerializedError | string | null {
  if (!error) {
    return null;
  }

  // If it's already a string, return as-is
  if (typeof error === 'string') {
    return error;
  }

  // If it's an Error object, extract all enumerable properties
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };

    // Add any additional enumerable properties
    Object.getOwnPropertyNames(error).forEach(key => {
      if (!serialized.hasOwnProperty(key)) {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (typeof value !== 'function') {
          serialized[key] = value;
        }
      }
    });

    return serialized;
  }

  // If it's an object, ensure it's properly serializable
  if (typeof error === 'object' && error !== null) {
    try {
      // Test if it can be JSON stringified and parsed
      JSON.parse(JSON.stringify(error));
      return error as SerializedError;
    } catch (e) {
      // If not serializable, convert to a serializable format
      const serialized: Record<string, unknown> = {};
      Object.getOwnPropertyNames(error).forEach(key => {
        try {
          const value = (error as Record<string, unknown>)[key];
          if (typeof value !== 'function') {
            serialized[key] = value;
          }
        } catch (e) {
          serialized[key] = '[Non-serializable value]';
        }
      });
      return serialized as SerializedError;
    }
  }

  // For primitives, return as-is
  return String(error);
}

/**
 * Get standardized error object for task storage
 * @param error - The error to process
 * @param context - Optional context for logging only
 * @returns Standardized error object with full error details
 */
export function getTaskError(error: unknown, context: string = ''): TaskError {
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
 * @param error - The error to check
 * @returns True if error is critical
 */
export function isCriticalError(error: unknown): boolean {
  if (!error) return false;
  
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  
  const errorObj = error as ErrorObject;
  
  // Check for critical error conditions
  return errorObj.code === 'insufficientCredits' ||
         errorObj.status === 'error' ||
         (errorObj.response?.status !== undefined && 
          errorObj.response.status >= 400 && 
          errorObj.response.status < 500);
}

/**
 * Ensure user-facing error messages consistently include the red X emoji.
 * Keeps the original text "as-is" after the prefix.
 * This is the SSOT for error message formatting - ensures all user-facing errors have ❌ prefix.
 * @param message - Error message to format
 * @returns Formatted error message with ❌ prefix
 */
export function formatErrorMessage(message: unknown): string {
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
 * @param error - The error object (can be string, object, or complex structure)
 * @param fallback - Fallback message if no error message found
 * @returns Formatted error message ready for user display
 */
export function formatUserFacingError(error: unknown, fallback: string = 'שגיאה לא ידועה'): string {
  const message = extractErrorMessage(error, fallback);
  return formatErrorMessage(message);
}

/**
 * Format error message with provider name prefix
 * Format: ❌ שגיאה ב-<provider name>: <error message as-is>
 * @param provider - Provider name (will be formatted using formatProviderName)
 * @param errorMessage - Error message (will be extracted if not string)
 * @returns Formatted error message with provider prefix
 */
export function formatProviderError(provider: string, errorMessage: unknown): string {
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

/**
 * Extract error details for logging
 * Returns a standardized object with error message and stack trace
 * This is the SSOT for error logging format - ensures consistent error logging across the codebase
 * @param error - The error object (can be Error, string, or unknown)
 * @returns Object with error details for logging
 */
export function getErrorDetails(error: unknown): {
  message: string;
  stack?: string;
  name?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
  }
  
  return {
    message: typeof error === 'string' ? error : extractErrorMessage(error)
  };
}

/**
 * Format error for logger.error() calls
 * Returns an object suitable for logger.error() second parameter
 * This is the SSOT for error logging format - ensures consistent error logging
 * @param error - The error object (can be Error, string, or unknown)
 * @returns Object formatted for logger.error()
 */
export function formatErrorForLogging(error: unknown): {
  error: string | { message: string; stack?: string; name?: string };
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      stack: error.stack
    };
  }
  
  const errorMessage = typeof error === 'string' ? error : extractErrorMessage(error);
  return {
    error: errorMessage
  };
}

// Backward compatibility: CommonJS export
module.exports = {
  extractErrorMessage,
  formatErrorMessage,
  formatUserFacingError,
  formatProviderError,
  isErrorResult,
  getTaskError,
  isCriticalError,
  serializeError,
  getErrorDetails,
  formatErrorForLogging
};

