/**
 * Application-wide constants
 * SSOT for magic numbers and common values
 */

/**
 * Time constants (in milliseconds)
 */
const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  
  // Common timeouts
  TYPING_INDICATOR: 1000, // Default typing time for all messages
  DB_CONNECTION_TIMEOUT: 10000, // 10 seconds for DB connection
  DB_RETRY_DELAY_BASE: 2000, // Base delay for DB retry (exponential backoff)
  DB_RETRY_MAX_DELAY: 30000, // Maximum delay for DB retry
  CLEANUP_DELAY: 60 * 60 * 1000, // 1 hour delay before first cleanup
  CIRCUIT_BREAKER_TIMEOUT: 60000, // 60 seconds for AI generation
  CIRCUIT_BREAKER_RESET: 60000, // 1 minute before retry
  VIDEO_GENERATION_TIMEOUT: 10 * 60 * 1000, // 10 minutes
  FILE_VERIFY_TIMEOUT: 10000, // 10 seconds
  FILE_VERIFY_RETRIES: 15, // Number of retries
  MULTI_STEP_MIN_TIMEOUT: 360000, // 6 minutes minimum
  CLEANUP_INTERVAL: 30 * 24 * 60 * 60 * 1000 // 30 days
};

/**
 * Text length limits
 */
const TEXT_LIMITS = {
  MAX_PROMPT_LENGTH: 2000,
  MIN_PROMPT_LENGTH: 3,
  MAX_SANITIZED_LENGTH: 2000
};

/**
 * File size constants (in bytes)
 */
const FILE_SIZE = {
  MIN_FILE_SIZE: 1000, // Minimum file size for validation
  MAX_BITRATE: 2000, // Maximum video bitrate (kbps)
  MAX_BITRATE_BUFFER: 4000 // Buffer size for bitrate (kbps)
};

/**
 * Audio processing constants
 */
const AUDIO = {
  MIN_DURATION_ESTIMATE: 3, // Minimum duration in seconds
  MAX_DURATION_ESTIMATE: 15, // Maximum duration in seconds
  BYTES_PER_SECOND_ESTIMATE: 10000 // Rough estimate for duration calculation
};

module.exports = {
  TIME,
  TEXT_LIMITS,
  FILE_SIZE,
  AUDIO
};

