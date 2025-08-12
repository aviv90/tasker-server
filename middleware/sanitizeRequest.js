const { sanitizeObject } = require('../utils/textSanitizer');

/**
 * Middleware to sanitize request body and query parameters
 */
function sanitizeRequest(req, res, next) {
    try {
        // Sanitize request body
        if (req.body && typeof req.body === 'object') {
            req.body = sanitizeObject(req.body);
        }
        
        // Sanitize query parameters
        if (req.query && typeof req.query === 'object') {
            req.query = sanitizeObject(req.query);
        }
        
        // Sanitize URL parameters
        if (req.params && typeof req.params === 'object') {
            req.params = sanitizeObject(req.params);
        }
        
        next();
    } catch (error) {
        console.error('❌ Request sanitization error:', error.message);
        return res.status(400).json({ 
            status: 'error', 
            error: 'Invalid request data: ' + error.message 
        });
    }
}

module.exports = sanitizeRequest;
