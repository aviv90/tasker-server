const safeJsonParser = require('./middleware/safeJsonParser');
const express = require('express');

// Test cases
const testCases = [
    // Case 1: The problematic Hebrew text from your error
    `{"prompt": "תמונת יום הולדת עם טקסט "מזל טוב ארשקו""}`,
    
    // Case 2: English with quotes
    `{"prompt": "Create a birthday image with text "Happy Birthday John""}`,
    
    // Case 3: Mixed quotes
    `{"prompt": "Text with 'single' and "double" quotes"}`,
    
    // Case 4: Hebrew quotes (״)
    `{"prompt": "טקסט עם ציטוט ״שלום עולם״ בעברית"}`,
    
    // Case 5: Complex nested quotes
    `{"prompt": "He said "She told me 'Hello world' yesterday" to everyone"}`,
    
    // Case 6: Valid JSON (should work normally)
    `{"prompt": "Normal text without any problematic quotes"}`
];

console.log('🧪 Testing JSON Parser with problematic inputs...\n');

function testJsonParsing(jsonString, testName) {
    console.log(`\n📝 ${testName}:`);
    console.log(`Input: ${jsonString}`);
    
    try {
        // First attempt: try parsing as-is
        try {
            const result = JSON.parse(jsonString);
            console.log('✅ Parsed successfully (first attempt):', result);
            return true;
        } catch (initialError) {
            console.log('❌ First attempt failed, trying fixes...');
        }
        
        // Second attempt: fix unescaped quotes in string values only
        let cleanBody = jsonString;
        
        // Strategy: Find string values and escape quotes inside them
        cleanBody = cleanBody.replace(
            /"([^"]*?)"(\s*:\s*)"([^"]*?)"([^"]*?)"([^"]*)"/g,
            (match, key, colon, start, middle, end) => {
                // This looks like: "key": "start"middle"end"
                // We want to escape the internal quotes
                return `"${key}"${colon}"${start}\\"${middle}\\"${end}"`;
            }
        );
        
        // Also handle cases where there are multiple quotes in the value
        cleanBody = cleanBody.replace(
            /"([^"]*?)"(\s*:\s*)"([^"]*?)"([^"]*?)"/g,
            (match, key, colon, value, extra) => {
                // If extra text exists after quotes, it means broken JSON
                if (extra && !extra.match(/^\s*[,}]/)) {
                    return `"${key}"${colon}"${value}\\"${extra}"`;
                }
                return match;
            }
        );
        
        console.log(`After general fixes: ${cleanBody}`);
        
        try {
            const result = JSON.parse(cleanBody);
            console.log('✅ Parsed successfully (after general fixes):', result);
            return true;
        } catch (secondError) {
            console.log('❌ Second attempt failed, trying Hebrew quote fixes...');
        }
        
        // Third attempt: Handle specific Hebrew quote characters
        let hebrewFixed = jsonString;
        
        // Replace Hebrew quotes only inside string values
        hebrewFixed = hebrewFixed.replace(
            /("prompt"\s*:\s*"[^"]*?)״([^"]*?)״([^"]*?")/g,
            '$1\\"$2\\"$3'
        );
        
        hebrewFixed = hebrewFixed.replace(
            /("text"\s*:\s*"[^"]*?)״([^"]*?)״([^"]*?")/g,
            '$1\\"$2\\"$3'
        );
        
        // Handle English smart quotes in string values
        hebrewFixed = hebrewFixed.replace(
            /("prompt"\s*:\s*"[^"]*?)"([^"]*?)"([^"]*?")/g,
            '$1\\"$2\\"$3'
        );
        
        hebrewFixed = hebrewFixed.replace(
            /("text"\s*:\s*"[^"]*?)"([^"]*?)"([^"]*?")/g,
            '$1\\"$2\\"$3'
        );
        
        console.log(`After Hebrew fixes: ${hebrewFixed}`);
        
        try {
            const result = JSON.parse(hebrewFixed);
            console.log('✅ Parsed successfully (Hebrew fixes):', result);
            return true;
        } catch (finalError) {
            console.log('❌ All attempts failed:', finalError.message);
            return false;
        }
        
    } catch (error) {
        console.log('❌ Unexpected error:', error.message);
        return false;
    }
}

// Run all tests
let passCount = 0;
testCases.forEach((testCase, index) => {
    if (testJsonParsing(testCase, `Test ${index + 1}`)) {
        passCount++;
    }
});

console.log(`\n🎯 Results: ${passCount}/${testCases.length} tests passed`);

if (passCount === testCases.length) {
    console.log('🎉 All tests passed! The JSON parser should handle the problematic cases.');
} else {
    console.log('⚠️  Some tests failed. The parser may need more improvements.');
}

// Test the exact error case mentioned by the user
console.log('\n🎯 Testing the exact error case:');
const exactCase = `{"prompt": "תמונת יום הולדת עם טקסט "מזל טוב ארשקו""}`;
console.log('Exact input:', exactCase);

try {
    JSON.parse(exactCase);
    console.log('✅ Parsed without issues');
} catch (error) {
    console.log(`❌ Error at position ${error.message.match(/position (\d+)/)?.[1] || 'unknown'}:`, error.message);
    
    // Show the character at the error position
    const position = parseInt(error.message.match(/position (\d+)/)?.[1] || '0');
    if (position < exactCase.length) {
        console.log(`Character at position ${position}: "${exactCase[position]}" (code: ${exactCase.charCodeAt(position)})`);
        console.log(`Context: ...${exactCase.substring(Math.max(0, position - 10), position + 10)}...`);
    }
}
