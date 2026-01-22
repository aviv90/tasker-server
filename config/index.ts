/**
 * Centralized Configuration File
 * 
 * Single Source of Truth for all application configuration.
 * Consolidates environment variables and constants.
 * 
 * Benefits:
 * - SSOT: All config in one place
 * - Type safety: Validated config values
 * - Documentation: Clear description of each setting
 * - Defaults: Sensible defaults for all options
 * - Validation: Early error detection on startup
 */

import path from 'path';
import logger from '../utils/logger';

/**
 * Configuration object
 * All environment variables and constants centralized here
 */
export const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  // Server Configuration
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    trustProxy: process.env.TRUST_PROXY !== 'false',
  },

  // API Keys - External Services
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY || null,
    openai: process.env.OPENAI_API_KEY || null,
    replicate: process.env.REPLICATE_API_KEY || null,
    grok: process.env.GROK_API_KEY || null,
    elevenlabs: process.env.ELEVENLABS_API_KEY || null,
    kie: process.env.KIE_API_KEY || null,
    serpApi: process.env.SERPAPI_API_KEY || null,
  },

  // Google Drive Configuration
  googleDrive: {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
    serviceAccountEmail: process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL || null,
    serviceAccountPrivateKey: process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY || null,
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || null,
    // SSL is required for remote databases
    needsSSL: (() => {
      const databaseUrl = process.env.DATABASE_URL || '';
      const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
      const isCloudSqlSocket = databaseUrl.includes('/cloudsql/');

      // SSL is required for remote TCP connections, but NOT for Cloud SQL Unix sockets
      return (process.env.NODE_ENV === 'production' || !isLocal) && !isCloudSqlSocket;
    })(),
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '30000', 10),
    }
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
    logDir: process.env.LOG_DIR || path.join(__dirname, '..', 'logs'),
    logUncaughtExceptions: process.env.LOG_UNCAUGHT_EXCEPTIONS !== 'false',
  },

  // URLs and Hosting
  urls: {
    // Server base URL - checked in priority order
    serverBaseUrl: (() => {
      // 1. Explicitly configured URLs
      if (process.env.SERVER_URL) return process.env.SERVER_URL;
      if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
      if (process.env.BASE_URL) return process.env.BASE_URL;

      // 2. Fallback for production (should be configured via env var in Cloud Run)
      if (process.env.NODE_ENV === 'production') {
        logger.warn('⚠️ SERVER_URL not set in production. Base URL might be incorrect.');
        return '';
      }

      // 3. Default for development
      const devPort = process.env.PORT || '3000';
      return `http://localhost:${devPort}`;
    })(),
  },

  // Paths
  paths: {
    public: path.join(__dirname, '..', 'public'),
    tmp: path.join(__dirname, '..', 'public', 'tmp'),
    static: path.join(__dirname, '..', 'public', 'tmp'),
    logs: path.join(__dirname, '..', 'logs'),
  },

  // AI Model Configuration
  models: {
    gemini: {
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
      apiVersion: 'v1beta'
    },
    openai: {
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
      imageModel: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3',
      videoModel: process.env.OPENAI_VIDEO_MODEL || 'sora-2',
    },
    grok: {
      defaultModel: process.env.GROK_MODEL || 'grok-4',
    },
    replicate: {
      defaultModel: process.env.REPLICATE_MODEL || 'kling',
    },
    elevenlabs: {
      defaultModel: process.env.ELEVENLABS_MODEL || 'eleven_v3',
      speechModel: process.env.ELEVENLABS_SPEECH_MODEL || 'scribe_v1_experimental',
    },
  },

  // Request Limits
  limits: {
    jsonBodySize: process.env.JSON_BODY_SIZE_LIMIT || '50mb',
    fileUploadSize: process.env.FILE_UPLOAD_SIZE_LIMIT || '100mb',
  },

  // Timeout Configuration
  timeouts: {
    database: parseInt(process.env.TIMEOUT_DATABASE || '30000', 10), // 30 seconds
    apiCall: parseInt(process.env.TIMEOUT_API || '60000', 10), // 60 seconds
    aiGeneration: parseInt(process.env.TIMEOUT_AI || '300000', 10), // 5 minutes
    fileOperation: parseInt(process.env.TIMEOUT_FILE || '30000', 10), // 30 seconds
    upload: parseInt(process.env.TIMEOUT_UPLOAD || '300000', 10), // 5 minutes
  },

  // Feature Flags
  features: {
    intentRouterUseLLM: process.env.INTENT_ROUTER_USE_LLM === 'on',
    autoVoiceTranscription: process.env.AUTO_VOICE_TRANSCRIPTION !== 'false',
    rateLimit: {
      api: {
        max: parseInt(process.env.RATE_LIMIT_API_MAX || '100', 10),
        windowMs: 15 * 60 * 1000, // 15 minutes
      },
      whatsapp: {
        max: parseInt(process.env.RATE_LIMIT_WHATSAPP_MAX || '200', 10),
        windowMs: 1 * 60 * 1000, // 1 minute
      },
      upload: {
        max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || '20', 10),
        windowMs: 15 * 60 * 1000, // 15 minutes
      },
      callback: {
        max: parseInt(process.env.RATE_LIMIT_CALLBACK_MAX || '50', 10),
        windowMs: 1 * 60 * 1000, // 1 minute
      },
      expensive: {
        max: parseInt(process.env.RATE_LIMIT_EXPENSIVE_MAX || '30', 10),
        windowMs: 60 * 60 * 1000, // 1 hour
      },
    },
  },

  // WhatsApp Configuration (if needed)
  whatsapp: {
    instanceId: process.env.GREEN_API_ID_INSTANCE || null,
    apiToken: process.env.GREEN_API_API_TOKEN_INSTANCE || null,
    webhookToken: process.env.GREEN_API_WEBHOOK_TOKEN || null,
  },

  // Agent Configuration (SSOT for agent settings)
  agent: {
    model: process.env.AGENT_MODEL || 'gemini-3-flash-preview',
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || '8', 10),
    timeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS || '240000', 10), // 4 minutes
    contextMemoryEnabled: (process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
  }
};

