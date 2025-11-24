/**
 * Rate Limiting Middleware
 * 
 * Protects API endpoints from abuse and overload.
 * Uses express-rate-limit with different limits for different endpoints.
 * 
 * Rate limits are configured per endpoint type:
 * - WhatsApp webhook: Higher limit (legitimate use)
 * - Upload endpoints: Medium limit (resource-intensive)
 * - API endpoints: Standard limit
 * - Callback endpoints: Lower limit (expected from external services)
 */

import rateLimit, { RateLimitRequestHandler, ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';
import logger from '../utils/logger';
import { config } from '../config';
import { TIME } from '../utils/constants';

/**
 * Request body structure for WhatsApp webhook
 */
interface WhatsAppRequestBody {
  sender?: {
    chatId?: string;
  };
}

/**
 * Extended Request type with optional user property
 */
interface AuthenticatedRequest extends Request {
  user?: {
    id?: string;
  };
}

/**
 * Rate limit configuration constants
 * Uses TIME constants for consistency and maintainability
 */
const RATE_LIMIT_CONFIG = {
  API: {
    windowMs: 15 * TIME.MINUTE,
    defaultMax: 100
  },
  WHATSAPP: {
    windowMs: TIME.MINUTE,
    defaultMax: 200
  },
  UPLOAD: {
    windowMs: 15 * TIME.MINUTE,
    defaultMax: 20
  },
  CALLBACK: {
    windowMs: TIME.MINUTE,
    defaultMax: 50
  },
  EXPENSIVE: {
    windowMs: TIME.HOUR,
    defaultMax: 30
  }
} as const;

/**
 * Key generator for rate limiting (by IP or custom identifier)
 * Prioritizes chatId/userId over IP for better rate limiting accuracy
 * Uses ipKeyGenerator helper for proper IPv6 support
 */
function generateKey(req: Request): string {
  const body = req.body as WhatsAppRequestBody;
  
  // For WhatsApp webhook, try to use chatId if available
  if (body?.sender?.chatId) {
    return `whatsapp:${body.sender.chatId}`;
  }
  
  // For authenticated requests, use user ID if available
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.id) {
    return `user:${authReq.user.id}`;
  }
  
  // Fallback to IP address using ipKeyGenerator helper for IPv6 support
  // ipKeyGenerator takes an IP string, not the request object
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
}

/**
 * Creates a standardized rate limit handler
 * @param errorMessage - Error message in Hebrew
 * @param retryAfterSeconds - Retry after time in seconds
 * @param logMessage - Log message prefix
 */
function createRateLimitHandler(
  errorMessage: string,
  retryAfterSeconds: number,
  logMessage: string
) {
  return (req: Request, res: Response): void => {
    logger.warn(`⚠️ ${logMessage}`, {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: errorMessage,
      retryAfter: retryAfterSeconds
    });
  };
}

/**
 * Standard rate limiter for API endpoints
 */
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.API.windowMs,
  max: config.features.rateLimit?.api?.max || RATE_LIMIT_CONFIG.API.defaultMax,
  message: {
    error: 'יותר מדי בקשות. נסה שוב בעוד כמה דקות.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: generateKey,
  handler: createRateLimitHandler(
    'יותר מדי בקשות. נסה שוב בעוד כמה דקות.',
    RATE_LIMIT_CONFIG.API.windowMs / TIME.SECOND,
    'Rate limit exceeded'
  )
});

/**
 * Strict rate limiter for WhatsApp webhook (higher limit - legitimate traffic)
 */
export const whatsappLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.WHATSAPP.windowMs,
  max: config.features.rateLimit?.whatsapp?.max || RATE_LIMIT_CONFIG.WHATSAPP.defaultMax,
  message: {
    error: 'יותר מדי בקשות מ-WhatsApp. נסה שוב בעוד דקה.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: (req: Request, res: Response): void => {
    const body = req.body as WhatsAppRequestBody;
    logger.warn('⚠️ WhatsApp rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      chatId: body?.sender?.chatId
    });
    
    res.status(429).json({
      error: 'יותר מדי בקשות מ-WhatsApp. נסה שוב בעוד דקה.',
      retryAfter: RATE_LIMIT_CONFIG.WHATSAPP.windowMs / TIME.SECOND
    });
  }
});

/**
 * Upload rate limiter (medium limit - resource-intensive operations)
 */
export const uploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.UPLOAD.windowMs,
  max: config.features.rateLimit?.upload?.max || RATE_LIMIT_CONFIG.UPLOAD.defaultMax,
  message: {
    error: 'יותר מדי העלאות. נסה שוב בעוד כמה דקות.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: createRateLimitHandler(
    'יותר מדי העלאות. נסה שוב בעוד כמה דקות.',
    RATE_LIMIT_CONFIG.UPLOAD.windowMs / TIME.SECOND,
    'Upload rate limit exceeded'
  )
});

/**
 * Callback rate limiter (lower limit - expected from external services)
 */
export const callbackLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.CALLBACK.windowMs,
  max: config.features.rateLimit?.callback?.max || RATE_LIMIT_CONFIG.CALLBACK.defaultMax,
  message: {
    error: 'יותר מדי callbacks. נסה שוב בעוד דקה.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Use origin IP or service identifier for better identification
    const origin = req.get('origin');
    if (origin) {
      return origin;
    }
    // Fallback to IP using ipKeyGenerator helper for IPv6 support
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return ipKeyGenerator(ip);
  },
  handler: (req: Request, res: Response): void => {
    logger.warn('⚠️ Callback rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      origin: req.get('origin')
    });
    
    res.status(429).json({
      error: 'יותר מדי callbacks. נסה שוב בעוד דקה.',
      retryAfter: RATE_LIMIT_CONFIG.CALLBACK.windowMs / TIME.SECOND
    });
  }
});

/**
 * Strict rate limiter for expensive operations (AI generation, etc.)
 */
export const expensiveOperationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.EXPENSIVE.windowMs,
  max: config.features.rateLimit?.expensive?.max || RATE_LIMIT_CONFIG.EXPENSIVE.defaultMax,
  message: {
    error: 'יותר מדי פעולות יקרות. נסה שוב בעוד שעה.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: createRateLimitHandler(
    'יותר מדי פעולות יקרות. נסה שוב בעוד שעה.',
    RATE_LIMIT_CONFIG.EXPENSIVE.windowMs / TIME.SECOND,
    'Expensive operation rate limit exceeded'
  )
});

// Backward compatibility: CommonJS export
module.exports = {
  apiLimiter,
  whatsappLimiter,
  uploadLimiter,
  callbackLimiter,
  expensiveOperationLimiter
};

