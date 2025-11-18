/**
 * Universal error handler for user-friendly error messages
 * Maps error types and HTTP status codes to user-friendly explanations
 */

/**
 * Map database error messages to user-friendly messages
 * This prepares for multi-language support by using error keys
 * @param {string} errorMsg - The raw error message from the backend
 * @returns {string} User-friendly error message or the original message if no mapping exists
 */
function mapDatabaseErrorToUserMessage(errorMsg) {
  // Error key mappings - can be replaced with i18n keys later
  // Keys are the core error message (after "Policy error:" or "Permission denied:" prefix)
  const errorMappings = {
    'the profile is associated with an event. Please remove the profile from all events first.': 
      'Cannot delete profile: This profile is associated with one or more events. Please remove it from all events first.',
    'profile not found': 
      'Cannot duplicate profile: Profile not found.',
    'event not found': 
      'Cannot duplicate profile: One or more associated events could not be accessed.',
  };
  
  // Normalize the error message by removing common prefixes
  const normalizedMsg = errorMsg
    .replace(/^(Policy error|Permission denied):\s*/i, '')
    .trim();
  
  // Check for exact match on normalized message
  if (errorMappings[normalizedMsg]) {
    return errorMappings[normalizedMsg];
  }
  
  // Check for partial matches (for cases where the message might have slight variations)
  for (const [dbError, userMessage] of Object.entries(errorMappings)) {
    if (normalizedMsg.includes(dbError) || dbError.includes(normalizedMsg)) {
      return userMessage;
    }
  }
  
  return null; // No mapping found
}

/**
 * Get user-friendly error explanation from error object
 * @param {Error|Object} error - The error object (can be axios error or generic error)
 * @returns {string} User-friendly error explanation
 */
export function getErrorExplanation(error) {
  // PRIORITY 1: Check for backend error message in response FIRST
  // This allows specific error messages to override generic status code messages
  if (error?.response?.data?.error) {
    let errorMsg = error.response.data.error;
    
    // First, try to map to user-friendly message
    const userFriendlyMsg = mapDatabaseErrorToUserMessage(errorMsg);
    if (userFriendlyMsg) {
      return userFriendlyMsg;
    }
    
    // Extract meaningful message from policy errors
    // Pattern: "Database policy error: Policy error: Invalid images count limit"
    // Extract: "Invalid images count limit"
    if (errorMsg.includes('Database policy error')) {
      const policyMatch = errorMsg.match(/Policy error:\s*(.+)$/);
      if (policyMatch && policyMatch[1]) {
        errorMsg = policyMatch[1].trim();
      } else {
        // Fallback: remove redundant prefixes
        errorMsg = errorMsg.replace(/^Database policy error:\s*/, '').replace(/^Policy error:\s*/, '');
      }
    }
    
    // Extract meaningful message from other nested errors
    // Pattern: "Permission denied: [message]"
    if (errorMsg.startsWith('Permission denied:')) {
      errorMsg = errorMsg.replace(/^Permission denied:\s*/, '');
    }
    
    return errorMsg;
  }
  
  // PRIORITY 2: Check for HTTP status code (only if no specific error message)
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
  
  // PRIORITY 3: Check for network errors
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
  
  // PRIORITY 4: Fallback to error message if available
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




