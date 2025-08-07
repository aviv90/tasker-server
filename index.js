require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const taskRoutes = require('./routes/taskRoutes');
const uploadEditRoutes = require('./routes/uploadEditRoutes');

app.enable('trust proxy');
app.use(express.json({ limit: '50mb' }));
app.use('/static', express.static(path.join(__dirname, 'public', 'tmp')));
app.use('/api', taskRoutes);
app.use('/api', uploadEditRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('📋 Available endpoints:');
    console.log('  POST /api/start-task - Start text-to-image/video generation');
    console.log('  POST /api/upload-edit - Upload and edit images');
    console.log('  POST /api/upload-video - Upload image and generate video');
    console.log('  POST /api/upload-transcribe - Upload audio and transcribe to text');
    console.log('  GET /api/task-status/:taskId - Check task status');
});