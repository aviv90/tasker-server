require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const taskRoutes = require('./routes/taskRoutes');
const uploadEditRoutes = require('./routes/uploadEditRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');

// Initialize ConversationManager to ensure PostgreSQL connection is established
const ConversationManager = require('./services/conversationManager');
const conversationManager = new ConversationManager();

// Ensure tmp directory exists (important for Heroku deployments)
const tmpDir = path.join(__dirname, 'public', 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log('📁 Created public/tmp directory for static files');
}

app.enable('trust proxy');
app.use(express.json({ limit: '50mb' }));
app.use('/static', express.static(path.join(__dirname, 'public', 'tmp')));
app.use('/api', taskRoutes);
app.use('/api', uploadEditRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Add music callback endpoint
app.post('/api/music/callback', (req, res) => {
    console.log('🎵 Music generation callback received:', req.body);
    res.json({ status: 'received' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('🔄 Using CloudConvert API for audio conversion');
    console.log('📋 Available endpoints:');
    console.log('  POST /api/start-task - Start text-to-image/video/music generation');
    console.log('  POST /api/upload-edit - Upload and edit images');
    console.log('  POST /api/upload-video - Upload image and generate video');
    console.log('  POST /api/upload-video-edit - Upload video and edit/transform');
    console.log('  POST /api/upload-transcribe - Upload audio and transcribe to text');
    console.log('  POST /api/speech-to-song - Transform speech recording into song');
    console.log('  GET /api/task-status/:taskId - Check task status');
    console.log('  POST /api/whatsapp/webhook - Green API WhatsApp webhook endpoint');
});