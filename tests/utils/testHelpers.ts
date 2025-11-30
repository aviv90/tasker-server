/**
 * Test Helpers
 * General utility functions for tests
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a random chat ID for testing
 */
export function generateChatId(): string {
  return `test_chat_${uuidv4()}`;
}

/**
 * Generate a random message ID for testing
 */
export function generateMessageId(): string {
  return `test_msg_${uuidv4()}`;
}

/**
 * Generate a random task ID for testing
 */
export function generateTaskId(): string {
  return uuidv4();
}

/**
 * Wait for a specified amount of time (useful for async tests)
 * Uses unref() to prevent keeping the process alive
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    // Unref the timer so it doesn't keep the process alive
    if (timer.unref) {
      timer.unref();
    }
  });
}

/**
 * Create a mock Express request object
 */
export function createMockRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    protocol: 'http',
    get: jest.fn((header: string) => {
      const headers: Record<string, string> = {
        'host': 'localhost:3000',
        ...overrides.headers as Record<string, string>
      };
      return headers[header.toLowerCase()] || '';
    }),
    ...overrides
  };
}

/**
 * Create a mock Express response object
 */
export function createMockResponse(): Record<string, unknown> {
  const res: Record<string, unknown> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis()
  };
  return res;
}

/**
 * Create a mock Express next function
 */
export function createMockNext(): jest.Mock {
  return jest.fn();
}

/**
 * Assert that a value is an error
 */
export function expectError(value: unknown): asserts value is Error {
  expect(value).toBeInstanceOf(Error);
}

/**
 * Assert that a promise rejects
 */
export async function expectRejection(
  promise: Promise<unknown>,
  errorMessage?: string | RegExp
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject, but it resolved');
  } catch (error) {
    if (errorMessage) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof errorMessage === 'string') {
        expect(message).toContain(errorMessage);
      } else {
        expect(message).toMatch(errorMessage);
      }
    }
  }
}

