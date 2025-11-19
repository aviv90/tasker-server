/**
 * Error formatting utilities
 */

/**
 * Ensure user-facing error messages consistently include the red X emoji.
 * Keeps the original text "as-is" after the prefix.
 * @param {string} message
 * @returns {string}
 */
function formatErrorMessage(message) {
  if (!message || typeof message !== 'string') {
    return '❌ שגיאה לא ידועה';
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return '❌ שגיאה לא ידועה';
  }

  if (trimmed.startsWith('❌')) {
    return trimmed;
  }

  return `❌ ${trimmed}`;
}

module.exports = {
  formatErrorMessage
};