/**
 * Validate critical configuration on startup
 * @throws {Error} If critical config is missing
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // In production, API keys are required
  if (config.isProduction) {
    if (!config.apiKeys.gemini) {
      errors.push('GEMINI_API_KEY is required in production');
    }
    if (!config.database.url) {
      errors.push('DATABASE_URL is required in production');
    }
    if (!config.whatsapp.instanceId || !config.whatsapp.apiToken) {
      errors.push('GREEN_API_ID_INSTANCE and GREEN_API_API_TOKEN_INSTANCE are required in production');
    }
  }

  // Log warnings for missing optional keys (non-blocking)
  const optionalKeys = ['openai', 'replicate', 'grok', 'elevenlabs', 'kie'];
  optionalKeys.forEach(key => {
    if (!config.apiKeys[key as keyof typeof config.apiKeys]) {
      logger.warn(`⚠️ ${key.toUpperCase()}_API_KEY not set (some features may not work)`, {
        missingKey: key,
        service: 'tasker-server'
      });
    }
  });

  // Throw if critical errors found
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get configuration value by path (e.g., 'apiKeys.gemini')
 * @param configPath - Dot-separated path to config value
 * @param defaultValue - Default value if path not found
 * @returns Config value or default
 */
export function get(configPath: string, defaultValue: unknown = undefined): unknown {
  const keys = configPath.split('.');
  let value: unknown = config;

  for (const key of keys) {
    if (value && typeof value === 'object' && value !== null && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return defaultValue;
    }
  }

  return value;
}

// Validate on load (but don't throw in development to allow testing)
if (config.isProduction) {
  try {
    validateConfig();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Configuration validation failed', {
      error: errorMessage,
      service: 'tasker-server'
    });
    process.exit(1);
  }
} else {
  validateConfig(); // Just logs warnings in development
}

