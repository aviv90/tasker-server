
import { isCommand, extractCommandPrompt } from '../../utils/commandUtils';

describe('commandUtils', () => {
    describe('isCommand', () => {
        it('should return true for valid commands', () => {
            expect(isCommand('# test')).toBe(true);
            expect(isCommand('# command prompt')).toBe(true);
            expect(isCommand('#   spaced')).toBe(true);
            expect(isCommand('# \nnewline')).toBe(true);
        });

        it('should return false for invalid commands', () => {
            expect(isCommand('test')).toBe(false);
            expect(isCommand('#test')).toBe(false); // No space
            expect(isCommand(' # test')).toBe(true); // Leading space handled by trim
            expect(isCommand('')).toBe(false);
            expect(isCommand(null)).toBe(false);
            expect(isCommand(undefined)).toBe(false);
        });

        it('should handle trimmed input inside isCommand', () => {
            // The implementation uses text.trim() before regex
            expect(isCommand(' # test ')).toBe(true);
            expect(isCommand('\n# test\n')).toBe(true);
        });
    });

    describe('extractCommandPrompt', () => {
        it('should clean prompt correctly', () => {
            expect(extractCommandPrompt('# test')).toBe('test');
            expect(extractCommandPrompt('#   test  ')).toBe('test');
            expect(extractCommandPrompt(' # test ')).toBe('test');
        });

        it('should return empty string for null/undefined', () => {
            // @ts-ignore
            expect(extractCommandPrompt(null)).toBe('');
            // @ts-ignore
            expect(extractCommandPrompt(undefined)).toBe('');
        });
    });
});
