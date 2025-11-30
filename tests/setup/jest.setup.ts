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
  try {
    // Close database connections if they exist
    const { closeTestDatabase } = await import('./database');
    await closeTestDatabase();
  } catch (error) {
    // Ignore errors if database wasn't initialized
  }
  
  // Force close any remaining handles
  // Give Jest time to clean up
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    if (timer.unref) {
      timer.unref();
    }
  });
}, 5000); // 5 second timeout for cleanup

