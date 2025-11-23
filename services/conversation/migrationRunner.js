/**
 * Migration Runner
 * Handles database schema migrations.
 * 
 * 1. Creates a 'migrations' table if not exists.
 * 2. Reads SQL files from the migrations directory.
 * 3. Executes pending migrations in order.
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class MigrationRunner {
  constructor(pool) {
    this.pool = pool;
    this.migrationsTable = 'migrations';
  }

  /**
   * Initialize migrations table
   */
  async initTable(client) {
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
  async run() {
    const client = await this.pool.connect();
    try {
      await this.initTable(client);

      // Get list of already applied migrations
      const result = await client.query(`SELECT name FROM ${this.migrationsTable}`);
      const appliedMigrations = new Set(result.rows.map(row => row.name));

      // Get all migration files
      const migrationsDir = path.join(__dirname, '..', '..', '..', 'migrations');
      
      // Check if directory exists
      try {
        await fs.access(migrationsDir);
      } catch (error) {
        logger.warn('⚠️ Migrations directory not found, skipping migrations.');
        return;
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
          } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`❌ Migration failed: ${file}`, { error: error.message });
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

module.exports = MigrationRunner;

