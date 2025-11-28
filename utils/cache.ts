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

import NodeCache from 'node-cache';
import logger from './logger';

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

/**
 * Cache statistics
 */
interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size?: number;
  keys?: number;
}

// Track cache statistics
const cacheStats: CacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0
};

/**
 * Generate cache key from parts
 * @param parts - Key parts to join
 * @returns Cache key
 */
export function generateKey(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(':');
}

/**
 * Get value from cache
 * @param key - Cache key
 * @returns Cached value or null if not found
 */
export function get<T = unknown>(key: string): T | null {
  const value = cache.get<T>(key);
  
  if (value !== undefined) {
    cacheStats.hits++;
    logger.debug('✅ Cache hit', { key: key.substring(0, 50) });
    return value;
  }
  
  cacheStats.misses++;
  logger.debug('❌ Cache miss', { key: key.substring(0, 50) });
  return null;
}

/**
 * Set value in cache
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttl - Time-to-live in seconds (optional, uses default if not provided)
 * @returns Success status
 */
export function set<T>(key: string, value: T, ttl: number | null = null): boolean {
  const success = cache.set(key, value, ttl || CACHE_CONFIG.stdTTL);
  
  if (success) {
    cacheStats.sets++;
    logger.debug('💾 Cache set', { 
      key: key.substring(0, 50),
      ttl: ttl || CACHE_CONFIG.stdTTL 
    });
  }
  
  return success;
}

/**
 * Delete value from cache
 * @param key - Cache key or array of keys
 * @returns Number of deleted keys
 */
export function del(key: string | string[]): number {
  const deleted = cache.del(key);
  
  if (deleted > 0) {
    cacheStats.deletes += deleted;
    logger.debug('🗑️ Cache deleted', { 
      key: Array.isArray(key) ? key.length : 1,
      deleted 
    });
  }
  
  return deleted;
}

/**
 * Check if key exists in cache
 * @param key - Cache key
 * @returns True if key exists
 */
export function has(key: string): boolean {
  return cache.has(key);
}

/**
 * Clear all cache entries
 */
export function clear(): void {
  cache.flushAll();
  cacheStats.deletes += cacheStats.sets; // Estimate
  logger.info('🧹 Cache cleared');
}

/**
 * Get cache statistics
 * @returns Cache statistics
 */
export function getStats(): CacheStats {
  const keys = cache.keys();
  return {
    ...cacheStats,
    size: keys.length,
    keys: keys.length
  };
}

/**
 * Key generator function type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KeyGenerator = (...args: any[]) => string;

/**
 * Wrap an async function with caching
 * @param fn - Async function to cache
 * @param keyGenerator - Function that generates cache key from function arguments
 * @param ttl - Time-to-live in seconds (optional)
 * @returns Cached function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrap<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  keyGenerator: KeyGenerator,
  ttl: number | null = null
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const key = keyGenerator(...args);
    
    // Try to get from cache
    const cached = get<Awaited<ReturnType<T>>>(key);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('⚠️ Cached function error (not cached)', {
        key: key.substring(0, 50),
        error: errorMessage
      });
      throw error;
    }
  }) as T;
}

/**
 * Invalidate cache entries by pattern
 * @param pattern - Pattern to match (uses startsWith)
 * @returns Number of deleted entries
 */
export function invalidatePattern(pattern: string): number {
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
export const CacheKeys = {
  // Contact lookups
  contact: (name: string): string => generateKey('contact', name.toLowerCase().trim()),
  allContacts: (): string => generateKey('contacts', 'all'),
  
  // Conversation history
  conversationHistory: (chatId: string, limit: number = 50): string => 
    generateKey('conversation', chatId, limit.toString()),
  
  // Authorization checks
  mediaAuthorization: (contactName: string): string => 
    generateKey('auth', 'media', contactName.toLowerCase().trim()),
  groupAuthorization: (contactName: string): string => 
    generateKey('auth', 'group', contactName.toLowerCase().trim()),
  voiceTranscriptionAuthorization: (contactName: string): string => 
    generateKey('auth', 'voice', contactName.toLowerCase().trim()),
  
  // Agent context
  agentContext: (chatId: string): string => generateKey('agent', 'context', chatId),
  
  // Last command (for retry)
  lastCommand: (chatId: string): string => generateKey('command', 'last', chatId),
  
  // Google Drive file analysis (per file)
  driveFileAnalysis: (fileId: string): string => generateKey('drive', 'analysis', fileId),
};

/**
 * Cache TTL presets (in seconds)
 */
export const CacheTTL = {
  SHORT: 60,        // 1 minute - for frequently changing data
  MEDIUM: 300,      // 5 minutes - default
  LONG: 1800,       // 30 minutes - for stable data
  VERY_LONG: 3600,  // 1 hour - for rarely changing data
} as const;

// Log cache statistics periodically (every 10 minutes)
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    const stats = getStats();
    if (stats.size && stats.size > 0 || stats.hits > 0 || stats.misses > 0) {
      logger.debug('📊 Cache statistics', stats);
    }
  }, 600000); // 10 minutes
}
