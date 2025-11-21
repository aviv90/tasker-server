/**
 * Provider Fallback Utility
 * 
 * Shared utility for trying multiple providers/services with fallback logic.
 * Eliminates code duplication between creationTools.js and editingTools.js.
 * 
 * Follows DRY principle - Single Source of Truth for provider fallback pattern.
 */

const { formatProviderName } = require('../services/agent/utils/providerUtils');
const { sendToolAckMessage } = require('../services/agent/utils/ackUtils');
const { formatErrorMessage, formatProviderError } = require('./errorHandler');
const { getServices } = require('../services/agent/utils/serviceLoader');
const logger = require('./logger');
const { circuitBreakerManager } = require('./circuitBreaker');
const { TIME } = require('./constants');

/**
 * Provider Fallback Handler
 * Manages fallback logic for trying multiple providers/services
 */
class ProviderFallback {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.toolName - Tool name (e.g., 'create_image', 'edit_image')
   * @param {Array<string>} options.providersToTry - List of providers to try in order
   * @param {string|null} options.requestedProvider - User-requested provider (if any)
   * @param {Object} options.context - Agent context (with chatId, etc.)
   */
  constructor({ toolName, providersToTry, requestedProvider, context }) {
    this.toolName = toolName;
    this.providersToTry = providersToTry;
    this.requestedProvider = requestedProvider;
    this.context = context;
    this.errorStack = [];
    this.chatId = context?.chatId || null;
    
    // Get services once (reused for all attempts)
    const services = getServices();
    this.greenApiService = services.greenApiService;
    this.services = services;
  }

  /**
   * Try executing operation with each provider until one succeeds
   * @param {Function} tryProvider - Async function that takes (provider, services) and returns result
   * @param {Object} options - Additional options
   * @param {Function} [options.onSuccess] - Callback called on success (for custom result transformation)
   * @returns {Promise<Object>} - Result object with success/error
   */
  async tryWithFallback(tryProvider, options = {}) {
    const { onSuccess } = options;

    for (let idx = 0; idx < this.providersToTry.length; idx++) {
      const provider = this.providersToTry[idx];
      
      try {
        logger.debug(`🔄 [${this.toolName}] Trying provider: ${provider}`, { 
          toolName: this.toolName, 
          provider, 
          attempt: idx + 1,
          totalProviders: this.providersToTry.length 
        });

        // Check circuit breaker (skip if open)
        const breaker = circuitBreakerManager.getBreaker(`${provider}_${this.toolName}`, {
          failureThreshold: 5,
          timeout: TIME.CIRCUIT_BREAKER_TIMEOUT,
          resetTimeout: TIME.CIRCUIT_BREAKER_RESET
        });

        if (breaker.isOpen()) {
          const nextAttemptTime = breaker.getState().nextAttemptTime;
          logger.warn(`⛔ Circuit breaker OPEN for ${provider}`, {
            toolName: this.toolName,
            provider,
            nextAttemptTime: nextAttemptTime ? new Date(nextAttemptTime).toISOString() : null
          });
          await this._handleProviderError(provider, `Service ${formatProviderName(provider)} is temporarily unavailable (circuit breaker open)`);
          continue; // Skip this provider, try next
        }

        // Send Ack for fallback attempts (not the first one)
        if (idx > 0 && this.chatId) {
          // Get originalMessageId from context for quoting
          const quotedMessageId = this.context?.originalInput?.originalMessageId || null;
          await sendToolAckMessage(this.chatId, [{ 
            name: this.toolName, 
            args: { provider: provider, service: provider } 
          }], quotedMessageId);
        }

        // Try the provider with circuit breaker protection
        const result = await breaker.execute(async () => {
          return await tryProvider(provider, this.services);
        });

        // Handle text-only response (no image but text returned) - this is success, not error
        if (result?.textOnly) {
          // Text-only is a valid response, return it as success
          if (onSuccess) {
            return onSuccess(result, provider);
          }
          return result;
        }

        // Check if result has error
        if (result?.error) {
          await this._handleProviderError(provider, result.error);
          continue; // Try next provider
        }

        // Success! Apply custom transformation if provided
        if (onSuccess) {
          return onSuccess(result, provider);
        }

        return result;

      } catch (error) {
        // Check if it's a circuit breaker error (already logged)
        if (error.code === 'CIRCUIT_BREAKER_OPEN') {
          await this._handleProviderError(provider, error.message, error);
          continue; // Skip this provider
        }
        
        const errorMessage = error.message || 'Unknown error';
        await this._handleProviderError(provider, errorMessage, error);
      }
    }

    // All providers failed - build final error message
    return this._buildFinalError();
  }

  /**
   * Handle provider error - log, add to stack, send to user
   * @private
   */
  async _handleProviderError(provider, errorMessage, error = null) {
    const providerName = formatProviderName(provider);
    const message = errorMessage || 'שגיאה לא ידועה';
    
    this.errorStack.push({ provider: providerName, message });
    
    logger.warn(`❌ [${this.toolName}] ${providerName} failed: ${message}`, {
      toolName: this.toolName,
      provider: providerName,
      errorMessage: message,
      chatId: this.chatId
    });
    
    if (error) {
      logger.error(`❌ [${this.toolName}] ${providerName} threw error`, {
        toolName: this.toolName,
        provider: providerName,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        chatId: this.chatId
      });
    }

    // Send error message to user (only if we have chatId)
    if (this.chatId && this.greenApiService) {
      try {
        // Get originalMessageId from context for quoting
        const quotedMessageId = this.context?.originalInput?.originalMessageId || null;
        // Use formatProviderError to format error with provider name prefix
        const formattedError = formatProviderError(provider, message);
        await this.greenApiService.sendTextMessage(this.chatId, formattedError, quotedMessageId, 1000);
      } catch (sendError) {
        logger.error(`❌ Failed to send error message to user`, {
          toolName: this.toolName,
          chatId: this.chatId,
          error: sendError instanceof Error ? {
            message: sendError.message,
            stack: sendError.stack
          } : sendError
        });
      }
    }
  }

  /**
   * Build final error message after all providers failed
   * @private
   */
  _buildFinalError() {
    // If specific provider was requested, return single provider error
    if (this.requestedProvider) {
      const failure = this.errorStack[0];
      const providerName = formatProviderName(this.requestedProvider);
      
      // Format error with provider name prefix
      const errorMessage = formatProviderError(
        this.requestedProvider, 
        failure?.message || 'סיבה לא ידועה'
      );
      
      return {
        success: false,
        error: errorMessage,
        errorsAlreadySent: true // Flag to prevent duplicate error sending in agentLoop
      };
    }

    // All providers tried - build detailed error message
    const failureDetails = this.errorStack.length > 0
      ? this.errorStack.map(err => `• ${err.provider}: ${err.message}`).join('\n')
      : 'לא התקבלה תשובת שגיאה מהספקים.';

    // Build context-specific error message
    const operation = this.toolName.includes('create') ? 'יצירה' : 'עריכה';
    const assetType = this.toolName.includes('image') ? 'תמונה' : 
                     this.toolName.includes('video') ? 'וידאו' : 'משאב';

    return {
      success: false,
      error: `כל הספקים נכשלו ב${operation} ה${assetType}:\n${failureDetails}`,
      errorsAlreadySent: true // Flag to prevent duplicate error sending in agentLoop
    };
  }
}

module.exports = {
  ProviderFallback
};

