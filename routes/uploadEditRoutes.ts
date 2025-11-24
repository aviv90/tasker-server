/**
 * Upload and Edit Routes
 * 
 * Handles file uploads for image editing, video generation, transcription, and voice processing.
 * Refactored to use modular components (Phase 5.3)
 */

import express from 'express';
import { uploadLimiter, callbackLimiter } from '../middleware/rateLimiter';

// Import modular route handlers
import imageUploadRoutes from './upload/imageUpload';
import videoUploadRoutes from './upload/videoUpload';
import transcriptionUploadRoutes from './upload/transcriptionUpload';
import callbackRoutes from './upload/callbacks';
import voiceRoutes from './upload/voiceRoutes';

const router = express.Router();

// Setup all routes
// Note: Rate limiting is applied per-route in setupRoutes
imageUploadRoutes.setupRoutes(router, uploadLimiter);
videoUploadRoutes.setupRoutes(router, uploadLimiter);
transcriptionUploadRoutes.setupRoutes(router, uploadLimiter);
voiceRoutes.setupRoutes(router, uploadLimiter);
callbackRoutes.setupRoutes(router, callbackLimiter);

export default router;
