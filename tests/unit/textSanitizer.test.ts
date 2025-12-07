
import { cleanAmazonPrefix } from '../../utils/textSanitizer';

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
});
