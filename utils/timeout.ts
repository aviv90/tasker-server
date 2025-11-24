/**
 * Timeout Utility
 * 
 * Provides timeout functionality for async operations.
 * Prevents hanging requests and improves system reliability.
 * 
 * Usage:
 *   import { withTimeout } from './utils/timeout';
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

import logger from './logger';

/**
 * Timeout error with additional metadata
 */
export class TimeoutError extends Error {
  code: string;
  timeout: number;

  constructor(message: string, timeout: number) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.timeout = timeout;
  }
}

/**
 * Create a promise that rejects after specified timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Error message
 * @returns Promise that rejects with timeout error
 */
export function createTimeoutPromise(timeoutMs: number, message: string = 'Operation timed out'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new TimeoutError(`${message} (${timeoutMs}ms)`, timeoutMs);
      reject(error);
    }, timeoutMs);
  });
}

/**
 * Wrap async operation with timeout
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @param operationName - Operation name for logging (optional)
 * @returns Promise that resolves/rejects based on operation or timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000,
  operationName: string | null = null
): Promise<T> {
  const operationLabel = operationName || 'Operation';
  
  try {
    const result = await Promise.race([
      promise,
      createTimeoutPromise(timeoutMs, `${operationLabel} timed out`)
    ]);
    
    return result;
  } catch (error: unknown) {
    if (error instanceof TimeoutError) {
      logger.warn('⏱️ Timeout occurred', {
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
export const TimeoutPresets = {
  SHORT: 5000,        // 5 seconds - quick operations
  MEDIUM: 30000,      // 30 seconds - standard operations
  LONG: 60000,        // 60 seconds - AI generation
  VERY_LONG: 120000,  // 2 minutes - video generation
  UPLOAD: 300000,     // 5 minutes - file uploads
} as const;

/**
 * Timeout wrapper function type
 */
export type TimeoutWrapper = <T>(promise: Promise<T>, timeoutMs?: number) => Promise<T>;

/**
 * Create timeout wrapper for specific operation type
 * @param operationType - Type of operation (for better error messages)
 * @param defaultTimeout - Default timeout for this operation type
 * @returns Timeout wrapper function
 */
export function createTimeoutWrapper(
  operationType: string,
  defaultTimeout: number = TimeoutPresets.MEDIUM
): TimeoutWrapper {
  return async <T>(promise: Promise<T>, timeoutMs: number = defaultTimeout): Promise<T> => {
    return withTimeout(promise, timeoutMs, operationType);
  };
}

/**
 * Common timeout wrappers
 */
export const timeouts = {
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

