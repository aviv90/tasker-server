const { Pool } = require('pg');
const logger = require('../../utils/logger');
const { TIME } = require('../../utils/constants');

/**
 * Database initialization and table creation
 */
class DatabaseManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Initialize PostgreSQL database connection and create tables
   */
  async initializeDatabase(attempt = 1) {
    try {
      // Determine if SSL is needed (production OR remote PostgreSQL)
      // Check if DATABASE_URL contains external host (not localhost)
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

      // Create tables
      await this.createTables();
      
      // Initialize voice settings
      await this.initializeVoiceSettings();
      
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

  /**
   * Create all necessary tables
   */
  async createTables() {
    const client = await this.conversationManager.pool.connect();
    
    try {
        // Create conversations table
      await client.query(`
          CREATE TABLE IF NOT EXISTS conversations (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
      `);
        
      // Create voice_settings table
      await client.query(`
          CREATE TABLE IF NOT EXISTS voice_settings (
          id SERIAL PRIMARY KEY,
          enabled BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create voice_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS voice_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create media_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS media_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create group_creation_allow_list table
      await client.query(`
          CREATE TABLE IF NOT EXISTS group_creation_allow_list (
          id SERIAL PRIMARY KEY,
          contact_name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create last_commands table for retry functionality (updated to support multi-step)
      await client.query(`
        CREATE TABLE IF NOT EXISTS last_commands (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          message_id VARCHAR(255) NOT NULL,
          tool VARCHAR(100) NOT NULL,
          tool_args JSONB,
          args JSONB,
          plan JSONB,
          is_multi_step BOOLEAN DEFAULT false,
          prompt TEXT,
          result JSONB,
          failed BOOLEAN DEFAULT false,
          normalized JSONB,
          image_url TEXT,
          video_url TEXT,
          audio_url TEXT,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(chat_id, message_id)
        )
      `);

      // Create message_types table for identifying bot/user messages in Green API history
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_types (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          message_id VARCHAR(255) NOT NULL,
          message_type VARCHAR(50) NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(chat_id, message_id)
        )
      `);

      // Create tasks table for async task tracking (API routes)
      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id SERIAL PRIMARY KEY,
          task_id VARCHAR(255) NOT NULL UNIQUE,
          status VARCHAR(50) NOT NULL,
          result JSONB,
          error TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create contacts table for WhatsApp contacts and groups
      await client.query(`
        CREATE TABLE IF NOT EXISTS contacts (
          id SERIAL PRIMARY KEY,
          contact_id VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(500),
          contact_name VARCHAR(500),
          type VARCHAR(50),
          chat_id VARCHAR(255),
          raw_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create agent_context table for persistent agent memory
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_context (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL UNIQUE,
          tool_calls JSONB DEFAULT '[]'::jsonb,
          generated_assets JSONB DEFAULT '{"images":[],"videos":[],"audio":[]}'::jsonb,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create conversation_summaries table for long-term memory
      await client.query(`
        CREATE TABLE IF NOT EXISTS conversation_summaries (
          id SERIAL PRIMARY KEY,
          chat_id VARCHAR(255) NOT NULL,
          summary TEXT NOT NULL,
          key_topics JSONB DEFAULT '[]'::jsonb,
          user_preferences JSONB DEFAULT '{}'::jsonb,
          message_count INTEGER DEFAULT 0,
          summary_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add metadata column if it doesn't exist (for existing databases)
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='conversations' AND column_name='metadata'
          ) THEN
            ALTER TABLE conversations ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
          END IF;
        END $$;
      `);

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_chat_id 
        ON conversations(chat_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_timestamp 
        ON conversations(timestamp DESC)
      `);

      // Create indexes for message_types table
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_message_types_chat_id 
        ON message_types(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_message_types_message_id 
        ON message_types(message_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_message_types_type 
        ON message_types(message_type)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_message_types_timestamp 
        ON message_types(timestamp DESC)
      `);

      // Create indexes for last_commands table
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_last_commands_chat_id 
        ON last_commands(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_last_commands_timestamp 
        ON last_commands(timestamp DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_contacts_contact_id
        ON contacts(contact_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_contacts_type
        ON contacts(type)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_context_chat_id
        ON agent_context(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_context_last_updated
        ON agent_context(last_updated DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversation_summaries_chat_id
        ON conversation_summaries(chat_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_conversation_summaries_date
        ON conversation_summaries(summary_date DESC)
      `);

      logger.debug('✅ All database tables and indexes created successfully');
      
    } finally {
      client.release();
    }
  }

  /**
   * Initialize voice settings with default values
   */
  async initializeVoiceSettings() {
    const client = await this.conversationManager.pool.connect();
    
    try {
      // Check if voice settings already exist
      const result = await client.query('SELECT id FROM voice_settings LIMIT 1');
      
      if (result.rows.length === 0) {
        // Insert default voice settings
        await client.query(`
          INSERT INTO voice_settings (enabled) 
          VALUES (false)
        `);
        logger.info('🔊 Voice transcription initialized: disabled (default)');
      } else {
        logger.debug('🔊 Voice settings already exist');
      }
    } finally {
      client.release();
    }
  }
}

module.exports = DatabaseManager;

