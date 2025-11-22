/**
 * Application-wide constants
 * SSOT (Single Source of Truth) for magic numbers and common values
 * 
 * All time-related constants are in milliseconds unless otherwise specified.
 */

/**
 * Time constants (in milliseconds)
 * Used throughout the application for timeouts, intervals, and duration calculations
 */
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  
  // Common timeouts (using computed values for consistency)
  TYPING_INDICATOR: 1000, // Default typing time for all messages
  CIRCUIT_BREAKER_TIMEOUT: 60 * 1000, // 60 seconds for AI generation
  CIRCUIT_BREAKER_RESET: 60 * 1000, // 1 minute before retry
  VIDEO_GENERATION_TIMEOUT: 10 * 60 * 1000, // 10 minutes
  FILE_VERIFY_TIMEOUT: 10 * 1000, // 10 seconds
  FILE_VERIFY_RETRIES: 15, // Number of retries
  MULTI_STEP_MIN_TIMEOUT: 6 * 60 * 1000, // 6 minutes minimum
  CLEANUP_INTERVAL: 30 * 24 * 60 * 60 * 1000 // 30 days
} as const;

/**
 * Text length limits
 * Used for input validation and sanitization
 */
export const TEXT_LIMITS = {
  MAX_PROMPT_LENGTH: 2000,
  MIN_PROMPT_LENGTH: 3,
  MAX_SANITIZED_LENGTH: 2000
} as const;

/**
 * File size constants
 * - Sizes are in bytes unless otherwise specified
 * - Bitrates are in kbps (kilobits per second)
 */
export const FILE_SIZE = {
  MIN_FILE_SIZE: 1000, // Minimum file size for validation
  MAX_BITRATE: 2000, // Maximum video bitrate (kbps)
  MAX_BITRATE_BUFFER: 4000 // Buffer size for bitrate (kbps)
} as const;

/**
 * Audio processing constants
 * Used for audio duration estimation and validation
 */
export const AUDIO = {
  MIN_DURATION_ESTIMATE: 3, // Minimum duration in seconds
  MAX_DURATION_ESTIMATE: 15, // Maximum duration in seconds
  BYTES_PER_SECOND_ESTIMATE: 10000 // Rough estimate for duration calculation
} as const;

// Type definitions for better type safety
export type TimeConstants = typeof TIME;
export type TextLimits = typeof TEXT_LIMITS;
export type FileSizeConstants = typeof FILE_SIZE;
export type AudioConstants = typeof AUDIO;

// Backward compatibility: CommonJS export
module.exports = {
  TIME,
  TEXT_LIMITS,
  FILE_SIZE,
  AUDIO
};

