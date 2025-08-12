const { sanitizeText } = require('../utils/textSanitizer');

/**
 * Custom JSON parser middleware that handles problematic characters
 */
function safeJsonParser() {
    return (req, res, next) => {
        if (!req.headers['content-type'] || !req.headers['content-type'].includes('application/json')) {
            return next();
        }

        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                // First attempt: try parsing as-is
                try {
                    req.body = JSON.parse(body);
                    return next();
                } catch (initialError) {
                    console.log('❌ Initial JSON parsing failed:', initialError.message);
                    // JSON parsing failed, try to fix it
                }
                
                // Second attempt: fix unescaped quotes in string values only
                let cleanBody = body;
                
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
                
                // Try parsing the cleaned version
                try {
                    req.body = JSON.parse(cleanBody);
                    console.log('✅ JSON fixed and parsed successfully');
                    return next();
                } catch (secondError) {
                    console.log('❌ Second attempt failed:', secondError.message);
                    // Still failed, try more targeted approach
                }
                
                // Third attempt: Handle specific Hebrew quote characters
                let hebrewFixed = body;
                
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
                
                try {
                    req.body = JSON.parse(hebrewFixed);
                    console.log('✅ JSON with Hebrew quotes fixed and parsed successfully');
                    return next();
                } catch (finalError) {
                    console.error('❌ All JSON parsing attempts failed');
                    console.error('❌ Original body:', body);
                    console.error('❌ Final error:', finalError.message);
                    
                    return res.status(400).json({
                        status: 'error',
                        error: 'Invalid JSON format. Please escape quotes in your text with \\" or use single quotes instead.'
                    });
                }
                
            } catch (error) {
                console.error('❌ Unexpected error in JSON parser:', error.message);
                return res.status(500).json({
                    status: 'error',
                    error: 'Server error processing request'
                });
            }
        });
        
        req.on('error', (err) => {
            console.error('❌ Request reading error:', err.message);
            return res.status(400).json({
                status: 'error',
                error: 'Error reading request data'
            });
        });
    };
}

module.exports = safeJsonParser;