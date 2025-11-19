/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents repeated calls to failing services.
 * Protects the system from cascading failures.
 * 
 * States:
 * - CLOSED: Normal operation (all requests pass through)
 * - OPEN: Service is failing (requests rejected immediately)
 * - HALF_OPEN: Testing if service recovered (limited requests)
 * 
 * Usage:
 *   const breaker = new CircuitBreaker('gemini', {
 *     failureThreshold: 5,
 *     timeout: 60000,
 *     resetTimeout: 30000
 *   });
 *   
 *   try {
 *     const result = await breaker.execute(() => geminiService.generateImage(...));
 *   } catch (error) {
 *     // Handle error
 *   }
 */

const logger = require('./logger');

/**
 * Circuit breaker states
 */
const STATES = {
  CLOSED: 'CLOSED',      // Normal operation
  OPEN: 'OPEN',          // Service is failing
  HALF_OPEN: 'HALF_OPEN' // Testing recovery
};

/**
 * Circuit Breaker class
 */
class CircuitBreaker {
  /**
   * @param {string} name - Service name (for logging)
   * @param {Object} options - Configuration options
   * @param {number} options.failureThreshold - Number of failures before opening circuit (default: 5)
   * @param {number} options.timeout - Timeout for requests in ms (default: 30000)
   * @param {number} options.resetTimeout - Time to wait before half-open test (default: 60000)
   * @param {number} options.monitoringPeriod - Period for failure counting in ms (default: 60000)
   */
  constructor(name, options = {}) {
    this.name = name;
    this.state = STATES.CLOSED;
    
    // Configuration
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    
    // State tracking
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      stateChanges: 0
    };
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @param {any[]} args - Arguments to pass to function
   * @returns {Promise<any>} Function result
   * @throws {Error} If circuit is open or function fails
   */
  async execute(fn, ...args) {
    this.stats.totalRequests++;
    
    // Check if circuit should transition
    this._updateState();
    
    // Handle different states
    if (this.state === STATES.OPEN) {
      this.stats.totalFailures++;
      const error = new Error(`Circuit breaker is OPEN for ${this.name}. Service is unavailable.`);
      error.code = 'CIRCUIT_BREAKER_OPEN';
      error.service = this.name;
      error.nextAttemptTime = this.nextAttemptTime;
      
      logger.warn(`⚠️ Circuit breaker OPEN`, {
        service: this.name,
        nextAttemptTime: this.nextAttemptTime,
        failureCount: this.failureCount
      });
      
      throw error;
    }
    
    // Execute with timeout
    try {
      const result = await Promise.race([
        fn(...args),
        this._createTimeoutPromise()
      ]);
      
      // Success
      this._onSuccess();
      return result;
      
    } catch (error) {
      // Failure
      this._onFailure();
      throw error;
    }
  }

  /**
   * Update circuit breaker state based on current conditions
   * @private
   */
  _updateState() {
    const now = Date.now();
    
    switch (this.state) {
      case STATES.CLOSED:
        // Check if we should open (too many failures)
        if (this.failureCount >= this.failureThreshold) {
          this._transitionTo(STATES.OPEN);
          this.nextAttemptTime = now + this.resetTimeout;
          logger.warn(`🔴 Circuit breaker OPENED for ${this.name}`, {
            service: this.name,
            failureCount: this.failureCount,
            threshold: this.failureThreshold,
            nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
          });
        }
        break;
        
      case STATES.OPEN:
        // Check if we can attempt recovery (half-open test)
        if (now >= this.nextAttemptTime) {
          this._transitionTo(STATES.HALF_OPEN);
          this.failureCount = 0;
          this.successCount = 0;
          logger.info(`🟡 Circuit breaker HALF_OPEN for ${this.name} - testing recovery`, {
            service: this.name
          });
        }
        break;
        
      case STATES.HALF_OPEN:
        // Check if we recovered (success) or should reopen (failure)
        // Logic handled in _onSuccess/_onFailure
        break;
    }
  }

  /**
   * Handle successful execution
   * @private
   */
  _onSuccess() {
    this.stats.totalSuccesses++;
    
    if (this.state === STATES.HALF_OPEN) {
      // Success in half-open means service recovered
      this._transitionTo(STATES.CLOSED);
      logger.info(`🟢 Circuit breaker CLOSED for ${this.name} - service recovered`, {
        service: this.name
      });
    }
    
    // Reset failure count in CLOSED state (successful request)
    if (this.state === STATES.CLOSED) {
      this.failureCount = Math.max(0, this.failureCount - 1); // Gradual recovery
    }
  }

  /**
   * Handle failed execution
   * @private
   */
  _onFailure() {
    this.stats.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === STATES.HALF_OPEN) {
      // Failure in half-open means service still down
      this._transitionTo(STATES.OPEN);
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      logger.warn(`🔴 Circuit breaker REOPENED for ${this.name} - service still failing`, {
        service: this.name,
        nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
      });
    }
  }

  /**
   * Create timeout promise
   * @private
   */
  _createTimeoutPromise() {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`Request timeout for ${this.name} (${this.timeout}ms)`);
        error.code = 'REQUEST_TIMEOUT';
        error.service = this.name;
        error.timeout = this.timeout;
        reject(error);
      }, this.timeout);
    });
  }

  /**
   * Transition to new state
   * @private
   */
  _transitionTo(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.stats.stateChanges++;
      
      logger.debug(`Circuit breaker state transition: ${oldState} → ${newState}`, {
        service: this.name,
        oldState,
        newState
      });
    }
  }

  /**
   * Reset circuit breaker to CLOSED state
   */
  reset() {
    this._transitionTo(STATES.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    logger.info(`🔄 Circuit breaker RESET for ${this.name}`, {
      service: this.name
    });
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      stats: { ...this.stats }
    };
  }

  /**
   * Check if circuit is open (service unavailable)
   */
  isOpen() {
    this._updateState();
    return this.state === STATES.OPEN;
  }

  /**
   * Check if circuit is closed (service available)
   */
  isClosed() {
    this._updateState();
    return this.state === STATES.CLOSED;
  }
}

/**
 * Circuit Breaker Manager - manages multiple circuit breakers
 */
class CircuitBreakerManager {
  constructor() {
    this.breakers = new Map();
    this.defaultOptions = {
      failureThreshold: 5,
      timeout: 30000,
      resetTimeout: 60000
    };
  }

  /**
   * Get or create circuit breaker for service
   * @param {string} serviceName - Service name
   * @param {Object} options - Circuit breaker options
   * @returns {CircuitBreaker} Circuit breaker instance
   */
  getBreaker(serviceName, options = {}) {
    if (!this.breakers.has(serviceName)) {
      const breakerOptions = { ...this.defaultOptions, ...options };
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, breakerOptions));
    }
    return this.breakers.get(serviceName);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const [name, breaker] of this.breakers.entries()) {
      breaker.reset();
    }
    logger.info('🔄 All circuit breakers reset');
  }

  /**
   * Get statistics for all breakers
   */
  getStats() {
    const stats = {};
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.getState();
    }
    return stats;
  }
}

// Create singleton instance
const circuitBreakerManager = new CircuitBreakerManager();

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  circuitBreakerManager,
  STATES
};

