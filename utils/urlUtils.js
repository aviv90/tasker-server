/**
 * URL Utilities
 * 
 * Centralized logic for determining server URLs across the application.
 * This ensures consistency between all services and endpoints.
 */

/**
 * Get the server's base URL
 * @param {Object} req - Express request object (optional)
 * @returns {string} - The base URL of the server
 */
function getServerBaseUrl(req = null) {
    // If we have a request object, use it (most reliable)
    if (req && req.protocol && req.get) {
        const host = req.get('host');
        if (host) {
            return `${req.protocol}://${host}`;
        }
    }
    
    // Check for explicitly set SERVER_URL
    if (process.env.SERVER_URL) {
        return process.env.SERVER_URL;
    }
    
    // Check for PUBLIC_URL (often used in some deployments)
    if (process.env.PUBLIC_URL) {
        return process.env.PUBLIC_URL;
    }
    
    // Try to detect Heroku URL automatically
    if (process.env.HEROKU_APP_NAME) {
        return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
    }
    
    // Production fallback (update this when deploying to different servers)
    if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️ No SERVER_URL set in production environment');
        return 'https://tasker-server-eb22b09c778f.herokuapp.com';
    }
    
    // Development fallback
    return 'http://localhost:3000';
}

/**
 * Get a full URL for a static file
 * @param {string} filename - The filename to serve
 * @param {Object} req - Express request object (optional)
 * @returns {string} - Full URL to the static file
 */
function getStaticFileUrl(filename, req = null) {
    const baseUrl = getServerBaseUrl(req);
    return `${baseUrl}/static/${filename}`;
}

/**
 * Get a full URL for an API endpoint
 * @param {string} endpoint - The API endpoint path (e.g., '/api/music/callback')
 * @param {Object} req - Express request object (optional)
 * @returns {string} - Full URL to the API endpoint
 */
function getApiUrl(endpoint, req = null) {
    const baseUrl = getServerBaseUrl(req);
    // Ensure endpoint starts with /
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${baseUrl}${cleanEndpoint}`;
}

module.exports = {
    getServerBaseUrl,
    getStaticFileUrl,
    getApiUrl
};
