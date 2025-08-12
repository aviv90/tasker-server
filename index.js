require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const taskRoutes = require('./routes/taskRoutes');
const uploadEditRoutes = require('./routes/uploadEditRoutes');
const sanitizeRequest = require('./middleware/sanitizeRequest');
const safeJsonParser = require('./middleware/safeJsonParser');

app.enable('trust proxy');

// Use custom JSON parser that handles problematic characters
app.use(safeJsonParser());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Apply text sanitization middleware to all API routes
app.use('/api', sanitizeRequest);

app.use('/static', express.static(path.join(__dirname, 'public', 'tmp')));
app.use('/api', taskRoutes);
app.use('/api', uploadEditRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('📋 Available endpoints:');
    console.log('  POST /api/start-task - Start text-to-image/video/song generation');
    console.log('  POST /api/upload-edit - Upload and edit images');
    console.log('  POST /api/upload-video - Upload image and generate video');
    console.log('  POST /api/upload-video-edit - Upload video and edit/transform');
    console.log('  POST /api/upload-transcribe - Upload audio and transcribe to text');
    console.log('  GET /api/task-status/:taskId - Check task status');
});