const { sanitizeText, validateAndSanitizePrompt, sanitizeObject } = require('./utils/textSanitizer');

console.log('🧪 Testing text sanitization...\n');

// Test cases with problematic characters
const testCases = [
    'Simple prompt',
    'Prompt with "quotes" and \'single quotes\'',
    'Prompt with smart quotes: "hello" and "world"',
    'Prompt with em—dash and en–dash',
    'Prompt with\x00null\x01characters',
    'Prompt\u200Bwith\u200Czero\u200Dwidth\uFEFFcharacters',
    'Prompt\u00A0with\u00A0non-breaking\u00A0spaces',
    '   Prompt   with   excessive   whitespace   ',
    'Unicode normalization: café vs café',
    '\n\nPrompt with\n\nnewlines\n\n',
    'Very'.repeat(1000) + ' long prompt that should be truncated',
    '',
    null,
    undefined,
    123,
    {}
];

console.log('--- sanitizeText() tests ---');
testCases.forEach((test, index) => {
    const result = sanitizeText(test);
    console.log(`${index + 1}. Input: ${JSON.stringify(test)}`);
    console.log(`   Output: ${JSON.stringify(result)}`);
    console.log(`   Length: ${result?.length || 0}\n`);
});

console.log('--- validateAndSanitizePrompt() tests ---');
const validationTests = [
    'Valid prompt',
    'Prompt with "special" chars',
    '',
    '  ',
    'ab', // Too short
    null,
    123
];

validationTests.forEach((test, index) => {
    try {
        const result = validateAndSanitizePrompt(test);
        console.log(`${index + 1}. ✅ Input: ${JSON.stringify(test)} → Output: ${JSON.stringify(result)}`);
    } catch (error) {
        console.log(`${index + 1}. ❌ Input: ${JSON.stringify(test)} → Error: ${error.message}`);
    }
});

console.log('\n--- sanitizeObject() tests ---');
const objectTests = [
    { prompt: 'Simple prompt', type: 'text-to-image' },
    { prompt: 'Prompt with "quotes"', provider: 'openai' },
    { 'key with spaces': 'value with\u200Bzero-width' },
    { nested: { deep: { prompt: 'Deep "nested" prompt' } } },
    null,
    'string',
    123
];

objectTests.forEach((test, index) => {
    const result = sanitizeObject(test);
    console.log(`${index + 1}. Input: ${JSON.stringify(test)}`);
    console.log(`   Output: ${JSON.stringify(result)}\n`);
});

console.log('✅ Testing completed!');
