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
const { formatErrorMessage } = require('./errorHandler');
const { getServices } = require('../services/agent/utils/serviceLoader');

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
        console.log(`🔄 [${this.toolName}] Trying provider: ${provider}`);

        // Send Ack for fallback attempts (not the first one)
        if (idx > 0 && this.chatId) {
          await sendToolAckMessage(this.chatId, [{ 
            name: this.toolName, 
            args: { provider: provider, service: provider } 
          }]);
        }

        // Try the provider
        const result = await tryProvider(provider, this.services);

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
    const message = errorMessage || `שגיאה עם ${providerName}`;
    
    this.errorStack.push({ provider: providerName, message });
    
    console.warn(`❌ [${this.toolName}] ${providerName} failed: ${message}`);
    
    if (error) {
      console.error(`❌ [${this.toolName}] ${providerName} threw error:`, error);
    }

    // Send error message to user (only if we have chatId)
    if (this.chatId && this.greenApiService) {
      try {
        await this.greenApiService.sendTextMessage(this.chatId, formatErrorMessage(message));
      } catch (sendError) {
        console.error(`❌ Failed to send error message to user:`, sendError);
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
      
      return {
        success: false,
        error: `שגיאה עם ${failure?.provider || providerName}: ${failure?.message || 'סיבה לא ידועה'}`
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
      error: `כל הספקים נכשלו ב${operation} ה${assetType}:\n${failureDetails}`
    };
  }
}

module.exports = {
  ProviderFallback
};

