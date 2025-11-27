/**
 * Date utility functions for handling timestamps from the database.
 * 
 * The database stores timestamps in Israel timezone (Asia/Jerusalem) as naive datetimes.
 * These functions parse and format them without timezone conversion.
 */

/**
 * Parse a database timestamp string (format: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS.microseconds")
 * Returns a Date object representing the time in Israel timezone (no conversion applied).
 * 
 * @param {string} timestampString - Timestamp string from database
 * @returns {Date|null} Date object or null if parsing fails
 */
export function parseDatabaseTimestamp(timestampString) {
  if (!timestampString) return null;
  
  // Handle GMT format from Flask JSON serialization (e.g., "Sun, 08 Jun 2025 18:36:43 GMT")
  // Flask converts PostgreSQL TIMESTAMP to GMT when serializing to JSON
  // We need to parse it as GMT and then adjust to Israel timezone
  if (timestampString.includes('GMT') || timestampString.match(/^\w{3}, \d{2} \w{3} \d{4}/)) {
    // Parse as GMT/UTC
    const gmtDate = new Date(timestampString);
    if (Number.isNaN(gmtDate.getTime())) {
      return null;
    }
    
    // Get the GMT time components
    const gmtYear = gmtDate.getUTCFullYear();
    const gmtMonth = gmtDate.getUTCMonth();
    const gmtDay = gmtDate.getUTCDate();
    const gmtHours = gmtDate.getUTCHours();
    const gmtMinutes = gmtDate.getUTCMinutes();
    const gmtSeconds = gmtDate.getUTCSeconds();
    const gmtMs = gmtDate.getUTCMilliseconds();
    
    // Create a date in local timezone with the GMT time values
    // This treats the GMT time as if it were already in Israel timezone
    // (since the database stores Israel time, but Flask sends it as GMT)
    const localDate = new Date(gmtYear, gmtMonth, gmtDay, gmtHours, gmtMinutes, gmtSeconds, gmtMs);
    
    return localDate;
  }
  
  // Handle ISO format with timezone (e.g., "2025-11-14T18:05:01.965498+00:00")
  if (timestampString.includes('T') || timestampString.includes('+') || timestampString.includes('Z')) {
    // Has timezone info - parse normally
    const date = new Date(timestampString);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  
  // Handle database format: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS.microseconds"
  // Parse manually to avoid timezone conversion
  const match = timestampString.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?/);
  if (!match) {
    // Fallback to standard Date parsing
    const date = new Date(timestampString);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  
  const [, year, month, day, hour = '0', minute = '0', second = '0', microsecond = '0'] = match;
  
  // Create date in local timezone (since database stores in Israel time and user is in Israel)
  // This ensures no timezone conversion happens
  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // Month is 0-indexed
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10),
    parseInt(microsecond.substring(0, 3), 10) || 0 // Convert microseconds to milliseconds
  );
  
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a database timestamp for display (format: "DD-MM-YYYY HH:MM:SS")
 * @param {string|Date} value - Timestamp string from database or Date object
 * @returns {string} Formatted date string or 'Unknown' if invalid
 */
export function formatDateTime(value) {
  if (!value) return 'Unknown';
  
  const date = typeof value === 'string' ? parseDatabaseTimestamp(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format time only (format: "HH:MM" with AM/PM)
 * @param {string|Date} value - Timestamp string from database or Date object
 * @returns {string} Formatted time string or empty string if invalid
 */
export function formatTime(value) {
  if (!value) return '';
  
  const date = typeof value === 'string' ? parseDatabaseTimestamp(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }
  
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format date only (format: "Mon, Jan 1, 2025")
 * @param {string|Date} value - Timestamp string from database or Date object
 * @returns {string} Formatted date string or empty string if invalid
 */
export function formatDate(value) {
  if (!value) return '';
  
  const date = typeof value === 'string' ? parseDatabaseTimestamp(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format date and time with locale string (format: "Jan 1, 2025, 3:00 PM")
 * @param {string|Date} value - Timestamp string from database or Date object
 * @returns {string} Formatted date string or 'N/A' if invalid
 */
export function formatDateTimeLocale(value) {
  if (!value) return 'N/A';
  
  const date = typeof value === 'string' ? parseDatabaseTimestamp(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }
  
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format date as DD-MM-YYYY
 * @param {string|Date} value - Timestamp string from database or Date object
 * @returns {string} Formatted date string or empty string if invalid
 */
export function formatDateDDMMYYYY(value) {
  if (!value) return '';
  
  const date = typeof value === 'string' ? parseDatabaseTimestamp(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

