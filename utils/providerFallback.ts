/**
 * Provider Fallback Utility
 * 
 * Shared utility for trying multiple providers/services with fallback logic.
 * Eliminates code duplication between creationTools.ts and editingTools.ts.
 * 
 * Follows DRY principle - Single Source of Truth for provider fallback pattern.
 */

import { formatProviderName } from '../services/agent/utils/providerUtils';
import { sendToolAckMessage } from '../services/agent/utils/ackUtils';
import { formatProviderError } from './errorHandler';
import { getServices } from '../services/agent/utils/serviceLoader';
import logger from './logger';
import { circuitBreakerManager } from './circuitBreaker';
import { TIME } from './constants';

import { AgentContextState } from '../services/agent/types';

/**
 * Provider fallback options
 */
export interface ProviderFallbackOptions {
  toolName: string;
  providersToTry: string[];
  requestedProvider: string | null;
  context: AgentContextState;
}

/**
 * Provider try function type
 */
export type ProviderTryFunction = (provider: string, services: ReturnType<typeof getServices>) => Promise<unknown>;

/**
 * Provider fallback options for tryWithFallback
 */
export interface TryWithFallbackOptions {
  onSuccess?: <T>(result: T, provider: string) => T | Promise<T>;
}

/**
 * Provider error entry
 */
interface ProviderError {
  provider: string;
  message: string;
}

/**
 * Provider result structure
 */
export interface ProviderResult {
  success?: boolean;
  error?: string;
  textOnly?: boolean;
  errorsAlreadySent?: boolean;
  [key: string]: unknown;
}

/**
 * Provider Fallback Handler
 * Manages fallback logic for trying multiple providers/services
 */
export class ProviderFallback {
  private toolName: string;
  private providersToTry: string[];
  private requestedProvider: string | null;
  private context: AgentContextState;
  private errorStack: ProviderError[];
  private chatId: string | null;
  private greenApiService: ReturnType<typeof getServices>['greenApiService'];
  private services: ReturnType<typeof getServices>;
  private timeout: number;

  /**
   * @param options - Configuration options
   * @param options.toolName - Tool name (e.g., 'create_image', 'edit_image')
   * @param options.providersToTry - List of providers to try in order
   * @param options.requestedProvider - User-requested provider (if any)
   * @param options.context - Agent context (with chatId, etc.)
   * @param options.timeout - Custom timeout for circuit breaker (optional)
   */
  constructor({ toolName, providersToTry, requestedProvider, context, timeout }: ProviderFallbackOptions & { timeout?: number }) {
    this.toolName = toolName;
    this.providersToTry = providersToTry;
    this.requestedProvider = requestedProvider;
    this.context = context;
    this.errorStack = [];
    this.chatId = context?.chatId || null;
    this.timeout = timeout || TIME.CIRCUIT_BREAKER_TIMEOUT;

    // Get services once (reused for all attempts)
    const services = getServices();
    this.greenApiService = services.greenApiService;
    this.services = services;
  }

