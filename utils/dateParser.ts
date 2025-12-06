/**
 * Date Parser Utility
 * 
 * Handles parsing of natural language date/time expressions.
 * Supports Hebrew and English formats.
 * Implemented using native Date API to avoid external dependencies.
 */


export class DateParser {
    /**
     * Format date for display
     */
    static format(date: Date, locale: 'he' | 'en' = 'he'): string {
        return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Asia/Jerusalem'
        }).format(date);
    }
}
