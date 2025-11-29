/**
 * Database Helpers for Tests
 * Utilities for database operations in tests
 */

import { Pool, PoolClient } from 'pg';
import { getTestPool, cleanTestDatabase } from '../setup/database';
import { generateChatId, generateMessageId } from './testHelpers';

/**
 * Get a database client for direct queries
 */
export async function getDbClient(): Promise<PoolClient> {
  const pool = await getTestPool();
  return pool.connect();
}

/**
 * Insert a test conversation message
 */
export async function insertTestMessage(
  chatId: string,
  role: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      `INSERT INTO conversations (chat_id, role, content, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [chatId, role, content, JSON.stringify(metadata), Date.now()]
    );
  } finally {
    client.release();
  }
}

/**
 * Insert a test command
 */
export async function insertTestCommand(
  chatId: string,
  messageId: string,
  tool: string | null = null,
  toolArgs: unknown = {},
  prompt: string | null = null
): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      `INSERT INTO last_commands (chat_id, message_id, tool, tool_args, prompt, timestamp, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET
         tool = EXCLUDED.tool,
         tool_args = EXCLUDED.tool_args,
         prompt = EXCLUDED.prompt,
         updated_at = CURRENT_TIMESTAMP`,
      [chatId, messageId, tool, JSON.stringify(toolArgs), prompt, Date.now()]
    );
  } finally {
    client.release();
  }
}

/**
 * Insert a test contact
 */
export async function insertTestContact(
  name: string,
  type: string = 'user',
  phone: string | null = null
): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      `INSERT INTO contacts (name, type, phone, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (name) DO UPDATE SET
         type = EXCLUDED.type,
         phone = EXCLUDED.phone`,
      [name, type, phone]
    );
  } finally {
    client.release();
  }
}

/**
 * Get all messages for a chat
 */
export async function getChatMessages(chatId: string): Promise<unknown[]> {
  const client = await getDbClient();
  try {
    const result = await client.query(
      `SELECT * FROM conversations WHERE chat_id = $1 ORDER BY timestamp ASC`,
      [chatId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get last command for a chat
 */
export async function getLastCommand(chatId: string): Promise<unknown | null> {
  const client = await getDbClient();
  try {
    const result = await client.query(
      `SELECT * FROM last_commands WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [chatId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Count records in a table
 */
export async function countTable(tableName: string): Promise<number> {
  const client = await getDbClient();
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    return parseInt(result.rows[0]?.count || '0', 10);
  } finally {
    client.release();
  }
}

/**
 * Setup test data for a chat
 */
export async function setupTestChat(
  chatId: string = generateChatId(),
  messageCount: number = 3
): Promise<{ chatId: string; messages: unknown[] }> {
  // Insert test messages
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content = `Test message ${i + 1}`;
    await insertTestMessage(chatId, role, content);
  }

  const messages = await getChatMessages(chatId);
  return { chatId, messages };
}

/**
 * Clean up test data for a specific chat
 */
export async function cleanupTestChat(chatId: string): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query('DELETE FROM conversations WHERE chat_id = $1', [chatId]);
    await client.query('DELETE FROM last_commands WHERE chat_id = $1', [chatId]);
    await client.query('DELETE FROM agent_context WHERE chat_id = $1', [chatId]);
    await client.query('DELETE FROM summaries WHERE chat_id = $1', [chatId]);
  } finally {
    client.release();
  }
}

