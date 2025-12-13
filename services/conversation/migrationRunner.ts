/**
 * Migration Runner
 * Handles database schema migrations.
 * 
 * 1. Creates a 'migrations' table if not exists.
 * 2. Reads SQL files from the migrations directory.
 * 3. Executes pending migrations in order.
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from '../../utils/logger';
import { Pool, PoolClient } from 'pg';

class MigrationRunner {
  private pool: Pool;
  private migrationsTable: string;

  constructor(pool: Pool) {
    this.pool = pool;
    this.migrationsTable = 'migrations';
  }

  /**
   * Initialize migrations table
   */
  private async initTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Run all pending migrations
   */
  async run(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.initTable(client);

      // Get list of already applied migrations
      const result = await client.query(`SELECT name FROM ${this.migrationsTable}`);
      const appliedMigrations = new Set(result.rows.map((row: { name: string }) => row.name));

      // Get all migration files
      // Get all migration files
      let migrationsDir = path.join(__dirname, '..', '..', '..', 'migrations');

      // Check if directory exists
      try {
        await fs.access(migrationsDir);
      } catch (error: unknown) {
        // Try checking 2 levels up (for ts-node/dev environment where services is at root)
        migrationsDir = path.join(__dirname, '..', '..', 'migrations');
        try {
          await fs.access(migrationsDir);
          logger.debug(`Found migrations at dev path: ${migrationsDir}`);
        } catch (e) {
          logger.warn('⚠️ Migrations directory not found (checked dist and src), skipping migrations.');
          return;
        }
      }

      const files = await fs.readdir(migrationsDir);

      // Filter SQL files and sort them
      const migrationFiles = files
        .filter(f => f.endsWith('.sql'))
        .sort(); // Sort ensures 001 runs before 002

      let runCount = 0;

      for (const file of migrationFiles) {
        if (!appliedMigrations.has(file)) {
          logger.info(`🔄 Running migration: ${file}`);

          const filePath = path.join(migrationsDir, file);
          const sql = await fs.readFile(filePath, 'utf8');

          try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query(`INSERT INTO ${this.migrationsTable} (name) VALUES ($1)`, [file]);
            await client.query('COMMIT');

            logger.info(`✅ Migration completed: ${file}`);
            runCount++;
          } catch (error: unknown) {
            await client.query('ROLLBACK');
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Migration failed: ${file}`, { error: errorMessage });
            throw error; // Stop execution on failure
          }
        }
      }

      if (runCount > 0) {
        logger.info(`🚀 Successfully applied ${runCount} migrations.`);
      } else {
        logger.debug('✅ Database is up to date.');
      }

    } finally {
      client.release();
    }
  }
}

export default MigrationRunner;

