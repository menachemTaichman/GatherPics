/**
 * Universal error handler for user-friendly error messages
 * Maps error types and HTTP status codes to user-friendly explanations
 */

/**
 * Get user-friendly error explanation from error object
 * @param {Error|Object} error - The error object (can be axios error or generic error)
 * @returns {string} User-friendly error explanation
 */
function getErrorExplanation(error) {
  // Check for HTTP status code (axios errors have response.status)
  const statusCode = error?.response?.status;
  
  if (statusCode) {
    switch (statusCode) {
      case 400:
        return 'invalid request';
      case 401:
        return 'authentication required';
      case 403:
        return 'permission denied';
      case 404:
        return 'not found';
      case 409:
        return 'conflict with existing data';
      case 413:
        return 'file too large';
      case 422:
        return 'validation failed';
      case 429:
        return 'too many requests';
      case 500:
        return 'server error';
      case 502:
        return 'service unavailable';
      case 503:
        return 'service temporarily unavailable';
      case 504:
        return 'request timeout';
      default:
        if (statusCode >= 400 && statusCode < 500) {
          return 'client error';
        } else if (statusCode >= 500) {
          return 'server error';
        }
    }
  }
  
  // Check for network errors
  if (error?.message) {
    const msg = error.message.toLowerCase();
    
    if (msg.includes('network') || msg.includes('fetch')) {
      return 'network error';
    }
    if (msg.includes('timeout')) {
      return 'request timeout';
    }
    if (msg.includes('abort')) {
      return 'request cancelled';
    }
  }
  
  // Check for backend error message in response
  if (error?.response?.data?.error) {
    return error.response.data.error;
  }
  
  // Fallback to error message if available
  if (error?.message) {
    return error.message;
  }
  
  return 'unknown error';
}

/**
 * Format error message for toast display
 * @param {string} action - Description of the failed action (e.g., "update favorites", "delete album")
 * @param {Error|Object} error - The error object
 * @returns {string} Formatted error message: "Failed to [action]: [explanation]"
 */
export function formatErrorMessage(action, error) {
  const explanation = getErrorExplanation(error);
  return `Failed to ${action}: ${explanation}`;
}

/**
 * Helper to handle errors consistently across the app
 * @param {string} action - Description of the failed action
 * @param {Error|Object} error - The error object
 * @param {Function} showToast - Toast function to display the error
 * @param {string} consolePrefix - Optional prefix for console.error (default: "Failed to [action]")
 */
export function handleError(action, error, showToast, consolePrefix = null) {
  // Log detailed error to console for debugging
  console.error(consolePrefix || `Failed to ${action}:`, error);
  
  // Show user-friendly message in toast
  const message = formatErrorMessage(action, error);
  showToast(message, 'error');
}

/**
 * Create a bound error handler with pre-configured showToast
 * @param {Function} showToast - Toast function
 * @returns {Function} Error handler function with showToast bound
 */
export function createErrorHandler(showToast) {
  return (action, error, consolePrefix = null) => {
    handleError(action, error, showToast, consolePrefix);
  };
}

