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

import winston from 'winston';
import path from 'path';

/**
 * Supported log levels
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';

/**
 * Determine log level from environment (default: info)
 * Production defaults to 'info', development defaults to 'debug'
 */
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

const logLevel: LogLevel = getLogLevel();

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
    // Format metadata
    const metaStr = Object.keys(meta).length > 0 
      ? ' ' + JSON.stringify(meta, null, 2)
      : '';
    
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport (always active)
transports.push(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    level: logLevel
  })
);

/**
 * File logging configuration constants
 */
const FILE_LOGGING_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB in bytes
  MAX_FILES: 5
} as const;

// File transport for production (optional)
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_FILE_LOGGING === 'true') {
  const logDir = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
  
  transports.push(
    // Error log file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: FILE_LOGGING_CONFIG.MAX_FILE_SIZE,
      maxFiles: FILE_LOGGING_CONFIG.MAX_FILES
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: logFormat,
      maxsize: FILE_LOGGING_CONFIG.MAX_FILE_SIZE,
      maxFiles: FILE_LOGGING_CONFIG.MAX_FILES
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
 * @param level - Log level (debug, info, warn, error)
 * @param message - Log message (can include emojis)
 * @param meta - Additional metadata
 */
function logWithContext(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  logger.log(level, message, meta);
}

/**
 * Convenience methods that preserve emoji patterns from existing code
 */
interface ExtendedLogger extends winston.Logger {
  debugWithContext: (message: string, meta?: Record<string, unknown>) => void;
  infoWithContext: (message: string, meta?: Record<string, unknown>) => void;
  warnWithContext: (message: string, meta?: Record<string, unknown>) => void;
  errorWithContext: (message: string, meta?: Record<string, unknown>) => void;
}

const extendedLogger = logger as ExtendedLogger;
extendedLogger.debugWithContext = (message: string, meta?: Record<string, unknown>) => logWithContext('debug', message, meta);
extendedLogger.infoWithContext = (message: string, meta?: Record<string, unknown>) => logWithContext('info', message, meta);
extendedLogger.warnWithContext = (message: string, meta?: Record<string, unknown>) => logWithContext('warn', message, meta);
extendedLogger.errorWithContext = (message: string, meta?: Record<string, unknown>) => logWithContext('error', message, meta);

/**
 * Backward-compatible wrapper methods that preserve existing console.log style
 * These methods allow gradual migration - existing emoji patterns work as-is
 */
const createEmojiAwareLogger = (level: LogLevel) => {
  return (message: string, ...args: unknown[]): void => {
    // If first arg is an object, treat it as metadata
    const meta = args.length > 0 && typeof args[0] === 'object' && !(args[0] instanceof Error)
      ? (args[0] as Record<string, unknown>)
      : {};
    
    // If there's an error object, add it to metadata
    const error = args.find(arg => arg instanceof Error) as Error | undefined;
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

// Type definitions for logger interface
export interface LoggerInterface {
  debug: (message: string, ...meta: unknown[]) => void;
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: string, ...meta: unknown[]) => void;
  debugWithContext: (message: string, meta?: Record<string, unknown>) => void;
  infoWithContext: (message: string, meta?: Record<string, unknown>) => void;
  warnWithContext: (message: string, meta?: Record<string, unknown>) => void;
  errorWithContext: (message: string, meta?: Record<string, unknown>) => void;
  log: (message: string, ...args: unknown[]) => void;
  logger: winston.Logger;
}

// Export logger with backward-compatible methods
const loggerExport: LoggerInterface = {
  // Standard Winston logger methods
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  
  // Context-aware methods
  debugWithContext: extendedLogger.debugWithContext,
  infoWithContext: extendedLogger.infoWithContext,
  warnWithContext: extendedLogger.warnWithContext,
  errorWithContext: extendedLogger.errorWithContext,
  
  // Backward-compatible methods (for gradual migration)
  log: createEmojiAwareLogger('info'),
  
  // Raw logger instance (for advanced usage)
  logger
};

export default loggerExport;

// Backward compatibility: CommonJS export
module.exports = loggerExport;

