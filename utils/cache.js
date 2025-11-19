/**
 * Caching Utility
 * 
 * In-memory caching using node-cache for expensive operations.
 * Implements TTL (Time-To-Live) and automatic cleanup.
 * 
 * Use cases:
 * - Contact lookups (fuzzy matching is expensive)
 * - Conversation history (avoid repeated DB queries)
 * - Authorization checks (stable within session)
 * - API responses that don't change frequently
 * 
 * Benefits:
 * - Faster response times for repeated operations
 * - Reduced database load
 * - Reduced API calls to external services
 */

const NodeCache = require('node-cache');
const logger = require('./logger');

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  // Standard TTL (Time-To-Live) in seconds
  stdTTL: 300, // 5 minutes default
  
  // Check for expired keys every 60 seconds
  checkperiod: 60,
  
  // Use object cloning to avoid reference issues
  useClones: true,
  
  // Delete expired keys automatically
  deleteOnExpire: true,
};

// Create cache instance
const cache = new NodeCache(CACHE_CONFIG);

// Track cache statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0
};

/**
 * Generate cache key from parts
 * @param {...string} parts - Key parts to join
 * @returns {string} Cache key
 */
function generateKey(...parts) {
  return parts.filter(Boolean).join(':');
}

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {any|null} Cached value or null if not found
 */
function get(key) {
  const value = cache.get(key);
  
  if (value !== undefined) {
    cacheStats.hits++;
    logger.debug(`✅ Cache hit`, { key: key.substring(0, 50) });
    return value;
  }
  
  cacheStats.misses++;
  logger.debug(`❌ Cache miss`, { key: key.substring(0, 50) });
  return null;
}

/**
 * Set value in cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} [ttl] - Time-to-live in seconds (optional, uses default if not provided)
 * @returns {boolean} Success status
 */
function set(key, value, ttl = null) {
  const success = cache.set(key, value, ttl || CACHE_CONFIG.stdTTL);
  
  if (success) {
    cacheStats.sets++;
    logger.debug(`💾 Cache set`, { 
      key: key.substring(0, 50),
      ttl: ttl || CACHE_CONFIG.stdTTL 
    });
  }
  
  return success;
}

/**
 * Delete value from cache
 * @param {string} key - Cache key or array of keys
 * @returns {number} Number of deleted keys
 */
function del(key) {
  const deleted = cache.del(key);
  
  if (deleted > 0) {
    cacheStats.deletes += deleted;
    logger.debug(`🗑️ Cache deleted`, { 
      key: Array.isArray(key) ? key.length : 1,
      deleted 
    });
  }
  
  return deleted;
}

/**
 * Check if key exists in cache
 * @param {string} key - Cache key
 * @returns {boolean} True if key exists
 */
function has(key) {
  return cache.has(key);
}

/**
 * Clear all cache entries
 */
function clear() {
  cache.flushAll();
  cacheStats.deletes += cacheStats.sets; // Estimate
  logger.info('🧹 Cache cleared');
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
function getStats() {
  const keys = cache.keys();
  return {
    ...cacheStats,
    size: keys.length,
    keys: keys.length
  };
}

/**
 * Wrap an async function with caching
 * @param {Function} fn - Async function to cache
 * @param {Function} keyGenerator - Function that generates cache key from function arguments
 * @param {number} [ttl] - Time-to-live in seconds (optional)
 * @returns {Function} Cached function
 */
function wrap(fn, keyGenerator, ttl = null) {
  return async (...args) => {
    const key = keyGenerator(...args);
    
    // Try to get from cache
    const cached = get(key);
    if (cached !== null) {
      return cached;
    }
    
    // Execute function and cache result
    try {
      const result = await fn(...args);
      set(key, result, ttl);
      return result;
    } catch (error) {
      // Don't cache errors
      logger.warn(`⚠️ Cached function error (not cached)`, {
        key: key.substring(0, 50),
        error: error.message
      });
      throw error;
    }
  };
}

/**
 * Invalidate cache entries by pattern
 * @param {string} pattern - Pattern to match (uses startsWith)
 * @returns {number} Number of deleted entries
 */
function invalidatePattern(pattern) {
  const keys = cache.keys();
  const matchingKeys = keys.filter(key => key.startsWith(pattern));
  
  if (matchingKeys.length > 0) {
    return del(matchingKeys);
  }
  
  return 0;
}

/**
 * Predefined cache keys for common operations
 */
const CacheKeys = {
  // Contact lookups
  contact: (name) => generateKey('contact', name.toLowerCase().trim()),
  allContacts: () => generateKey('contacts', 'all'),
  
  // Conversation history
  conversationHistory: (chatId, limit = 50) => 
    generateKey('conversation', chatId, limit.toString()),
  
  // Authorization checks
  mediaAuthorization: (contactName) => 
    generateKey('auth', 'media', contactName.toLowerCase().trim()),
  groupAuthorization: (contactName) => 
    generateKey('auth', 'group', contactName.toLowerCase().trim()),
  voiceTranscriptionAuthorization: (contactName) => 
    generateKey('auth', 'voice', contactName.toLowerCase().trim()),
  
  // Agent context
  agentContext: (chatId) => generateKey('agent', 'context', chatId),
  
  // Last command (for retry)
  lastCommand: (chatId) => generateKey('command', 'last', chatId),
};

/**
 * Cache TTL presets (in seconds)
 */
const CacheTTL = {
  SHORT: 60,        // 1 minute - for frequently changing data
  MEDIUM: 300,      // 5 minutes - default
  LONG: 1800,       // 30 minutes - for stable data
  VERY_LONG: 3600,  // 1 hour - for rarely changing data
};

// Log cache statistics periodically (every 10 minutes)
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    const stats = getStats();
    if (stats.size > 0 || stats.hits > 0 || stats.misses > 0) {
      logger.debug('📊 Cache statistics', stats);
    }
  }, 600000); // 10 minutes
}

module.exports = {
  get,
  set,
  del,
  has,
  clear,
  getStats,
  wrap,
  invalidatePattern,
  CacheKeys,
  CacheTTL,
  generateKey
};