  /**
   * Try executing operation with each provider until one succeeds
   * @param tryProvider - Async function that takes (provider, services) and returns result
   * @param options - Additional options
   * @param options.onSuccess - Callback called on success (for custom result transformation)
   * @returns Result object with success/error
   */
  async tryWithFallback<T = unknown>(
    tryProvider: ProviderTryFunction,
    options: TryWithFallbackOptions = {}
  ): Promise<ProviderResult | (ProviderResult & T)> {
    const { onSuccess } = options;

    for (let idx = 0; idx < this.providersToTry.length; idx++) {
      const provider = this.providersToTry[idx];

      if (!provider) {
        continue; // Skip empty providers
      }

      try {
        logger.debug(`🔄 [${this.toolName}] Trying provider: ${provider}`, {
          toolName: this.toolName,
          provider,
          attempt: idx + 1,
          totalProviders: this.providersToTry.length,
          timeout: this.timeout
        });

        // Check circuit breaker (skip if open)
        const breaker = circuitBreakerManager.getBreaker(`${provider}_${this.toolName}`, {
          failureThreshold: 5,
          timeout: this.timeout, // Use custom timeout
          resetTimeout: TIME.CIRCUIT_BREAKER_RESET
        });

        if (breaker.isOpen()) {
          const nextAttemptTime = breaker.getState().nextAttemptTime;
          logger.warn(`⛔ Circuit breaker OPEN for ${provider}`, {
            toolName: this.toolName,
            provider,
            nextAttemptTime: nextAttemptTime ? new Date(nextAttemptTime).toISOString() : null
          });
          const providerName = formatProviderName(provider);
          await this._handleProviderError(provider, `Service ${providerName} is temporarily unavailable (circuit breaker open)`);
          continue; // Skip this provider, try next
        }

        // Send Ack for fallback attempts (not the first one)
        if (idx > 0 && this.chatId) {
          // Get originalMessageId from context for quoting
          const quotedMessageId = this.context?.originalInput?.originalMessageId || null;
          // Check if audio was already transcribed (skip ACK for transcribe_audio)
          const skipToolsAck: string[] = [];
          if (this.context?.originalInput?.audioAlreadyTranscribed) {
            skipToolsAck.push('transcribe_audio');
          }
          await sendToolAckMessage(this.chatId, [{
            name: this.toolName,
            args: { provider: provider, service: provider }
          }], { quotedMessageId, skipToolsAck });
        }

        // Try the provider with circuit breaker protection
        const result = (await breaker.execute(async () => {
          return await tryProvider(provider, this.services);
        })) as ProviderResult & Partial<T>;

        // Handle text-only response (no image but text returned) - this is success, not error
        if (result?.textOnly) {
          // Text-only is a valid response, return it as success
          if (onSuccess) {
            return onSuccess(result as T, provider) as ProviderResult | (ProviderResult & T);
          }
          return result as ProviderResult | (ProviderResult & T);
        }

        // Check if result has error
        if (result?.error && typeof result.error === 'string') {
          await this._handleProviderError(provider, result.error);
          continue; // Try next provider
        }

        // Success! Apply custom transformation if provided
        if (onSuccess) {
          return onSuccess(result as T, provider) as ProviderResult | (ProviderResult & T);
        }

        return result as ProviderResult | (ProviderResult & T);

      } catch (error: unknown) {
        // Check if it's a circuit breaker error (already logged)
        const errorObj = error as Error & { code?: string; message?: string };
        if (errorObj.code === 'CIRCUIT_BREAKER_OPEN') {
          const errorMessage = errorObj.message || 'Circuit breaker is open';
          await this._handleProviderError(provider, errorMessage, error);
          continue; // Skip this provider
        }

        const errorMessage = (errorObj.message && typeof errorObj.message === 'string') ? errorObj.message : 'Unknown error';
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
  private async _handleProviderError(provider: string, errorMessage: string, error: unknown = null): Promise<void> {
    if (!provider || !errorMessage) return; // Skip if provider or message is empty

    const providerName = formatProviderName(provider) || provider;
    const message = errorMessage;

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
    // DISABLED: To prevent duplicate error messages during fallback (e.g. Gemini failed -> OpenAI failed -> Final Error).
    // We strictly want to notify only if ALL failed or if it's the final result.
    /*
    if (this.chatId && this.greenApiService) {
      try {
        // Get originalMessageId from context for quoting
        const quotedMessageId = this.context?.originalInput?.originalMessageId || null;
        // Use formatProviderError to format error with provider name prefix
        const formattedError = formatProviderError(provider, message);
        if (this.chatId) {
          await this.greenApiService.sendTextMessage(this.chatId, formattedError, quotedMessageId || undefined, 1000);
        }
      } catch (sendError: unknown) {
        logger.error('❌ Failed to send error message to user', {
          toolName: this.toolName,
          chatId: this.chatId,
          error: sendError instanceof Error ? {
            message: sendError.message,
            stack: sendError.stack
          } : sendError
        });
      }
    }
    */
  }

  /**
   * Build final error message after all providers failed
   * @private
   */
  private _buildFinalError(): ProviderResult {
    // If specific provider was requested, return single provider error
    if (this.requestedProvider) {
      const failure = this.errorStack[0];
      const failureMessage = failure?.message || 'סיבה לא ידועה';

      // Format error with provider name prefix
      const errorMessage = formatProviderError(
        this.requestedProvider,
        failureMessage
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

