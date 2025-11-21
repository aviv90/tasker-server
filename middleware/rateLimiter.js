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

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const logger = require('../utils/logger');
const { config } = require('../config');

/**
 * Key generator for rate limiting (by IP or custom identifier)
 * Uses ipKeyGenerator helper for proper IPv6 support
 */
function generateKey(req) {
  // For WhatsApp webhook, try to use chatId if available
  if (req.body?.sender?.chatId) {
    return `whatsapp:${req.body.sender.chatId}`;
  }
  
  // For authenticated requests, use user ID if available
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  
  // Fallback to IP address using ipKeyGenerator for proper IPv6 support
  return ipKeyGenerator(req);
}

/**
 * Standard rate limiter for API endpoints
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.features.rateLimit?.api?.max || 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'יותר מדי בקשות. נסה שוב בעוד כמה דקות.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: generateKey,
  handler: (req, res) => {
    logger.warn('⚠️ Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: 'יותר מדי בקשות. נסה שוב בעוד כמה דקות.',
      retryAfter: 15 * 60
    });
  }
});

/**
 * Strict rate limiter for WhatsApp webhook (higher limit - legitimate traffic)
 */
const whatsappLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: config.features.rateLimit?.whatsapp?.max || 200, // 200 requests per minute
  message: {
    error: 'יותר מדי בקשות מ-WhatsApp. נסה שוב בעוד דקה.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: (req, res) => {
    logger.warn('⚠️ WhatsApp rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      chatId: req.body?.sender?.chatId
    });
    
    res.status(429).json({
      error: 'יותר מדי בקשות מ-WhatsApp. נסה שוב בעוד דקה.',
      retryAfter: 60
    });
  }
});

/**
 * Upload rate limiter (medium limit - resource-intensive operations)
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.features.rateLimit?.upload?.max || 20, // 20 uploads per 15 minutes
  message: {
    error: 'יותר מדי העלאות. נסה שוב בעוד כמה דקות.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: (req, res) => {
    logger.warn('⚠️ Upload rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: 'יותר מדי העלאות. נסה שוב בעוד כמה דקות.',
      retryAfter: 15 * 60
    });
  }
});

/**
 * Callback rate limiter (lower limit - expected from external services)
 */
const callbackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: config.features.rateLimit?.callback?.max || 50, // 50 callbacks per minute
  message: {
    error: 'יותר מדי callbacks. נסה שוב בעוד דקה.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use origin IP or service identifier
    const origin = req.get('origin');
    if (origin) {
      return origin;
    }
    // Fallback to generateKey which uses ipKeyGenerator for IPv6 support
    return generateKey(req);
  },
  handler: (req, res) => {
    logger.warn('⚠️ Callback rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      origin: req.get('origin')
    });
    
    res.status(429).json({
      error: 'יותר מדי callbacks. נסה שוב בעוד דקה.',
      retryAfter: 60
    });
  }
});

/**
 * Strict rate limiter for expensive operations (AI generation, etc.)
 */
const expensiveOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.features.rateLimit?.expensive?.max || 30, // 30 expensive operations per hour
  message: {
    error: 'יותר מדי פעולות יקרות. נסה שוב בעוד שעה.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: (req, res) => {
    logger.warn('⚠️ Expensive operation rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: 'יותר מדי פעולות יקרות. נסה שוב בעוד שעה.',
      retryAfter: 60 * 60
    });
  }
});

module.exports = {
  apiLimiter,
  whatsappLimiter,
  uploadLimiter,
  callbackLimiter,
  expensiveOperationLimiter
};
