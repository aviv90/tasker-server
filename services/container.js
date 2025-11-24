const { Pool } = require('pg');
const logger = require('../utils/logger');
const { TIME } = require('../utils/constants');

// Register ts-node for TypeScript support in development
if (process.env.NODE_ENV !== 'production' && !process.env.SKIP_TS_NODE) {
  try {
    require('ts-node/register');
  } catch (e) {
    // ts-node not available, will use compiled files
  }
}

// Repositories (TypeScript files compiled to dist/ with default exports)
// In production (Heroku), files are in dist/, so we need to check both locations
const getRepository = (path) => {
  try {
    // Try dist/ first (production)
    return require(`../dist/repositories/${path}`).default;
  } catch (e) {
    // Fallback to source (development with ts-node)
    try {
      return require(`../repositories/${path}`).default;
    } catch (e2) {
      // Last resort: direct require (for JS files)
      return require(`../repositories/${path}`);
    }
  }
};

const CommandsRepository = getRepository('commandsRepository');
const MessageTypesRepository = getRepository('messageTypesRepository');
const AgentContextRepository = getRepository('agentContextRepository');
const SummariesRepository = getRepository('summariesRepository');
const AllowListsRepository = getRepository('allowListsRepository');
const ContactsRepository = getRepository('contactsRepository');

// Helper function to load services (TypeScript files compiled to dist/ with default exports)
// Note: In production, container.js is in dist/services/, so paths are relative to that
const getService = (path) => {
  // In production (Heroku), container.js is in dist/services/container.js
  // In development, container.js is in services/container.js
  const isProduction = process.env.NODE_ENV === 'production';
  const isInDist = __dirname.includes('dist');
  
  if (isProduction || isInDist) {
    // Production or running from dist/: use relative path from dist/services/
    try {
      const distModule = require(`./${path}`);
      return distModule.default || distModule;
    } catch (e) {
      throw new Error(`Failed to load service from dist/: ${path}. Error: ${e.message}`);
    }
  } else {
    // Development: try dist/ first (if exists), then source/ (with ts-node)
    try {
      const distModule = require(`../dist/services/${path}`);
      return distModule.default || distModule;
    } catch (e) {
      // Fallback to source (ts-node will handle .ts files)
      try {
        const sourceModule = require(`./${path}`);
        return sourceModule.default || sourceModule;
      } catch (e2) {
        // Last resort: try without .default (for old JS files)
        try {
          return require(`./${path}`);
        } catch (e3) {
          throw new Error(`Failed to load service: ${path}. Tried dist/, source/, and direct require. Errors: ${e.message}, ${e2.message}, ${e3.message}`);
        }
      }
    }
  }
};

// Services (TypeScript files compiled to dist/ with default exports)
const CommandsManager = getService('conversation/commands');
const MessageTypesManager = getService('conversation/messageTypes');
const AgentContextManager = getService('conversation/agentContext');
const SummariesManager = getService('conversation/summaries');
const AllowListsManager = getService('conversation/allowLists');
const ContactsManager = getService('conversation/contacts');
const DatabaseManager = getService('conversation/database');
const MessagesManager = getService('conversation/messages'); // Legacy
const TasksManager = getService('conversation/tasks'); // Legacy structure

/**
 * Dependency Injection Container
 * Manages the lifecycle and dependencies of all services
 */
class Container {
  constructor() {
    this.pool = null;
    this.services = {};
    this.repositories = {};
    this.isInitialized = false;
  }

  /**
   * Initialize the container and database connection
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // 1. Database Connection
      const databaseUrl = process.env.DATABASE_URL || '';
      const isRemoteDB = databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1');
      const needsSSL = process.env.NODE_ENV === 'production' || isRemoteDB;

      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: needsSSL ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: TIME.DB_CONNECTION_TIMEOUT,
      });

      // Test connection
      const client = await this.pool.connect();
      logger.info('✅ [Container] Connected to PostgreSQL');
      client.release();

      // 2. Initialize Repositories
      this.repositories = {
        commands: new CommandsRepository(this.pool),
        messageTypes: new MessageTypesRepository(this.pool),
        agentContext: new AgentContextRepository(this.pool),
        summaries: new SummariesRepository(this.pool),
        allowLists: new AllowListsRepository(this.pool),
        contacts: new ContactsRepository(this.pool)
      };

      // 3. Initialize Services (Injecting Dependencies)
      // Note: We pass 'this' (container) or specific deps depending on service needs
      
      // Legacy support wrapper for services that expect conversationManager interface
      const conversationManagerMock = {
        pool: this.pool,
        isInitialized: true
      };

      this.services = {
        commands: new CommandsManager(conversationManagerMock, this.repositories.commands),
        messageTypes: new MessageTypesManager(conversationManagerMock, this.repositories.messageTypes),
        agentContext: new AgentContextManager(conversationManagerMock, this.repositories.agentContext),
        summaries: new SummariesManager(conversationManagerMock, this.repositories.summaries),
        allowLists: new AllowListsManager(conversationManagerMock, this.repositories.allowLists),
        contacts: new ContactsManager(conversationManagerMock, this.repositories.contacts),
        messages: new MessagesManager(conversationManagerMock), // Legacy
        tasks: new TasksManager(conversationManagerMock) // Legacy
      };

      // 4. Run Migrations
      const MigrationRunner = require('./conversation/migrationRunner');
      const migrationRunner = new MigrationRunner(this.pool);
      await migrationRunner.run();

      this.isInitialized = true;
      logger.info('🚀 [Container] Initialization complete');

    } catch (error) {
      logger.error('❌ [Container] Initialization failed:', error);
      throw error;
    }
  }

  getService(name) {
    if (!this.services[name]) {
      throw new Error(`Service ${name} not found in container`);
    }
    return this.services[name];
  }

  getRepository(name) {
    if (!this.repositories[name]) {
      throw new Error(`Repository ${name} not found in container`);
    }
    return this.repositories[name];
  }
}

// Singleton instance
const container = new Container();
module.exports = container;
