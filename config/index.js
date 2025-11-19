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

const path = require('path');

/**
 * Configuration object
 * All environment variables and constants centralized here
 */
const config = {
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
    elevenlabs: process.env.ELEVEN_API_KEY || null,
    kie: process.env.KIE_API_KEY || null,
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || null,
    // SSL is required for remote databases (Heroku, etc.)
    needsSSL: (() => {
      const databaseUrl = process.env.DATABASE_URL || '';
      const isRemoteDB = databaseUrl && 
                        !databaseUrl.includes('localhost') && 
                        !databaseUrl.includes('127.0.0.1');
      return process.env.NODE_ENV === 'production' || isRemoteDB;
    })(),
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10),
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
      if (process.env.SERVER_URL) return process.env.SERVER_URL;
      if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
      if (process.env.HEROKU_APP_NAME) {
        return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
      }
      if (process.env.NODE_ENV === 'production') {
        return 'https://tasker-server-eb22b09c778f.herokuapp.com'; // Update when deploying
      }
      return 'http://localhost:3000';
    })(),
    herokuAppName: process.env.HEROKU_APP_NAME || null,
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
      defaultModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
      apiVersion: 'v1beta',
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

  // Feature Flags
  features: {
    // Intent Router - use LLM for routing instead of regex
    intentRouterUseLLM: process.env.INTENT_ROUTER_USE_LLM === 'on',
    // Enable automatic voice transcription for authorized users
    autoVoiceTranscription: process.env.AUTO_VOICE_TRANSCRIPTION !== 'false',
  },

  // WhatsApp Configuration (if needed)
  whatsapp: {
    // Add WhatsApp-specific config here if needed
  },
};

/**
 * Validate critical configuration on startup
 * @throws {Error} If critical config is missing
 */
function validateConfig() {
  const errors = [];

  // In production, API keys are required
  if (config.isProduction) {
    if (!config.apiKeys.gemini) {
      errors.push('GEMINI_API_KEY is required in production');
    }
    if (!config.database.url) {
      errors.push('DATABASE_URL is required in production');
    }
  }

  // Log warnings for missing optional keys (non-blocking)
  const optionalKeys = ['openai', 'replicate', 'grok', 'elevenlabs', 'kie'];
  optionalKeys.forEach(key => {
    if (!config.apiKeys[key]) {
      console.warn(`⚠️ ${key.toUpperCase()}_API_KEY not set (some features may not work)`);
    }
  });

  // Throw if critical errors found
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get configuration value by path (e.g., 'apiKeys.gemini')
 * @param {string} path - Dot-separated path to config value
 * @param {any} defaultValue - Default value if path not found
 * @returns {any} Config value or default
 */
function get(path, defaultValue = undefined) {
  const keys = path.split('.');
  let value = config;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
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
  } catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
    process.exit(1);
  }
} else {
  validateConfig(); // Just logs warnings in development
}

module.exports = {
  config,
  get,
  validateConfig
};

