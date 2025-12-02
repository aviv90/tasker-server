/**
 * Date Utilities
 * 
 * Helper functions for date parsing, formatting, and correction.
 */

import logger from './logger';

/**
 * Parse a time string into a Date object, handling timezone offsets and smart year correction.
 * @param timeStr - The time string (ISO 8601 preferred)
 * @returns The parsed Date object or null if invalid
 */
export function parseScheduledTime(timeStr: string): Date | null {
    let processedTimeStr = timeStr;

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

    const scheduledAt = new Date(processedTimeStr);

    if (isNaN(scheduledAt.getTime())) {
        return null;
    }

    return applySmartYearCorrection(scheduledAt);
}

/**
 * Apply "Smart Year Correction" to a date.
 * If the date is in the past (with a buffer), check if adding 1 year makes it a valid future date.
 * This handles cases where the LLM defaults to the current year for a date that has already passed (e.g. "May 15" in December).
 * @param date - The date to check
 * @returns The corrected date
 */
export function applySmartYearCorrection(date: Date): Date {
    const now = new Date();
    // Allow a buffer of 2 minutes for processing time
    const nowWithBuffer = new Date(now.getTime() - 120000);

    if (date < nowWithBuffer) {
        const nextYearDate = new Date(date);
        nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);

        // If adding a year makes it future (and not too far, e.g. < 1.5 years from now), use it
        const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000 * 1.5);

        if (nextYearDate > nowWithBuffer && nextYearDate < oneYearFromNow) {
            logger.info(`🧠 [DateUtils] Auto-corrected past date ${date.toISOString()} to next year ${nextYearDate.toISOString()}`);
            return nextYearDate;
        }
    }

    return date;
}
