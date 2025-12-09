/**
 * Google Drive Download Operations
 * 
 * File download operations for Google Drive.
 */

import { getAuthenticatedDriveClient } from './authOperations';
import { getFileMetadata, DriveFile } from './driveSearch';
import logger from '../../utils/logger';

// Re-export DriveFile for convenience
export { DriveFile };

/**
 * Download file content
 */
export async function downloadFile(fileId: string, mimeType?: string): Promise<{
    success: boolean;
    data?: Buffer;
    mimeType?: string;
    error?: string;
}> {
    try {
        const drive = getAuthenticatedDriveClient();

        // Get file metadata first
        const metadataResult = await getFileMetadata(fileId);
        if (!metadataResult.success || !metadataResult.file) {
            return {
                success: false,
                error: metadataResult.error || 'Failed to get file metadata'
            };
        }

        const fileMimeType = mimeType || metadataResult.file.mimeType;

        // Download file
        const response = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const buffer = Buffer.from(response.data as ArrayBuffer);

        logger.info(`✅ [Google Drive] Downloaded file ${fileId} (${buffer.length} bytes)`);

        return {
            success: true,
            data: buffer,
            mimeType: fileMimeType
        };
    } catch (error) {
        const err = error as Error;
        logger.error('❌ Error downloading file:', { error: err.message, stack: err.stack });
        return {
            success: false,
            error: `שגיאה בהורדת הקובץ: ${err.message}`
        };
    }
}
