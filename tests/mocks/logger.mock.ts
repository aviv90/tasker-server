/**
 * Logger Mock
 * Centralized mock for the logger module
 * 
 * This mock is automatically applied in jest.setup.ts,
 * but can be imported for more specific mock behavior.
 */

export const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  silly: jest.fn(),
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
};

/**
 * Get the mock logger (same instance used in tests)
 */
export function getMockLogger() {
  return mockLogger;
}

/**
 * Clear all logger mock calls
 */
export function clearLoggerMocks() {
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
  mockLogger.verbose.mockClear();
  mockLogger.silly.mockClear();
}

/**
 * Assert that an error was logged
 */
export function expectErrorLogged(messageMatch?: string | RegExp) {
  expect(mockLogger.error).toHaveBeenCalled();
  if (messageMatch) {
    const calls = mockLogger.error.mock.calls;
    const found = calls.some((call: unknown[]) => {
      const message = String(call[0]);
      return typeof messageMatch === 'string' 
        ? message.includes(messageMatch)
        : messageMatch.test(message);
    });
    expect(found).toBe(true);
  }
}

/**
 * Assert that a warning was logged
 */
export function expectWarningLogged(messageMatch?: string | RegExp) {
  expect(mockLogger.warn).toHaveBeenCalled();
  if (messageMatch) {
    const calls = mockLogger.warn.mock.calls;
    const found = calls.some((call: unknown[]) => {
      const message = String(call[0]);
      return typeof messageMatch === 'string' 
        ? message.includes(messageMatch)
        : messageMatch.test(message);
    });
    expect(found).toBe(true);
  }
}

/**
 * Assert that no errors were logged
 */
export function expectNoErrorsLogged() {
  expect(mockLogger.error).not.toHaveBeenCalled();
}

export default mockLogger;

