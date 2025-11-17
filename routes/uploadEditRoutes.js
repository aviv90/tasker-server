/**
 * Upload and Edit Routes
 * 
 * Handles file uploads for image editing, video generation, transcription, and voice processing.
 * Refactored to use modular components (Phase 5.3)
 */

const express = require('express');
const router = express.Router();

// Import modular route handlers
const imageUploadRoutes = require('./upload/imageUpload');
const videoUploadRoutes = require('./upload/videoUpload');
const transcriptionUploadRoutes = require('./upload/transcriptionUpload');
const callbackRoutes = require('./upload/callbacks');
const voiceRoutes = require('./upload/voiceRoutes');

// Setup all routes
imageUploadRoutes.setupRoutes(router);
videoUploadRoutes.setupRoutes(router);
transcriptionUploadRoutes.setupRoutes(router);
callbackRoutes.setupRoutes(router);
voiceRoutes.setupRoutes(router);

module.exports = router;
