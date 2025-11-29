/**
 * Jest Setup File
 * Runs before each test file
 */

// Set test environment variables
process.env.NODE_ENV = 'test';

// Mock logger to avoid console noise during tests
jest.mock('../../utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return {
    __esModule: true,
    default: mockLogger
  };
});

// Global test timeout
jest.setTimeout(30000);

// Clean up after all tests
afterAll(async () => {
  // Cleanup can be added here if needed
});

