/**
 * Google Drive Text Extraction Operations
 * 
 * Extract text from Drive documents using Gemini AI.
 * RAG-like functionality for document analysis.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchFiles, DriveFile } from './driveSearch';
import { downloadFile } from './driveDownload';
import { getServices } from '../agent/utils/serviceLoader';
import { get as getFromCache, set as setInCache, CacheKeys, CacheTTL } from '../../utils/cache';
import logger from '../../utils/logger';

// Re-export DriveFile for convenience
export { DriveFile };

/**
 * Text extraction result
 */
export interface ExtractionResult {
    success: boolean;
    text?: string;
    error?: string;
}

/**
 * RAG search result
 */
export interface RAGResult {
    file: DriveFile;
    extractedText?: string;
    relevance?: string;
}

/**
 * Extract text from document using Gemini
 */
export async function extractTextFromDocument(fileId: string, mimeType: string): Promise<ExtractionResult> {
    try {
        // Check cache first
        const cacheKey = CacheKeys.driveFileAnalysis(fileId);
        const cached = getFromCache<ExtractionResult>(cacheKey);
        if (cached) {
            return cached;
        }

        // Download file
        const downloadResult = await downloadFile(fileId, mimeType);
        if (!downloadResult.success || !downloadResult.data) {
            return {
                success: false,
                error: downloadResult.error || 'Failed to download file'
            };
        }

        const { geminiService } = getServices();

        // Handle images
        if (mimeType.startsWith('image/')) {
            const base64 = downloadResult.data.toString('base64');
            const result = await geminiService.analyzeImageWithText(
                'תאר את התוכן של התמונה בפירוט. אם יש טקסט בתמונה, העתק אותו במלואו.',
                base64
            ) as { text?: string; error?: string };

            const finalResult: ExtractionResult = {
                success: true,
                text: result.text || result.error || 'לא ניתן לחלץ טקסט מהתמונה'
            };

            setInCache(cacheKey, finalResult, CacheTTL.LONG);
            return finalResult;
        }

        // Handle PDFs and documents
        if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
            const model = genAI.getGenerativeModel({ model: 'gemini-3-pro-preview' });

            const base64Pdf = downloadResult.data.toString('base64');
            const prompt =
                'זהו קובץ מסמך/שרטוט (PDF). ' +
                'תאר באופן מפורט וברור את התוכן שלו, את המבנה, האלמנטים המרכזיים, הטקסטים החשובים, ' +
                'וכל דבר שרלוונטי להבנת השרטוט או התכנית. ' +
                'ענה בעברית ברורה, עם bullet points מסודרים.';

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: mimeType || 'application/pdf', data: base64Pdf } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { responseModalities: ['TEXT'], temperature: 0.4 } as any
            } as any);

            const response = result.response as any;
            let text = '';

            if (response?.candidates?.length > 0) {
                const cand = response.candidates[0];
                if (cand.content?.parts) {
                    for (const part of cand.content.parts) {
                        if (part.text) text += part.text;
                    }
                }
            }

            if (!text.trim()) {
                const errorResult: ExtractionResult = {
                    success: false,
                    error: 'לא הצלחתי לחלץ תיאור מה-PDF באמצעות Gemini'
                };
                setInCache(cacheKey, errorResult, CacheTTL.MEDIUM);
                return errorResult;
            }

            const finalResult: ExtractionResult = { success: true, text: text.trim() };
            setInCache(cacheKey, finalResult, CacheTTL.LONG);
            return finalResult;
        }

        const unsupportedResult: ExtractionResult = {
            success: false,
            error: `סוג קובץ לא נתמך: ${mimeType}`
        };
        setInCache(cacheKey, unsupportedResult, CacheTTL.MEDIUM);
        return unsupportedResult;
    } catch (error) {
        const err = error as Error;
        logger.error('❌ Error extracting text from document:', { error: err.message, stack: err.stack });
        return { success: false, error: `שגיאה בחילוץ טקסט: ${err.message}` };
    }
}

/**
 * Drawing-related keywords for intent detection
 */
const DRAWING_KEYWORDS = [
    'שרטוט', 'שרטוטים', 'שירטוט', 'שירטוטים',
    'סקיצה', 'סקיצות',
    'תכנית', 'תוכניות', 'תכניות',
    'blueprint', 'blueprints', 'drawing', 'drawings', 'diagram', 'diagrams', 'plan', 'plans'
];

/**
 * Stopwords to filter from search queries
 */
const STOPWORDS = new Set([
    'מה', 'איזה', 'אילו', 'יש', 'ב', 'על', 'של', 'לו', 'לה', 'עם', 'לגבי', 'אותו', 'אותה',
    'the', 'a', 'an', 'of', 'in', 'on', 'about', 'for', 'my', 'his', 'her', 'their', 'your'
]);

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
    results?: RAGResult[];
    error?: string;
}> {
    try {
        const raw = (searchQuery || '').toLowerCase();
        const hasDrawingIntent = DRAWING_KEYWORDS.some(keyword => raw.includes(keyword));

        // Normalize query
        const tokens = raw.split(/\s+/).map(t => t.trim()).filter(t => t && !STOPWORDS.has(t));
        const normalizedQuery = tokens.join(' ');

        // Configure search based on intent
        const mimeTypeHint = hasDrawingIntent ? 'application/pdf' : undefined;
        const effectiveMaxFiles = hasDrawingIntent ? 1 : maxFiles;

        // Search for files
        let searchResult = await searchFiles({
            query: hasDrawingIntent ? '' : (normalizedQuery || searchQuery),
            folderId,
            maxResults: effectiveMaxFiles,
            mimeType: mimeTypeHint
        });

        // Fallback if no results
        if ((!searchResult.success || !searchResult.files?.length) && folderId) {
            logger.warn('⚠️ [Google Drive] Primary search returned 0 files, falling back', { folderId });

            searchResult = await searchFiles({ query: '', folderId, maxResults: 1, mimeType: mimeTypeHint });

            if (!searchResult.success || !searchResult.files?.length) {
                searchResult = await searchFiles({ query: '', folderId, maxResults: 1 });
            }
        }

        if (!searchResult.success || !searchResult.files?.length) {
            return { success: true, results: [] };
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
                    return { file, extractedText: undefined, relevance: 'failed' };
                }
            })
        );

        logger.info(`✅ [Google Drive] Extracted text from ${results.length} files`);
        return { success: true, results };
    } catch (error) {
        const err = error as Error;
        logger.error('❌ Error in searchAndExtractRelevantInfo:', { error: err.message, stack: err.stack });
        return { success: false, error: `שגיאה בחיפוש וחילוץ מידע: ${err.message}` };
    }
}
