/**
 * Jest Setup File
 * Runs before each test file
 * 
 * This file configures the global test environment:
 * - Sets environment variables
 * - Mocks global modules (logger, etc.)
 * - Configures Jest settings
 */

// ============================================================================
// Environment Setup
// ============================================================================

// Set test environment variables FIRST (before any imports)
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// ============================================================================
// Global Mocks
// ============================================================================

/**
 * Mock logger to avoid console noise during tests
 * This is applied globally to all tests
 */
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
    // Add child logger support
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    })
  }
}));

/**
 * Mock config to provide test-specific configuration
 * Individual tests can override this if needed
 */
jest.mock('../../config', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');
  const testTmpDir = path.join(__dirname, '..', '..', 'public', 'tmp');

  return {
    config: {
      // Environment
      env: 'test',
      isProduction: false,
      isDevelopment: true,

      // Server
      server: {
        port: 3000,
        host: '0.0.0.0',
        trustProxy: true
      },

      // API Keys
      apiKeys: {
        gemini: 'test-gemini-key',
        openai: 'test-openai-key',
        replicate: 'test-replicate-key',
        elevenlabs: 'test-elevenlabs-key',
        kie: 'test-kie-key'
      },

      // Database
      database: {
        url: 'postgresql://localhost:5432/tasker_test',
        needsSSL: false,
        pool: {
          max: 5,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000
        }
      },

      // Paths - important for file operations
      paths: {
        public: path.join(__dirname, '..', '..', 'public'),
        tmp: testTmpDir,
        static: testTmpDir,
        logs: path.join(__dirname, '..', '..', 'logs')
      },

      // URLs
      urls: {
        serverBaseUrl: 'http://localhost:3000',
        herokuAppName: null
      },

      // Timeouts
      timeouts: {
        database: 30000,
        apiCall: 60000,
        aiGeneration: 120000,
        fileOperation: 30000,
        upload: 300000
      },

      // Feature flags
      features: {
        intentRouterUseLLM: false,
        autoVoiceTranscription: true,
        rateLimit: {
          api: { max: 100, windowMs: 900000 },
          whatsapp: { max: 200, windowMs: 60000 },
          upload: { max: 20, windowMs: 3600000 },
          callback: { max: 50, windowMs: 60000 },
          expensive: { max: 10, windowMs: 60000 }
        }
      },

      // Limits
      limits: {
        jsonBodySize: '50mb',
        fileUploadSize: '100mb'
      },

      // Models
      models: {
        gemini: { defaultModel: 'gemini-2.5-flash' },
        openai: { defaultModel: 'gpt-4o', imageModel: 'dall-e-3' },
        elevenlabs: { defaultModel: 'eleven_v3' }
      },

      // Green API (WhatsApp)
      greenApi: {
        idInstance: 'test-instance',
        apiTokenInstance: 'test-token'
      },

      // Google Drive
      googleDrive: {
        clientId: null,
        clientSecret: null,
        refreshToken: null
      },

      // Logging
      logging: {
        level: 'silent',
        enableFileLogging: false
      }
    }
  };
});

// ============================================================================
// Jest Configuration
// ============================================================================

// Global test timeout (30 seconds for async operations)
jest.setTimeout(30000);

// ============================================================================
// Global Hooks
// ============================================================================

// Clear all mocks before each test to ensure isolation
beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// Custom Matchers (if needed)
// ============================================================================

// Add custom matchers here if needed in the future
// Example:
// expect.extend({
//   toBeWithinRange(received, floor, ceiling) {
//     const pass = received >= floor && received <= ceiling;
//     return { pass, message: () => `expected ${received} to be within range ${floor} - ${ceiling}` };
//   },
// });

// ============================================================================
// Global Test Utilities
// ============================================================================

// Make commonly used utilities available globally
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      testUtils: {
        wait: (ms: number) => Promise<void>;
      };
    }
  }
}

// Global wait utility that doesn't keep process alive
(global as unknown as { testUtils: { wait: (ms: number) => Promise<void> } }).testUtils = {
  wait: (ms: number): Promise<void> => {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      if (timer.unref) timer.unref();
    });
  }
};
