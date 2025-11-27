/**
 * Google Drive Service - Main Entry Point
 * 
 * Provides access to Google Drive for document search and retrieval.
 * Supports RAG-like functionality for images, documents, and other files.
 */

import * as driveOperations from './driveOperations';
import * as authOperations from './authOperations';

// Re-export everything
export default {
  ...driveOperations,
  ...authOperations
};

export * from './driveOperations';
export * from './authOperations';

