/**
 * Google Drive Operations - Main Entry Point
 * 
 * Re-exports all Drive operations from focused modules.
 * Maintains backward compatibility with existing imports.
 */

// Re-export all types and functions from modules
export { DriveFile, SearchOptions, searchFiles, getFileMetadata } from './driveSearch';
export { downloadFile } from './driveDownload';
export {
  extractTextFromDocument,
  searchAndExtractRelevantInfo,
  ExtractionResult,
  RAGResult
} from './driveTextExtraction';
