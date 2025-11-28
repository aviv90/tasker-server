/**
 * Google Drive Operations
 * 
 * Core operations for searching, listing, and downloading files from Google Drive.
 */

import { getAuthenticatedDriveClient } from './authOperations';
import logger from '../../utils/logger';
import { getServices } from '../agent/utils/serviceLoader';

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
    // See: https://developers.google.com/drive/api/guides/search-files
    const conditions: string[] = [];

    if (query && query.trim()) {
      const trimmed = query.trim();
      // Escape single quotes
      const escaped = trimmed.replace(/'/g, "\\'");
      // Search in name and fullText for maximum recall
      conditions.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
    }
    
    if (folderId) {
      conditions.push(`'${folderId}' in parents`);
    }
    
    if (mimeType) {
      conditions.push(`mimeType='${mimeType}'`);
    }

    // Always exclude trashed files
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

    return {
      success: true,
      files
    };
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Error searching Google Drive:', { error: err.message, stack: err.stack });
    
    // Check if it's an authentication error
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

    return {
      success: true,
      file
    };
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Error getting file metadata:', { error: err.message, stack: err.stack });
    return {
      success: false,
      error: `שגיאה בקבלת מידע על הקובץ: ${err.message}`
    };
  }
}

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

/**
 * Extract text from document using Gemini
 */
export async function extractTextFromDocument(fileId: string, mimeType: string): Promise<{
  success: boolean;
  text?: string;
  error?: string;
}> {
  try {
    // Download file
    const downloadResult = await downloadFile(fileId, mimeType);
    if (!downloadResult.success || !downloadResult.data) {
      return {
        success: false,
        error: downloadResult.error || 'Failed to download file'
      };
    }

    const { geminiService } = getServices();

    // Handle different file types
    if (mimeType.startsWith('image/')) {
      // Use Gemini vision API for images
      const base64 = downloadResult.data.toString('base64');
      
      const result = await geminiService.analyzeImageWithText(
        'תאר את התוכן של התמונה בפירוט. אם יש טקסט בתמונה, העתק אותו במלואו.',
        base64
      ) as { text?: string; error?: string };

      return {
        success: true,
        text: result.text || result.error || 'לא ניתן לחלץ טקסט מהתמונה'
      };
    } else if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) {
      // For text-based documents, try to extract text
      // Note: Google Drive API can export some formats, but for PDFs we might need OCR
      const text = downloadResult.data.toString('utf-8');
      
      // If it's a PDF, we'd need special handling, but for now try basic extraction
      if (mimeType.includes('pdf')) {
        // For PDFs, use Gemini File API if available, or return error
        return {
          success: false,
          error: 'חילוץ טקסט מ-PDF דורש עיבוד מיוחד. נסה להמיר את הקובץ ל-Google Docs.'
        };
      }
      
      return {
        success: true,
        text: text.substring(0, 100000) // Limit text length
      };
    }

    return {
      success: false,
      error: `סוג קובץ לא נתמך: ${mimeType}`
    };
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Error extracting text from document:', { error: err.message, stack: err.stack });
    return {
      success: false,
      error: `שגיאה בחילוץ טקסט: ${err.message}`
    };
  }
}

/**
 * Search and extract relevant information from Drive files
 * RAG-like functionality: search files, extract text, and provide context
 */
export async function searchAndExtractRelevantInfo(
  searchQuery: string,
  folderId?: string,
  maxFiles: number = 5
): Promise<{
  success: boolean;
  results?: Array<{
    file: DriveFile;
    extractedText?: string;
    relevance?: string;
  }>;
  error?: string;
}> {
  try {
    // Search for files
    const searchResult = await searchFiles({
      query: searchQuery,
      folderId,
      maxResults: maxFiles
    });

    if (!searchResult.success || !searchResult.files || searchResult.files.length === 0) {
      return {
        success: true,
        results: []
      };
    }

    // Extract text from each file
    const results = await Promise.all(
      searchResult.files.map(async (file) => {
        try {
          const extractResult = await extractTextFromDocument(file.id, file.mimeType);
          return {
            file,
            extractedText: extractResult.text,
            relevance: extractResult.success ? 'extracted' : 'failed'
          };
        } catch (error) {
          logger.warn(`⚠️ Failed to extract text from ${file.name}:`, error);
          return {
            file,
            extractedText: undefined,
            relevance: 'failed'
          };
        }
      })
    );

    logger.info(`✅ [Google Drive] Extracted text from ${results.length} files`);

    return {
      success: true,
      results
    };
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Error in searchAndExtractRelevantInfo:', { error: err.message, stack: err.stack });
    return {
      success: false,
      error: `שגיאה בחיפוש וחילוץ מידע: ${err.message}`
    };
  }
}

