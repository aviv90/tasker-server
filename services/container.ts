import { Pool, PoolConfig } from 'pg';
import { config } from '../config';
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
import MusicTasksRepository from '../repositories/musicTasksRepository';

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
    musicTasks: MusicTasksRepository;
}

class Container {
    public pool: Pool | null = null;
    public services: Partial<Services> = {};
    public repositories: Partial<Repositories> = {};
    public isInitialized: boolean = false;

    async initialize() {
        if (this.isInitialized) return;

        try {
            const poolConfig: PoolConfig = {
                connectionString: config.database.url || '',
                ssl: config.database.needsSSL ? { rejectUnauthorized: false } : false,
                max: config.database.pool.max,
                idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
                connectionTimeoutMillis: config.database.pool.connectionTimeoutMillis,
                keepAlive: true,
                keepAliveInitialDelayMillis: 60000,
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
                tasks: new TasksRepository(this.pool),
                musicTasks: new MusicTasksRepository(this.pool)
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
            const tasksManager = new TasksManager(this.repositories.tasks!);

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
            this.startPeriodicCleanup();
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

    // ═══════════════════ CLEANUP ═══════════════════
    private cleanupIntervalHandle: NodeJS.Timeout | null = null;

    async runFullCleanup(): Promise<{ contextDeleted: number; summariesDeleted: number; totalDeleted: number }> {
        const messageTypesManager = this.getService('messageTypes');
        const commandsManager = this.getService('commands');
        const agentContextManager = this.getService('agentContext');
        const summariesManager = this.getService('summaries');

        // Cleanup message types (30 days TTL)
        await messageTypesManager.cleanup(30 * TIME.DAY);

        // Cleanup old commands (30 days TTL)
        await commandsManager.cleanup(30 * TIME.DAY);

        logger.info('🧹 [Container] Starting full cleanup...');
        const contextDeleted = await agentContextManager.cleanupOldAgentContext(30);
        const summariesDeleted = await summariesManager.cleanupOldSummaries(10);

        const stats = { contextDeleted, summariesDeleted, totalDeleted: contextDeleted + summariesDeleted };
        logger.info(`✅ [Container] Full cleanup completed:`, stats);
        return stats;
    }

    startPeriodicCleanup(): void {
        if (this.cleanupIntervalHandle) return;

        const CLEANUP_INTERVAL_MS = Math.min(TIME.CLEANUP_INTERVAL, 2147483647);

        setTimeout(async () => {
            logger.info('🧹 [Container] Running first scheduled cleanup...');
            await this.runFullCleanup();

            this.cleanupIntervalHandle = setInterval(async () => {
                logger.info('🧹 [Container] Running scheduled cleanup...');
                await this.runFullCleanup();
            }, CLEANUP_INTERVAL_MS);
        }, 1000); // 1 second delay before first cleanup

        logger.info(`✅ [Container] Periodic cleanup scheduled (~every 30 days)`);
    }

    async close(): Promise<void> {
        if (this.cleanupIntervalHandle) {
            clearInterval(this.cleanupIntervalHandle);
            this.cleanupIntervalHandle = null;
        }
        if (this.pool) {
            await this.pool.end();
            logger.info('🔌 [Container] Database pool closed');
        }
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
