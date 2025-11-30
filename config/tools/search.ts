import { Tool } from './types';

export const searchTools: Record<string, Tool> = {
    search_web: {
        name: 'search_web',
        category: 'search',
        description: 'Search web for EXISTING content and links using Google Search',
        usage: ['שלח לי לינק', 'find link to X', 'חפש קישור', 'מצא שיר של X', 'קישור ל-X'],
        parameters: {
            query: { type: 'string', required: true, description: 'Search query' }
        },
        critical: 'Use ONLY for finding links/URLs to EXISTING content. NOT for creating new images/videos! "שלח תמונה של X" = create_image, NOT search_web!',
        historyContext: {
            ignore: true,
            reason: 'Web search requests are self-contained. Only use history if user explicitly references previous search conversation (e.g., "מצא לי עוד קישורים כמו זה ששלחת קודם").'
        }
    },

    search_google_drive: {
        name: 'search_google_drive',
        category: 'search',
        description: 'EXPERIMENTAL: Search and retrieve documents, images, and files from Google Drive. Can extract text from documents and images for RAG-like functionality. ONLY use when user explicitly requests searching in Google Drive or documents.',
        usage: ['חפש ב-Google Drive', 'חפש במסמכים', 'מה יש בתיקייה X', 'מצא מידע על Y ב-Drive', 'search in drive', 'find document about X', 'מה כתוב במסמך Y', 'מה יש בשרטוט', 'מה מופיע במסמך', 'תסביר את התכנית', 'מה כתוב בקובץ'],
        parameters: {
            query: { type: 'string', required: true, description: 'Search query for files and content' },
            folder_id: { type: 'string', required: false, description: 'Specific folder ID to search in (optional)' },
            max_results: { type: 'number', required: false, description: 'Maximum number of files to return (default: 5)' }
        },
        critical: 'CRITICAL RESTRICTION: This is an EXPERIMENTAL tool. ONLY use search_google_drive when the user EXPLICITLY requests searching in Google Drive, documents, or files (e.g., "חפש ב-Google Drive", "חפש במסמכים", "מה יש בשרטוט", "מה מופיע במסמך", "תסביר את התכנית"). Do NOT use for general requests like "send me a link to a song" or "find information about X" - use search_web instead! Do NOT use get_chat_history or analyze_image_from_history for Drive files. Use ONLY for explicit Google Drive/document searches. NOT for web search (use search_web) or creating new content!',
        historyContext: {
            ignore: true,
            reason: 'Google Drive search requests are self-contained. Only use history if user explicitly references previous Drive search conversation.'
        }
    }
};
