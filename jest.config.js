/** @type {import('jest').Config} */
module.exports = {
  // Use ts-jest preset for TypeScript support
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Root directory for tests
  roots: ['<rootDir>'],
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Transform files
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        // Use the same tsconfig settings
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
      }
    }]
  },
  
  // Module name mapper (for path aliases if needed)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  
  // Coverage configuration
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/tests/**',
    '!**/migrations/**',
    '!**/scripts/**',
    '!**/public/**',
    '!**/index.ts', // Exclude entry point
    '!**/jest.config.*',
    '!**/tsconfig.json'
  ],
  
  // Coverage thresholds (will be enforced)
  // Starting with lower thresholds, will increase gradually as more tests are added
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30
    }
  },
  
  // Coverage reporters
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],
  
  // Coverage directory
  coverageDirectory: '<rootDir>/coverage',
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  
  // Test timeout (30 seconds)
  testTimeout: 30000,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // Module paths to ignore
  modulePathIgnorePatterns: [
    '/dist/',
    '/coverage/'
  ]
};

