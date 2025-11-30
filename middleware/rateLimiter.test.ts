/**
 * Rate Limiter Tests
 * Unit tests for rate limiting middleware
 * 
 * Note: We mock express-rate-limit to avoid creating real timers
 * that would keep the process alive after tests complete.
 */

// Mock express-rate-limit BEFORE importing the module under test
jest.mock('express-rate-limit', () => {
  const mockMiddleware = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());
  return jest.fn(() => mockMiddleware);
});

// Mock logger
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Import AFTER mocks are set up
import { apiLimiter, whatsappLimiter, uploadLimiter, callbackLimiter, expensiveOperationLimiter } from './rateLimiter';

describe('rateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('apiLimiter', () => {
    it('should be defined', () => {
      expect(apiLimiter).toBeDefined();
    });

    it('should be a function (middleware)', () => {
      expect(typeof apiLimiter).toBe('function');
    });
  });

  describe('whatsappLimiter', () => {
    it('should be defined', () => {
      expect(whatsappLimiter).toBeDefined();
    });

    it('should be a function (middleware)', () => {
      expect(typeof whatsappLimiter).toBe('function');
    });
  });

  describe('uploadLimiter', () => {
    it('should be defined', () => {
      expect(uploadLimiter).toBeDefined();
    });

    it('should be a function (middleware)', () => {
      expect(typeof uploadLimiter).toBe('function');
    });
  });

  describe('callbackLimiter', () => {
    it('should be defined', () => {
      expect(callbackLimiter).toBeDefined();
    });

    it('should be a function (middleware)', () => {
      expect(typeof callbackLimiter).toBe('function');
    });
  });

  describe('expensiveOperationLimiter', () => {
    it('should be defined', () => {
      expect(expensiveOperationLimiter).toBeDefined();
    });

    it('should be a function (middleware)', () => {
      expect(typeof expensiveOperationLimiter).toBe('function');
    });
  });
});

