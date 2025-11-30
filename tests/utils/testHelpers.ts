/**
 * Test Helpers
 * General utility functions for tests
 * 
 * Best practices:
 * - Use these helpers for consistent test data generation
 * - All IDs are prefixed with 'test_' for easy identification
 * - Timers use unref() to prevent keeping the process alive
 */

import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

// ============================================================================
// ID Generators
// ============================================================================

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
  return `test_task_${uuidv4()}`;
}

/**
 * Generate a random user ID for testing
 */
export function generateUserId(): string {
  return `test_user_${uuidv4()}`;
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Wait for a specified amount of time
 * Uses unref() to prevent keeping the process alive
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });
}

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await wait(interval);
  }
  
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

// ============================================================================
// Express Mock Helpers
// ============================================================================

/**
 * Create a mock Express request object with proper typing
 */
export function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    protocol: 'http',
    method: 'GET',
    path: '/',
    get: jest.fn((header: string) => {
      const headers: Record<string, string> = {
        'host': 'localhost:3000',
        'content-type': 'application/json',
        ...(overrides.headers as Record<string, string> || {})
      };
      return headers[header.toLowerCase()] || '';
    }),
    ...overrides
  };
}

/**
 * Create a mock Express response object with proper typing
 */
export function createMockResponse(): Partial<Response> & {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
  setHeader: jest.Mock;
  end: jest.Mock;
  _getData: () => unknown;
  _getStatusCode: () => number;
} {
  let data: unknown = null;
  let statusCode = 200;

  const res = {
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((body: unknown) => {
      data = body;
      return res;
    }),
    send: jest.fn().mockImplementation((body: unknown) => {
      data = body;
      return res;
    }),
    setHeader: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    // Helper methods for assertions
    _getData: () => data,
    _getStatusCode: () => statusCode
  };
  
  return res;
}

/**
 * Create a mock Express next function
 */
export function createMockNext(): jest.Mock<void, [unknown?]> {
  return jest.fn() as jest.Mock<void, [unknown?]>;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a value is an Error
 */
export function expectError(value: unknown): asserts value is Error {
  expect(value).toBeInstanceOf(Error);
}

/**
 * Assert that a promise rejects with optional message check
 */
export async function expectRejection(
  promise: Promise<unknown>,
  errorMessage?: string | RegExp
): Promise<Error> {
  let error: Error | undefined;
  
  try {
    await promise;
    fail('Expected promise to reject, but it resolved');
  } catch (e) {
    error = e as Error;
    if (errorMessage) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof errorMessage === 'string') {
        expect(message).toContain(errorMessage);
      } else {
        expect(message).toMatch(errorMessage);
      }
    }
  }
  
  return error!;
}

/**
 * Assert that a function throws with optional message check
 */
export function expectThrows(
  fn: () => unknown,
  errorMessage?: string | RegExp
): Error {
  let error: Error | undefined;
  
  try {
    fn();
    fail('Expected function to throw, but it did not');
  } catch (e) {
    error = e as Error;
    if (errorMessage) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof errorMessage === 'string') {
        expect(message).toContain(errorMessage);
      } else {
        expect(message).toMatch(errorMessage);
      }
    }
  }
  
  return error!;
}

// ============================================================================
// Test Data Utilities
// ============================================================================

/**
 * Create a deep copy of an object (useful for test isolation)
 */
export function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Create a buffer with random data
 */
export function createRandomBuffer(size: number): Buffer {
  return Buffer.alloc(size, Math.floor(Math.random() * 256));
}

/**
 * Create a mock file buffer (for image/video tests)
 */
export function createMockFileBuffer(type: 'image' | 'video' | 'audio'): Buffer {
  const headers: Record<string, number[]> = {
    image: [0x89, 0x50, 0x4E, 0x47], // PNG header
    video: [0x00, 0x00, 0x00, 0x18], // MP4 header (partial)
    audio: [0x49, 0x44, 0x33]        // MP3/ID3 header
  };
  
  const header = Buffer.from(headers[type] || []);
  const data = createRandomBuffer(1000);
  return Buffer.concat([header, data]);
}
