/**
 * Service Loader
 * Lazy-loaded services to avoid circular dependencies and improve startup time
 */

let geminiService, openaiService, grokService, greenApiService;

/**
 * Get services (lazy-loaded)
 */
function getServices() {
  if (!geminiService) geminiService = require('../../geminiService');
  if (!openaiService) openaiService = require('../../openai');
  if (!grokService) grokService = require('../../grokService');
  if (!greenApiService) greenApiService = require('../../greenApiService');
  return { geminiService, openaiService, grokService, greenApiService };
}

module.exports = {
  getServices
};

