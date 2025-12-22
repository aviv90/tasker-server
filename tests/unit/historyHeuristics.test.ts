
import { shouldSkipHistory } from '../../services/agentRouter';

describe('History Heuristics', () => {
    describe('shouldSkipHistory', () => {

        // --- Positive Cases (Should Skip) ---

        it('should skip history for basic English creation commands', () => {
            expect(shouldSkipHistory('Draw a cat')).toBe(true);
            expect(shouldSkipHistory('Create an image of a dog')).toBe(true);
            expect(shouldSkipHistory('Generate a video of waves')).toBe(true);
            expect(shouldSkipHistory('Make a song about coding')).toBe(true);
        });

        it('should skip history for basic Hebrew creation commands', () => {
            expect(shouldSkipHistory('צייר חתול')).toBe(true);
            expect(shouldSkipHistory('צור תמונה של כלב')).toBe(true);
            expect(shouldSkipHistory('הכן סרטון של גלים')).toBe(true);
            expect(shouldSkipHistory('תמונה של שפן')).toBe(true); // Noun only
        });

        it('should skip history with conversational prefixes (English)', () => {
            expect(shouldSkipHistory('Please draw a cat')).toBe(true);
            expect(shouldSkipHistory('Can you create an image?')).toBe(true);
            expect(shouldSkipHistory('Hey, make a video')).toBe(true);
        });

        it('should skip history with conversational prefixes (Hebrew)', () => {
            expect(shouldSkipHistory('תצייר לי שפן')).toBe(true); // Future tense
            expect(shouldSkipHistory('אתה יכול לצייר חתול?')).toBe(true);
            expect(shouldSkipHistory('בבקשה תכין תמונה')).toBe(true);
            expect(shouldSkipHistory('ג\'נרט לי בבקשה')).toBe(true);
        });

        it('should skip history for specific "Rabbit" case', () => {
            expect(shouldSkipHistory('צייר שפן')).toBe(true);
            expect(shouldSkipHistory('תצייר שפן')).toBe(true);
            expect(shouldSkipHistory('תמונה של שפן')).toBe(true);
        });

        // --- Negative Cases (Should NOT Skip - Need Context) ---

        it('should NOT skip history when context is referenced (English)', () => {
            expect(shouldSkipHistory('Draw it again')).toBe(false);
            expect(shouldSkipHistory('Change this to blue')).toBe(false);
            expect(shouldSkipHistory('Make the previous one bigger')).toBe(false);
            expect(shouldSkipHistory('Edit that')).toBe(false);
        });

        it('should NOT skip history when context is referenced (Hebrew)', () => {
            expect(shouldSkipHistory('צייר את זה שוב')).toBe(false);
            expect(shouldSkipHistory('תשנה את זה לכחול')).toBe(false);
            expect(shouldSkipHistory('תכין את הקודם גדול יותר')).toBe(false);
            expect(shouldSkipHistory('תערוך את זה')).toBe(false);
            expect(shouldSkipHistory('במקום חתול תעשה כלב')).toBe(false);
        });

        it('should NOT skip for non-creation commands (ambiguous)', () => {
            expect(shouldSkipHistory('Hello')).toBe(false);
            expect(shouldSkipHistory('What is your name?')).toBe(false);
            expect(shouldSkipHistory('מה קורה?')).toBe(false);
        });
    });
});
