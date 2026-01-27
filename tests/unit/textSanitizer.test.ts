
import { cleanAmazonPrefix, cleanMultiStepText } from '../../utils/textSanitizer';

describe('textSanitizer', () => {
    describe('cleanAmazonPrefix', () => {
        it('should return empty string for null/undefined/empty input', () => {
            expect(cleanAmazonPrefix(null)).toBe('');
            expect(cleanAmazonPrefix(undefined)).toBe('');
            expect(cleanAmazonPrefix('')).toBe('');
        });

        it('should return text as-is if no Amazon prefix found', () => {
            const text = 'Just some random text without the amazon header.';
            expect(cleanAmazonPrefix(text)).toBe(text);
        });

        it('should return text from Amazon prefix onwards if found', () => {
            const prefix = '📦 *מוצר אקראי מאמזון:*';
            const content = '\n\nName: Something cool\nPrice: $50';
            const filler = 'Sure, here is the product you asked for:\n\n';

            const fullText = filler + prefix + content;
            const expected = prefix + content;

            expect(cleanAmazonPrefix(fullText)).toBe(expected);
        });

        it('should handle text that strictly starts with the prefix (no filler)', () => {
            const text = '📦 *מוצר אקראי מאמזון:* Here is the product';
            expect(cleanAmazonPrefix(text)).toBe(text);
        });

        it('should work with Hebrew filler', () => {
            const prefix = '📦 *מוצר אקראי מאמזון:*';
            const content = ' מוצר';
            const filler = 'בטח, הנה מוצר אקראי מאמזון: ';

            const fullText = filler + prefix + content;
            const expected = prefix + content;

            expect(cleanAmazonPrefix(fullText)).toBe(expected);
        });
    });

    describe('cleanMultiStepText', () => {

        it('should remove legacy bracket patterns [imageUrl:...]', () => {
            const input = 'Here is the image [imageUrl: https://example.com/img.png]';
            expect(cleanMultiStepText(input)).toBe('Here is the image');
        });

        it('should remove curly brace patterns {imageUrl:...}', () => {
            const input = 'Check this out {imageUrl: https://example.com/img.png}';
            expect(cleanMultiStepText(input)).toBe('Check this out');
        });

        it('should remove key-value patterns (imageUrl: ...)', () => {
            const input = 'Some text imageUrl: https://example.com/img.png';
            expect(cleanMultiStepText(input)).toBe('Some text');
        });

        it('should remove truncated curly brace artifacts', () => {
            // Case 1: Ends with quote
            expect(cleanMultiStepText('text {imageUrl: "')).toBe('text');
            // Case 2: Ends with value
            expect(cleanMultiStepText('text {imageUrl: http')).toBe('text');
            // Case 3: Just the key
            expect(cleanMultiStepText('text {imageUrl:')).toBe('text');
        });

        it('should remove truncated key-value artifacts', () => {
            expect(cleanMultiStepText('text imageUrl: "')).toBe('text');
            expect(cleanMultiStepText('text imageUrl:')).toBe('text');
        });

        it('should handle mixed Hebrew and artifacts', () => {
            const input = 'הנה איור יצירתי ומושגי המייצג את האירועים והאווירה של השיחה שלנו: {imageUrl: "';
            // Note: The colon might remain if it wasn't part of the artifact regex, but the artifact itself should be gone.
            // Let's check what the regex does. The textSanitizer replaces the artifact.
            // If the colon is outside, it stays. The user might want it gone too if it trails?
            // "cleanMultiStepText" usually doesn't strip trailing colons unless they are close to the artifact?
            // Let's verify standard behavior first.
            const result = cleanMultiStepText(input);
            expect(result).toContain('הנה איור יצירתי ומושגי');
            expect(result).not.toContain('{imageUrl');
        });

        it('should clean all media types (video, audio)', () => {
            // Using non-URL values to avoid interference from early URL cleaning
            const input = 'Video: {videoUrl: "vid"} Audio: [audioUrl: "aud"]';
            const cleaned = cleanMultiStepText(input);
            // Expect double space because replacements happen in place
            expect(cleaned).toBe('Video:  Audio:');
        });

        it('should preserve Audio: label', () => {
            expect(cleanMultiStepText('Audio:')).toBe('Audio:');
        });
    });
});
