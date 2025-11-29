/**
 * Google Drive Service - Facade
 * 
 * This file maintains backward compatibility by re-exporting
 * everything from the modular googleDrive/ directory.
 */

// Re-export everything from googleDrive module for backward compatibility
import googleDriveModule from './googleDrive';

// Export all functions individually for TypeScript compatibility
export const searchFiles = googleDriveModule.searchFiles;
export const getFileMetadata = googleDriveModule.getFileMetadata;
export const downloadFile = googleDriveModule.downloadFile;
export const extractTextFromDocument = googleDriveModule.extractTextFromDocument;
export const searchAndExtractRelevantInfo = googleDriveModule.searchAndExtractRelevantInfo;
export const getAuthenticatedDriveClient = googleDriveModule.getAuthenticatedDriveClient;

// Export everything else as default for backward compatibility
export default googleDriveModule;

