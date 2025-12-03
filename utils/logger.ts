/**
 * Professional Logging Utility
 * 
 * Centralized logging using Winston for structured, level-based logging.
 * Replaces console.log/error/warn with professional logging system.
 */

import winston from 'winston';
import path from 'path';
import config from '../config/env';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log level type
export type LogLevel = keyof typeof levels;

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Redaction format for secrets
const redactSecrets = winston.format((info) => {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'apiKey', 'apiToken'];

  const redact = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;

    // Handle arrays
    if (Array.isArray(obj)) return obj.map(redact);

    // Handle objects
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
          newObj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object') {
          newObj[key] = redact(obj[key]);
        } else {
          newObj[key] = obj[key];
        }
      }
    }
    return newObj;
  };

  return redact(info);
});

// Define the format of the log
const logFormat = winston.format.combine(
  redactSecrets(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Determine log level based on config
const getLogLevel = (): string => {
  return config.logLevel;
};

// Create the logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  levels,
  format: logFormat,
  transports: [
    // Always log to console
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
  // Don't exit on handled exceptions
  exitOnError: false
});

// Add file transports if enabled
if (config.enableFileLogging) {
  const logDir = config.logDir;

  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    })
  );

  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'all.log'),
    })
  );
}

// Log initialization
logger.debug(`Logger initialized at level: ${getLogLevel()}`, {
  environment: config.env
});

/**
 * Helper method to log with context
 */
function logWithContext(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  logger.log(level, message, meta);
}

/**
 * Backward-compatible wrapper methods that preserve existing console.log style
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
  debugWithContext: (message: string, meta?: Record<string, unknown>) => logWithContext('debug', message, meta),
  infoWithContext: (message: string, meta?: Record<string, unknown>) => logWithContext('info', message, meta),
  warnWithContext: (message: string, meta?: Record<string, unknown>) => logWithContext('warn', message, meta),
  errorWithContext: (message: string, meta?: Record<string, unknown>) => logWithContext('error', message, meta),

  // Backward-compatible methods (for gradual migration)
  log: createEmojiAwareLogger('info'),

  // Raw logger instance (for advanced usage)
  logger
};

export default loggerExport;
