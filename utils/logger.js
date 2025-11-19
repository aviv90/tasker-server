/**
 * Professional Logging Utility
 * 
 * Centralized logging using Winston for structured, level-based logging.
 * Replaces console.log/error/warn with professional logging system.
 * 
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Operation completed', { userId: '123', action: 'create_image' });
 *   logger.error('Operation failed', { error: err.message, context: {...} });
 */

const winston = require('winston');
const path = require('path');

// Determine log level from environment (default: info)
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Preserve emoji patterns from existing code
    const emojiPattern = /[✅❌⚠️🔄🎤📝🌐🎨🎬🎵🔧💬]/;
    const hasEmoji = emojiPattern.test(message);
    
    // Format metadata
    const metaStr = Object.keys(meta).length > 0 
      ? ' ' + JSON.stringify(meta, null, 2)
      : '';
    
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Create transports array
const transports = [];

// Console transport (always active)
transports.push(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    level: logLevel
  })
);

// File transport for production (optional)
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_FILE_LOGGING === 'true') {
  const logDir = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
  
  transports.push(
    // Error log file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: {
    service: 'tasker-server',
    environment: process.env.NODE_ENV || 'development'
  },
  transports,
  // Don't exit on handled exceptions
  exitOnError: false
});

// Handle uncaught exceptions and unhandled rejections
if (process.env.LOG_UNCAUGHT_EXCEPTIONS !== 'false') {
  logger.exceptions.handle(
    new winston.transports.Console({
      format: logFormat
    })
  );
  
  logger.rejections.handle(
    new winston.transports.Console({
      format: logFormat
    })
  );
}

/**
 * Helper method to log with context (preserves existing emoji-based style)
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {string} message - Log message (can include emojis)
 * @param {Object} meta - Additional metadata
 */
function logWithContext(level, message, meta = {}) {
  logger.log(level, message, meta);
}

/**
 * Convenience methods that preserve emoji patterns from existing code
 */
logger.debugWithContext = (message, meta) => logWithContext('debug', message, meta);
logger.infoWithContext = (message, meta) => logWithContext('info', message, meta);
logger.warnWithContext = (message, meta) => logWithContext('warn', message, meta);
logger.errorWithContext = (message, meta) => logWithContext('error', message, meta);

/**
 * Backward-compatible wrapper methods that preserve existing console.log style
 * These methods allow gradual migration - existing emoji patterns work as-is
 */
const createEmojiAwareLogger = (level) => {
  return (message, ...args) => {
    // If first arg is an object, treat it as metadata
    const meta = args.length > 0 && typeof args[0] === 'object' && !(args[0] instanceof Error)
      ? args[0]
      : {};
    
    // If there's an error object, add it to metadata
    const error = args.find(arg => arg instanceof Error);
    if (error) {
      meta.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    }
    
    logger.log(level, message, Object.keys(meta).length > 0 ? meta : undefined);
  };
};

// Export logger with backward-compatible methods
module.exports = {
  // Standard Winston logger methods
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  
  // Context-aware methods
  debugWithContext: logger.debugWithContext,
  infoWithContext: logger.infoWithContext,
  warnWithContext: logger.warnWithContext,
  errorWithContext: logger.errorWithContext,
  
  // Backward-compatible methods (for gradual migration)
  log: createEmojiAwareLogger('info'),
  
  // Raw logger instance (for advanced usage)
  logger
};

