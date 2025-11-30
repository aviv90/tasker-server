/**
 * Last commands management (for retry functionality)
 * 
 * Persistent storage for commands in DB (replaces in-memory messageTypeCache).
 * Supports both single-step and multi-step commands.
 */

import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';
import { commandSchema } from '../../schemas/command.schema';
import CommandsRepository from '../../repositories/commandsRepository';

/**
 * Command metadata structure
 */
export interface CommandMetadata {
  tool?: string | null;
  toolArgs?: unknown;
  args?: unknown;
  plan?: unknown;
  isMultiStep?: boolean;
  prompt?: string | null;
  result?: unknown;
  failed?: boolean;
  normalized?: unknown;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
}

/**
 * Last command result structure
 */
interface LastCommandResult {
  messageId: string;
  tool: string | null;
  toolArgs: unknown;
  args: unknown;
  plan: unknown;
  isMultiStep: boolean;
  prompt: string | null;
  result: unknown;
  failed: boolean;
  normalized: unknown;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  timestamp: number;
}

/**
 * Options for saving last command
 */
export interface SaveLastCommandOptions {
  prompt?: string;
  normalized?: unknown;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
}

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  [key: string]: unknown;
}

class CommandsManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;
  private repository: CommandsRepository | null;

  constructor(conversationManager: ConversationManager, repository: CommandsRepository | null) {
    this._conversationManager = conversationManager;
    this.repository = repository;
  }

  /**
   * Save command for retry functionality
   * @param chatId - Chat ID
   * @param messageId - Message ID from Green API
   * @param metadata - Command metadata (tool, toolArgs, plan, prompt, etc.)
   */
  async saveCommand(chatId: string, messageId: string, metadata: CommandMetadata): Promise<void> {
    if (!chatId || !messageId) return;

    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save command');
      return;
    }

    try {
      const timestamp = Date.now();
      const commandData = {
        chatId,
        messageId,
        timestamp,
        ...metadata
      };

      // Clean data before validation - remove any Zod-specific properties
      const cleanedData = JSON.parse(JSON.stringify(commandData)) as typeof commandData;

      // Validate data with safeParse to avoid throwing errors
      const validationResult = commandSchema.safeParse(cleanedData);

      if (!validationResult.success) {
        logger.warn('⚠️ Command validation failed, saving anyway:', {
          errors: validationResult.error.issues,
          chatId,
          messageId
        });
        // Save anyway with original data (validation is not critical)
        await this.repository.save(commandData as Parameters<CommandsRepository['save']>[0]);
      } else {
        await this.repository.save(validationResult.data as Parameters<CommandsRepository['save']>[0]);
      }

      logger.debug(`💾 [Commands] Saved command ${messageId} for retry in ${chatId}: ${metadata.tool || 'unknown'}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('❌ Error saving command:', { error: errorMessage, chatId, messageId, stack: errorStack });
    }
  }

  /**
   * Save last command for retry functionality (backward compatibility)
   * @deprecated Use saveCommand() instead
   */
  async saveLastCommand(
    chatId: string,
    tool: string,
    args: unknown,
    options: SaveLastCommandOptions = {}
  ): Promise<void> {
    logger.warn('⚠️ [DEPRECATED] saveLastCommand() is deprecated. Use saveCommand() instead.');

    // For backward compatibility, create a messageId from timestamp
    const messageId = `legacy_${Date.now()}`;
    await this.saveCommand(chatId, messageId, {
      tool,
      toolArgs: args,
      args: args,
      prompt: options.prompt || '',
      normalized: options.normalized,
      imageUrl: options.imageUrl,
      videoUrl: options.videoUrl,
      audioUrl: options.audioUrl
    });
  }

  /**
   * Get last command for retry functionality
   * @param chatId - Chat ID
   * @returns Last command metadata or null
   */
  async getLastCommand(chatId: string): Promise<LastCommandResult | null> {
    if (!chatId) return null;

    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get last command');
      return null;
    }

    try {
      const row = await this.repository.findLastByChatId(chatId);

      if (!row) return null;

      return {
        messageId: row.messageId,
        tool: row.tool || null,
        toolArgs: this.parseJSON(row.toolArgs) || this.parseJSON(row.args),
        args: this.parseJSON(row.args),
        plan: this.parseJSON(row.plan),
        isMultiStep: row.isMultiStep || false,
        prompt: row.prompt || null,
        result: this.parseJSON(row.result),
        failed: row.failed || false,
        normalized: this.parseJSON(row.normalized),
        imageUrl: row.imageUrl || null,
        videoUrl: row.videoUrl || null,
        audioUrl: row.audioUrl || null,
        timestamp: row.timestamp
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting last command:', { error: errorMessage, chatId });
      return null;
    }
  }

  /**
   * Cleanup old commands (older than TTL)
   * @param ttlMs - TTL in milliseconds (default: 30 days)
   */
  async cleanup(ttlMs: number = 30 * TIME.DAY): Promise<void> {
    if (!this.repository) {
      return;
    }

    const cutoffTime = Date.now() - ttlMs;

    try {
      const count = await this.repository.deleteOlderThan(cutoffTime);
      if (count > 0) {
        logger.info(`🧹 [Commands] Cleaned up ${count} old commands`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error cleaning up commands:', { error: errorMessage });
    }
  }

  /**
   * Clear all commands (for management command)
   */
  async clearAll(): Promise<void> {
    if (!this.repository) {
      return;
    }

    try {
      await this.repository.deleteAll();
      logger.info('🗑️ [Commands] All commands cleared');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error clearing commands:', { error: errorMessage });
    }
  }

  /**
   * Parse JSON value safely
   */
  private parseJSON(value: unknown): unknown {
    if (!value) {
      return null;
    }

    if (typeof value === 'object' && value !== null) {
      return value;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ Failed to parse JSON value: ${errorMessage}`);
        return null;
      }
    }

    return value;
  }
}

export default CommandsManager;
