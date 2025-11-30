/** @type {import('jest').Config} */
module.exports = {
  // ============================================================================
  // TypeScript Configuration
  // ============================================================================
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Prevent Babel from interfering with ts-jest
  globals: {
    'ts-jest': {
      isolatedModules: false,
      babelConfig: false
    }
  },

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictPropertyInitialization: true,
        noImplicitThis: true,
        alwaysStrict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ['node', 'jest']
      },
      isolatedModules: true
    }]
  },

  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)'
  ],

  // ============================================================================
  // Test Discovery
  // ============================================================================
  roots: ['<rootDir>'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Module path aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^uuid$': '<rootDir>/tests/mocks/uuid.ts'
  },

  // ============================================================================
  // Test Execution
  // ============================================================================

  // Setup files (run before each test file)
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],

  // Timeouts
  testTimeout: 30000,

  // Mock behavior
  clearMocks: true,      // Clear mock calls between tests
  restoreMocks: true,    // Restore original implementation after each test
  resetMocks: false,     // Don't reset mock state (keeps implementation)

  // Don't force exit - tests should clean up properly
  forceExit: false,

  // Run tests in parallel (default)
  maxWorkers: '50%',

  // ============================================================================
  // Coverage Configuration
  // ============================================================================
  collectCoverageFrom: [
    '**/*.ts',
    // Exclusions
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/tests/**',
    '!**/migrations/**',
    '!**/scripts/**',
    '!**/public/**',
    '!**/index.ts',
    '!**/jest.config.*',
    '!**/tsconfig.json',
    '!**/*.test.ts',
    '!**/*.spec.ts'
  ],

  // Coverage thresholds - start low, increase gradually
  // Current: ~3% coverage
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    }
  },

  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  coverageDirectory: '<rootDir>/coverage',

  // ============================================================================
  // Output Configuration
  // ============================================================================
  verbose: true,

  // ============================================================================
  // Path Ignores
  // ============================================================================
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  modulePathIgnorePatterns: [
    '/dist/',
    '/coverage/'
  ],

  // ============================================================================
  // Performance Optimizations
  // ============================================================================

  // Cache transformed files for faster subsequent runs
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',

  // Don't run tests in watch mode by default in CI
  watchPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ]
};

