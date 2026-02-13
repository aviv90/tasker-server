
import { cleanJsonWrapper, cleanMediaDescription } from './textSanitizer';

describe('Text Sanitizer', () => {
    describe('cleanJsonWrapper', () => {
        it('should remove JSON wrapper and return clean text', () => {
            const input = '```json\n{"text": "Hello world"}\n```';
            expect(cleanJsonWrapper(input)).toBe('Hello world');
        });

        it('should return empty string for action JSON (The Bug)', () => {
            const input = '{ "action": "create_image", "action_input": "{\\"prompt\\": \\"A humorous cartoon\\"}" }';
            // Current behavior (bug): returns the raw JSON because it can't find content
            // Expected after fix: should return empty string
            // We write the test to FAIL first (expecting the bug) or pass if we check for the bug

            // For now, let's assert what we WANT it to be, so it fails, confirming reproduction
            expect(cleanJsonWrapper(input)).toBe('');
        });

        it('should return empty string for tool use JSON', () => {
            const input = '{ "tool": "code_interpreter", "args": { "code": "print(1)" } }';
            expect(cleanJsonWrapper(input)).toBe('');
        });
    });

    describe('cleanMediaDescription', () => {
        it('should clean action JSON even if malformed or wrapper fails', () => {
            const input = 'Here is the image { "action": "create_image", "action_input": "..." }';
            // Should strip the action part
            expect(cleanMediaDescription(input)).toBe('Here is the image');
        });

        it('should handle the specific user reported case', () => {
            const input = '{ "action": "create_image", "action_input": "{\\"prompt\\": \\"A humorous cartoon illustration of a man looking pale and overwhelmed, holding his stomach in distress, with several empty shot glasses labeled \'Chasers\' on a table in the background. He is rushing toward a bathroom door. Comedic and expressive style.\\"}"';
            expect(cleanMediaDescription(input)).toBe('');
        });

        it('should strip internal headers like Image: or Caption:', () => {
            const input = "Image: A beautiful sunset over the mountains.";
            expect(cleanMediaDescription(input)).toBe("A beautiful sunset over the mountains");
        });

        it('should strip revised_prompt header', () => {
            const input = "revised_prompt: A futuristic city with flying cars";
            expect(cleanMediaDescription(input)).toBe("A futuristic city with flying cars");
        });
    });
});
