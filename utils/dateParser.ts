/**
 * Date Parser Utility
 * 
 * Handles parsing of natural language date/time expressions.
 * Supports Hebrew and English formats.
 * Implemented using native Date API to avoid external dependencies.
 */

import logger from './logger';

export class DateParser {
    /**
     * Parse a natural language date string into a Date object
     */
    static parse(dateStr: string): Date | null {
        if (!dateStr) return null;

        const now = new Date();
        const cleanStr = dateStr.trim().toLowerCase();

        // Relative time (minutes)
        const minutesMatch = cleanStr.match(/(\d+)\s*(?:minutes?|mins?|דקות|דקה)/);
        if (minutesMatch && minutesMatch[1]) {
            return this.applySmartYearCorrection(new Date(now.getTime() + parseInt(minutesMatch[1]) * 60000));
        }

        // Relative time (hours)
        const hoursMatch = cleanStr.match(/(\d+)\s*(?:hours?|hrs?|שעות|שעה)/);
        if (hoursMatch && hoursMatch[1]) {
            return this.applySmartYearCorrection(new Date(now.getTime() + parseInt(hoursMatch[1]) * 3600000));
        }

        // Relative days
        if (cleanStr.includes('tomorrow') || cleanStr.includes('מחר')) {
            const date = new Date(now);
            date.setDate(date.getDate() + 1);

            // Check for specific time "tomorrow at 10"
            const timeMatch = cleanStr.match(/(?:at|ב-)?\s*(\d{1,2})(?::(\d{2}))?/);
            if (timeMatch && timeMatch[1]) {
                date.setHours(parseInt(timeMatch[1]));
                date.setMinutes(timeMatch[2] ? parseInt(timeMatch[2]) : 0);
                date.setSeconds(0);
                date.setMilliseconds(0);
            } else {
                // Default to 9:00 AM if no time specified
                date.setHours(9, 0, 0, 0);
            }
            return this.applySmartYearCorrection(date);
        }

        if (cleanStr.includes('today') || cleanStr.includes('היום')) {
            const date = new Date(now);
            const timeMatch = cleanStr.match(/(?:at|ב-)?\s*(\d{1,2})(?::(\d{2}))?/);
            if (timeMatch && timeMatch[1]) {
                date.setHours(parseInt(timeMatch[1]));
                date.setMinutes(timeMatch[2] ? parseInt(timeMatch[2]) : 0);
                date.setSeconds(0);
                date.setMilliseconds(0);

                // If time passed, assume tomorrow? No, user said today.
            }
            return this.applySmartYearCorrection(date);
        }

        // Days of week
        const days = [
            { en: 'sunday', he: 'ראשון', idx: 0 },
            { en: 'monday', he: 'שני', idx: 1 },
            { en: 'tuesday', he: 'שלישי', idx: 2 },
            { en: 'wednesday', he: 'רביעי', idx: 3 },
            { en: 'thursday', he: 'חמישי', idx: 4 },
            { en: 'friday', he: 'שישי', idx: 5 },
            { en: 'saturday', he: 'שבת', idx: 6 }
        ];

        for (const day of days) {
            if (cleanStr.includes(day.en) || cleanStr.includes(day.he)) {
                const date = new Date(now);
                const currentDay = date.getDay();
                const targetDay = day.idx;
                let daysToAdd = targetDay - currentDay;
                if (daysToAdd <= 0) daysToAdd += 7; // Next occurrence

                date.setDate(date.getDate() + daysToAdd);

                const timeMatch = cleanStr.match(/(?:at|ב-)?\s*(\d{1,2})(?::(\d{2}))?/);
                if (timeMatch && timeMatch[1]) {
                    date.setHours(parseInt(timeMatch[1]));
                    date.setMinutes(timeMatch[2] ? parseInt(timeMatch[2]) : 0);
                    date.setSeconds(0);
                    date.setMilliseconds(0);
                } else {
                    date.setHours(9, 0, 0, 0);
                }
                return this.applySmartYearCorrection(date);
            }
        }

        // Absolute dates (ISO or similar)
        let processedTimeStr = dateStr;
        // If the time string doesn't have a timezone offset (Z or +HH:mm or -HH:mm), assume Israel time
        if (!processedTimeStr.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(processedTimeStr)) {
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Jerusalem',
                    timeZoneName: 'longOffset'
                }).formatToParts(new Date());

                const offsetPart = parts.find(p => p.type === 'timeZoneName');
                if (offsetPart && offsetPart.value.includes('GMT')) {
                    const offset = offsetPart.value.replace('GMT', '').trim(); // e.g., "+03:00"
                    processedTimeStr += offset;
                } else {
                    processedTimeStr += '+02:00'; // Fallback
                }
            } catch (e) {
                processedTimeStr += '+02:00'; // Fallback
            }
        }

        const isoDate = new Date(processedTimeStr);
        if (!isNaN(isoDate.getTime())) {
            return this.applySmartYearCorrection(isoDate);
        }

        return null;
    }

    /**
     * Apply "Smart Year Correction" to a date.
     * If the date is in the past (with a buffer), check if adding 1 year makes it a valid future date.
     */
    static applySmartYearCorrection(date: Date): Date {
        const now = new Date();
        // Allow a buffer of 2 minutes for processing time
        const nowWithBuffer = new Date(now.getTime() - 120000);

        if (date < nowWithBuffer) {
            const nextYearDate = new Date(date);
            nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);

            // If adding a year makes it future (and not too far, e.g. < 1.5 years from now), use it
            const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000 * 1.5);

            if (nextYearDate > nowWithBuffer && nextYearDate < oneYearFromNow) {
                logger.info(`🧠 [DateParser] Auto-corrected past date ${date.toISOString()} to next year ${nextYearDate.toISOString()}`);
                return nextYearDate;
            }
        }

        return date;
    }

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
