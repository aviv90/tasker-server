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
export const getOAuth2Client = googleDriveModule.getOAuth2Client;
export const getAuthUrl = googleDriveModule.getAuthUrl;
export const getTokensFromCode = googleDriveModule.getTokensFromCode;
export const refreshAccessToken = googleDriveModule.refreshAccessToken;
export const getAuthenticatedDriveClient = googleDriveModule.getAuthenticatedDriveClient;

// Export everything else as default for backward compatibility
export default googleDriveModule;

// Ensure CommonJS compatibility for existing require() calls
module.exports = googleDriveModule;
module.exports.searchFiles = searchFiles;
module.exports.getFileMetadata = getFileMetadata;
module.exports.downloadFile = downloadFile;
module.exports.extractTextFromDocument = extractTextFromDocument;
module.exports.searchAndExtractRelevantInfo = searchAndExtractRelevantInfo;
module.exports.getOAuth2Client = getOAuth2Client;
module.exports.getAuthUrl = getAuthUrl;
module.exports.getTokensFromCode = getTokensFromCode;
module.exports.refreshAccessToken = refreshAccessToken;
module.exports.getAuthenticatedDriveClient = getAuthenticatedDriveClient;

