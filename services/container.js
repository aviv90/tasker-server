const { Pool } = require('pg');
const logger = require('../utils/logger');
const { TIME } = require('../utils/constants');

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

// Services
const CommandsManager = require('./conversation/commands');
const MessageTypesManager = require('./conversation/messageTypes');
const AgentContextManager = require('./conversation/agentContext');
const SummariesManager = require('./conversation/summaries');
const AllowListsManager = require('./conversation/allowLists');
const ContactsManager = require('./conversation/contacts');
const DatabaseManager = require('./conversation/database');
const MessagesManager = require('./conversation/messages'); // Legacy
const TasksManager = require('./conversation/tasks'); // Legacy structure

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
