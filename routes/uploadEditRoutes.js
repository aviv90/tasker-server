/**
 * Upload and Edit Routes
 * 
 * Handles file uploads for image editing, video generation, transcription, and voice processing.
 * Refactored to use modular components (Phase 5.3)
 */

const express = require('express');
const router = express.Router();
const { uploadLimiter, callbackLimiter } = require('../middleware/rateLimiter');

// Import modular route handlers
const imageUploadRoutes = require('./upload/imageUpload');
const videoUploadRoutes = require('./upload/videoUpload');
const transcriptionUploadRoutes = require('./upload/transcriptionUpload');
const callbackRoutes = require('./upload/callbacks');
const voiceRoutes = require('./upload/voiceRoutes');

// Setup all routes
// Note: Rate limiting is applied per-route in setupRoutes
imageUploadRoutes.setupRoutes(router, uploadLimiter);
videoUploadRoutes.setupRoutes(router, uploadLimiter);
transcriptionUploadRoutes.setupRoutes(router, uploadLimiter);
voiceRoutes.setupRoutes(router, uploadLimiter);
callbackRoutes.setupRoutes(router, callbackLimiter);

module.exports = router;
