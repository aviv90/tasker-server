/**
 * Commands Repository
 * Handles direct database interactions for commands history.
 */

import { Pool } from 'pg';

export interface CommandData {
    chatId: string;
    messageId: string;
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
    timestamp: number;
}

class CommandsRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Save or update a command
   */
  async save(commandData: CommandData): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO last_commands (
          chat_id, message_id, tool, tool_args, args, plan, is_multi_step,
          prompt, result, failed, normalized, image_url, video_url, audio_url, timestamp, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id, message_id) 
        DO UPDATE SET 
          tool = EXCLUDED.tool,
          tool_args = EXCLUDED.tool_args,
          args = EXCLUDED.args,
          plan = EXCLUDED.plan,
          is_multi_step = EXCLUDED.is_multi_step,
          prompt = EXCLUDED.prompt,
          result = EXCLUDED.result,
          failed = EXCLUDED.failed,
          normalized = EXCLUDED.normalized,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          audio_url = EXCLUDED.audio_url,
          timestamp = EXCLUDED.timestamp,
          updated_at = CURRENT_TIMESTAMP
      `, [
        commandData.chatId,
        commandData.messageId,
        commandData.tool || null,
        commandData.toolArgs ? JSON.stringify(commandData.toolArgs) : null,
        commandData.args ? JSON.stringify(commandData.args) : null,
        commandData.plan ? JSON.stringify(commandData.plan) : null,
        commandData.isMultiStep || false,
        commandData.prompt || null,
        commandData.result ? JSON.stringify(commandData.result) : null,
        commandData.failed || false,
        commandData.normalized ? JSON.stringify(commandData.normalized) : null,
        commandData.imageUrl || null,
        commandData.videoUrl || null,
        commandData.audioUrl || null,
        commandData.timestamp
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get last command for a chat
   */
  async findLastByChatId(chatId: string): Promise<CommandData | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          message_id, tool, tool_args, args, plan, is_multi_step,
          prompt, result, failed, normalized, image_url, video_url, audio_url, timestamp
        FROM last_commands
        WHERE chat_id = $1
        ORDER BY timestamp DESC
        LIMIT 1
      `, [chatId]);
      
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
          chatId,
          messageId: row.message_id,
          tool: row.tool,
          toolArgs: row.tool_args, // pg automatically parses JSON
          args: row.args,
          plan: row.plan,
          isMultiStep: row.is_multi_step,
          prompt: row.prompt,
          result: row.result,
          failed: row.failed,
          normalized: row.normalized,
          imageUrl: row.image_url,
          videoUrl: row.video_url,
          audioUrl: row.audio_url,
          timestamp: parseInt(row.timestamp)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Delete commands older than timestamp
   */
  async deleteOlderThan(cutoffTime: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM last_commands
        WHERE timestamp < $1
      `, [cutoffTime]);
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Clear all commands
   */
  async deleteAll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM last_commands');
    } finally {
      client.release();
    }
  }
}

export default CommandsRepository;
