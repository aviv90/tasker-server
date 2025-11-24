import 'dotenv/config';

// Load centralized configuration
import { config, validateConfig } from './config';
import logger from './utils/logger';

// Validate configuration on startup
try {
    validateConfig();
    logger.info('✅ Configuration validated successfully', { environment: config.env });
} catch (error: any) {
    logger.error('❌ Configuration validation failed', { error: error.message });
    process.exit(1);
}

import express from 'express';
import fs from 'fs';
import taskRoutes from './routes/taskRoutes';
import uploadEditRoutes from './routes/uploadEditRoutes';
import whatsappRoutes from './routes/whatsappRoutes';

// Initialize ConversationManager to ensure PostgreSQL connection is established
import conversationManager from './services/conversationManager';

// Ensure tmp directory exists (important for Heroku deployments)
if (!fs.existsSync(config.paths.tmp)) {
    fs.mkdirSync(config.paths.tmp, { recursive: true });
    logger.info('📁 Created tmp directory for static files', { path: config.paths.tmp });
}

const app = express();

app.enable('trust proxy');
app.use(express.json({ limit: config.limits.jsonBodySize }));
app.use('/static', express.static(config.paths.static));

// Apply rate limiting to routes
import { apiLimiter } from './middleware/rateLimiter';
app.use('/api', apiLimiter); // Apply to all /api routes

app.use('/api', taskRoutes);
app.use('/api', uploadEditRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Music callback is handled in uploadEditRoutes.ts

// Ensure conversationManager is initialized
void conversationManager;

app.listen(config.server.port, config.server.host, () => {
    logger.info(`🚀 Server running`, {
        port: config.server.port,
        host: config.server.host,
        environment: config.env,
        baseUrl: config.urls.serverBaseUrl
    });
    logger.info('🔄 Using CloudConvert API for audio conversion');
    logger.info('📋 Available endpoints', {
        endpoints: [
            'POST /api/start-task - Start text-to-image/video/music generation',
            'POST /api/upload-edit - Upload and edit images',
            'POST /api/upload-video - Upload image and generate video',
            'POST /api/upload-video-edit - Upload video and edit/transform',
            'POST /api/upload-transcribe - Upload audio and transcribe to text',
            'POST /api/speech-to-song - Transform speech recording into song',
            'GET /api/task-status/:taskId - Check task status',
            'POST /api/whatsapp/webhook - Green API WhatsApp webhook endpoint'
        ]
    });
});
