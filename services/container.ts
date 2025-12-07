import { Pool, PoolConfig } from 'pg';
import logger from '../utils/logger';
import { TIME } from '../utils/constants';

// Repositories
import CommandsRepository from '../repositories/commandsRepository';
import MessageTypesRepository from '../repositories/messageTypesRepository';
import AgentContextRepository from '../repositories/agentContextRepository';
import SummariesRepository from '../repositories/summariesRepository';
import AllowListsRepository from '../repositories/allowListsRepository';
import ContactsRepository from '../repositories/contactsRepository';
import ScheduledTasksRepository from '../repositories/scheduledTasksRepository';
import TasksRepository from '../repositories/tasksRepository';

// Services
import CommandsManager from './conversation/commands';
import MessageTypesManager from './conversation/messageTypes';
import AgentContextManager from './conversation/agentContext';
import SummariesManager from './conversation/summaries';
import AllowListsManager from './conversation/allowLists';
import ContactsManager from './conversation/contacts';
import MessagesManager from './conversation/messages';
import TasksManager from './conversation/tasks';
import MigrationRunner from './conversation/migrationRunner';
import ScheduledTasksService from './scheduling/scheduledTasksService';
import { GreenApiMessagingService } from './greenApi/messagingService';

interface Services {
    commands: CommandsManager;
    messageTypes: MessageTypesManager;
    agentContext: AgentContextManager;
    summaries: SummariesManager;
    allowLists: AllowListsManager;
    contacts: ContactsManager;
    messages: MessagesManager;
    tasks: TasksManager;
    scheduledTasks: ScheduledTasksService;
    messaging: GreenApiMessagingService;
}

interface Repositories {
    commands: CommandsRepository;
    messageTypes: MessageTypesRepository;
    agentContext: AgentContextRepository;
    summaries: SummariesRepository;
    allowLists: AllowListsRepository;
    contacts: ContactsRepository;
    scheduledTasks: ScheduledTasksRepository;
    tasks: TasksRepository;
}

class Container {
    public pool: Pool | null = null;
    public services: Partial<Services> = {};
    public repositories: Partial<Repositories> = {};
    public isInitialized: boolean = false;

    async initialize() {
        if (this.isInitialized) return;

        try {
            const databaseUrl = process.env.DATABASE_URL || '';
            const isRemoteDB = databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1');
            const needsSSL = process.env.NODE_ENV === 'production' || isRemoteDB;

            const poolConfig: PoolConfig = {
                connectionString: databaseUrl,
                ssl: needsSSL ? { rejectUnauthorized: false } : false,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: TIME.DB_CONNECTION_TIMEOUT,
            };

            this.pool = new Pool(poolConfig);

            const client = await this.pool.connect();
            logger.info('✅ [Container] Connected to PostgreSQL');
            client.release();

            // Initialize Repositories
            this.repositories = {
                commands: new CommandsRepository(this.pool),
                messageTypes: new MessageTypesRepository(this.pool),
                agentContext: new AgentContextRepository(this.pool),
                summaries: new SummariesRepository(this.pool),
                allowLists: new AllowListsRepository(this.pool),
                contacts: new ContactsRepository(this.pool),
                scheduledTasks: new ScheduledTasksRepository(this.pool),
                tasks: new TasksRepository(this.pool)
            };

            // Mock for legacy compatibility
            // Some services might expect the full ConversationManager, but we pass a subset
            const conversationManagerMock = {
                pool: this.pool,
                isInitialized: true
            };

            // Initialize Services
            const commandsManager = new CommandsManager(conversationManagerMock, this.repositories.commands!);
            const messageTypesManager = new MessageTypesManager(conversationManagerMock, this.repositories.messageTypes!);
            const agentContextManager = new AgentContextManager(conversationManagerMock, this.repositories.agentContext!);
            const summariesManager = new SummariesManager(conversationManagerMock, this.repositories.summaries!);
            const allowListsManager = new AllowListsManager(this.repositories.allowLists!);
            const contactsManager = new ContactsManager(conversationManagerMock, this.repositories.contacts!);
            const messagesManager = new MessagesManager(conversationManagerMock);
            const tasksManager = new TasksManager(conversationManagerMock, this.repositories.tasks!);

            const messagingService = new GreenApiMessagingService(messageTypesManager, messagesManager);
            const scheduledTasksService = new ScheduledTasksService(this.repositories.scheduledTasks!, messagingService);

            this.services = {
                commands: commandsManager,
                messageTypes: messageTypesManager,
                agentContext: agentContextManager,
                summaries: summariesManager,
                allowLists: allowListsManager,
                contacts: contactsManager,
                messages: messagesManager,
                tasks: tasksManager,
                scheduledTasks: scheduledTasksService,
                messaging: messagingService
            };

            // Run Migrations
            const migrationRunner = new MigrationRunner(this.pool);
            await migrationRunner.run();

            this.isInitialized = true;
            logger.info('🚀 [Container] Initialization complete');

        } catch (error: unknown) {
            logger.error('❌ [Container] Initialization failed:', error);
            throw error;
        }
    }

    getService<K extends keyof Services>(name: K): Services[K] {
        if (!this.services[name]) {
            throw new Error(`Service ${name} not found in container`);
        }
        return this.services[name] as Services[K];
    }

    getRepository<K extends keyof Repositories>(name: K): Repositories[K] {
        if (!this.repositories[name]) {
            throw new Error(`Repository ${name} not found in container`);
        }
        return this.repositories[name] as Repositories[K];
    }
}

const container = new Container();
export default container;
