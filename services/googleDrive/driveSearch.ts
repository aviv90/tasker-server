/**
 * Google Drive Search Operations
 * 
 * Search and metadata operations for Google Drive files.
 */

import { getAuthenticatedDriveClient } from './authOperations';
import logger from '../../utils/logger';

/**
 * File search result
 */
export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
    thumbnailLink?: string;
    description?: string;
}

/**
 * Search options
 */
export interface SearchOptions {
    query?: string;
    folderId?: string;
    mimeType?: string;
    maxResults?: number;
    orderBy?: string;
}

/**
 * Search files in Google Drive
 */
export async function searchFiles(options: SearchOptions = {}): Promise<{
    success: boolean;
    files?: DriveFile[];
    error?: string;
}> {
    try {
        const drive = getAuthenticatedDriveClient();
        const {
            query = '',
            folderId,
            mimeType,
            maxResults = 10,
            orderBy = 'modifiedTime desc'
        } = options;

        // Build Google Drive search query safely
        const conditions: string[] = [];

        if (query && query.trim()) {
            const trimmed = query.trim();
            const tokens = trimmed.split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
                const tokenConditions = tokens.map(rawToken => {
                    const escapedToken = rawToken.replace(/'/g, "\\'");
                    return `(name contains '${escapedToken}' or fullText contains '${escapedToken}')`;
                });
                conditions.push(`(${tokenConditions.join(' or ')})`);
            }
        }

        if (folderId) {
            conditions.push(`'${folderId}' in parents`);
        }

        if (mimeType) {
            conditions.push(`mimeType='${mimeType}'`);
        }

        conditions.push('trashed = false');

        const q = conditions.join(' and ');

        logger.debug(`🔍 [Google Drive] Searching with query: ${q}`, { folderId, mimeType });

        const response = await drive.files.list({
            q,
            pageSize: maxResults,
            orderBy,
            fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink, description)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files: DriveFile[] = (response.data.files || []).map(file => ({
            id: file.id || '',
            name: file.name || '',
            mimeType: file.mimeType || '',
            size: file.size || undefined,
            modifiedTime: file.modifiedTime || undefined,
            webViewLink: file.webViewLink || undefined,
            thumbnailLink: file.thumbnailLink || undefined,
            description: file.description || undefined
        }));

        logger.info(`✅ [Google Drive] Found ${files.length} files`);

        return { success: true, files };
    } catch (error) {
        const err = error as Error;
        logger.error('❌ Error searching Google Drive:', { error: err.message, stack: err.stack });

        if (err.message.includes('invalid_grant') || err.message.includes('unauthorized')) {
            return {
                success: false,
                error: 'נדרש אימות מחדש ל-Google Drive. אנא התחבר מחדש.'
            };
        }

        return {
            success: false,
            error: `שגיאה בחיפוש ב-Google Drive: ${err.message}`
        };
    }
}

/**
 * Get file metadata
 */
export async function getFileMetadata(fileId: string): Promise<{
    success: boolean;
    file?: DriveFile;
    error?: string;
}> {
    try {
        const drive = getAuthenticatedDriveClient();

        const response = await drive.files.get({
            fileId,
            fields: 'id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink, description',
            supportsAllDrives: true
        });

        const file: DriveFile = {
            id: response.data.id || '',
            name: response.data.name || '',
            mimeType: response.data.mimeType || '',
            size: response.data.size || undefined,
            modifiedTime: response.data.modifiedTime || undefined,
            webViewLink: response.data.webViewLink || undefined,
            thumbnailLink: response.data.thumbnailLink || undefined,
            description: response.data.description || undefined
        };

        return { success: true, file };
    } catch (error) {
        const err = error as Error;
        logger.error('❌ Error getting file metadata:', { error: err.message, stack: err.stack });
        return {
            success: false,
            error: `שגיאה בקבלת מידע על הקובץ: ${err.message}`
        };
    }
}
