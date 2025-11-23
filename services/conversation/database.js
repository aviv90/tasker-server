const { Pool } = require('pg');
const logger = require('../../utils/logger');
const { TIME } = require('../../utils/constants');
const MigrationRunner = require('./migrationRunner');

/**
 * Database initialization and connection management
 */
class DatabaseManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Initialize PostgreSQL database connection and run migrations
   */
  async initializeDatabase(attempt = 1) {
    try {
      // Determine if SSL is needed (production OR remote PostgreSQL)
      const databaseUrl = process.env.DATABASE_URL || '';
      const isRemoteDB = databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1');
      const needsSSL = process.env.NODE_ENV === 'production' || isRemoteDB;
      
      logger.info(`🔐 Database connection: ${needsSSL ? 'with SSL (remote)' : 'without SSL (local)'}`);
      
      // Create connection pool
      this.conversationManager.pool = new Pool({
        connectionString: databaseUrl,
        ssl: needsSSL ? { rejectUnauthorized: false } : false,
        max: 10, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: TIME.DB_CONNECTION_TIMEOUT, // Allow up to 10s for cold starts / sleeping DBs
      });

      // Test connection
      const client = await this.conversationManager.pool.connect();
      logger.info('✅ Connected to PostgreSQL database');
      client.release();

      // Run migrations
      logger.info('🚀 Starting database migrations...');
      const migrationRunner = new MigrationRunner(this.conversationManager.pool);
      await migrationRunner.run();
      
      this.conversationManager.isInitialized = true;
      logger.info('✅ Database initialization completed successfully');
      
      // Start periodic cleanup task (monthly)
      this.conversationManager.startPeriodicCleanup();
      
    } catch (error) {
      logger.error('❌ Database initialization failed:', { error: error.message, stack: error.stack });
      // Retry with exponential backoff to avoid crashing the app on transient DB issues
      const maxAttempts = 5;
      if (attempt < maxAttempts) {
        const delayMs = Math.min(TIME.DB_RETRY_MAX_DELAY, TIME.DB_RETRY_DELAY_BASE * Math.pow(2, attempt - 1));
        logger.warn(`⏳ Retrying DB init in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`);
        setTimeout(() => this.initializeDatabase(attempt + 1).catch(() => {}), delayMs);
      } else {
        logger.error('🚫 Giving up on DB initialization after multiple attempts. Running without DB until next restart.');
      }
    }
  }
}

module.exports = DatabaseManager;
