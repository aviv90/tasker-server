/**
 * General text utilities
 */

function detectLanguage(text) {
    // Simple Hebrew detection
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'hebrew' : 'english';
}

module.exports = {
    detectLanguage
};