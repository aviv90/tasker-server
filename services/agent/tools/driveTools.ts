/**
 * Google Drive Tools - Search and retrieve documents from Google Drive
 * Clean, modular tool definitions following SOLID principles
 */

import googleDriveService from '../../googleDriveService';
import logger from '../../../utils/logger';
import { REQUIRED, ERROR } from '../../../config/messages';
import { createTool } from './base';

type SearchGoogleDriveArgs = {
  query?: string;
  folder_id?: string;
  max_results?: number;
};

/**
 * Tool: search_google_drive
 */
export const search_google_drive = createTool<SearchGoogleDriveArgs>(
  {
    name: 'search_google_drive',
    description: `EXPERIMENTAL: Search Google Drive for files/docs.
CRITICAL: Use ONLY if user explicitly asks (e.g. 'Search in Drive', 'What is in the file').
Restrictions:
- DO NOT use for general web search (use search_web).
- DO NOT use for location (use send_location).
- DO NOT use for chat history (use get_chat_history).
Features: Searches file names and content (OCR).`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g. "project plan", "meeting notes")'
        },
        folder_id: {
          type: 'string',
          description: 'Specific folder ID (optional). If not specified, searches entire Drive.'
        },
        max_results: {
          type: 'number',
          description: 'Max results to return (default: 5)'
        }
      },
      required: ['query']
    }
  },
  async (args) => {
    logger.debug(`🔧 [Agent Tool] search_google_drive called with query: ${args.query}, folder_id: ${args.folder_id}`);

    try {
      if (!args.query) {
        return {
          success: false,
          error: REQUIRED.SEARCH_QUERY
        };
      }

      const maxResults = args.max_results || 5;
      const folderId = args.folder_id || process.env.GOOGLE_DRIVE_FOLDER_ID;

      // Search and extract relevant information
      const result = await googleDriveService.searchAndExtractRelevantInfo(
        args.query,
        folderId,
        maxResults
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'שגיאה בחיפוש ב-Google Drive'
        };
      }

      if (!result.results || result.results.length === 0) {
        return {
          success: true,
          data: `לא נמצאו קבצים רלוונטיים ב-Google Drive עבור החיפוש "${args.query}".`
        };
      }

      // Format results for the agent
      const formattedResults = result.results.map((item: { file: { name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string }; extractedText?: string; relevance?: string }, index: number) => {
        const file = item.file;
        let text = `\n${index + 1}. **${file.name}** (${file.mimeType})`;

        if (file.modifiedTime) {
          const date = new Date(file.modifiedTime);
          text += `\n   📅 עודכן לאחרונה: ${date.toLocaleDateString('he-IL')}`;
        }

        if (file.size) {
          const sizeMB = (parseInt(file.size) / (1024 * 1024)).toFixed(2);
          text += `\n   📦 גודל: ${sizeMB} MB`;
        }

        if (file.webViewLink) {
          text += `\n   🔗 קישור: ${file.webViewLink}`;
        }

        if (item.extractedText) {
          // Limit extracted text length
          const preview = item.extractedText.length > 500
            ? item.extractedText.substring(0, 500) + '...'
            : item.extractedText;
          text += `\n   📄 תוכן:\n   ${preview}`;
        } else if (item.relevance === 'failed') {
          text += `\n   ⚠️ לא ניתן לחלץ טקסט מהקובץ`;
        }

        return text;
      }).join('\n');

      const summary = `נמצאו ${result.results.length} קבצים רלוונטיים ב-Google Drive עבור החיפוש "${args.query}":${formattedResults}`;

      logger.info(`✅ [search_google_drive] Found ${result.results.length} files`);

      return {
        success: true,
        data: summary
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in search_google_drive tool:', { error: err.message, stack: err.stack });

      // Check for authentication errors
      if (err.message.includes('invalid_grant') || err.message.includes('unauthorized') || err.message.includes('OAuth')) {
        return {
          success: false,
          error: 'נדרש אימות מחדש ל-Google Drive. אנא ודא שה-GOOGLE_DRIVE_REFRESH_TOKEN מוגדר נכון.'
        };
      }

      return {
        success: false,
        error: ERROR.searchDrive(err.message)
      };
    }
  }
);

