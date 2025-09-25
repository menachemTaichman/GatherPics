// Event resolver utility
// This file handles resolving event ids from event URLs

// Cache for event data to avoid repeated API calls
let eventCache = null;
let eventCacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get all events from the backend
 */
async function fetchEvents() {
  try {
    const response = await fetch('/api/events');
    if (!response.ok) {
      throw new Error('Failed to fetch events');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

/**
 * Resolve event id from event URL
 * @param {string} eventUrl - The event URL (e.g., 'noga-and-menachem-wedding')
 * @returns {string|null} - The event id or null if not found
 */
export async function resolveEventId(eventUrl) {
  // Check cache first
  const now = Date.now();
  if (eventCache && (now - eventCacheTimestamp) < CACHE_DURATION) {
    const event = eventCache.find(e => e.url === eventUrl);
    return event ? event.id : null;
  }

  // Fetch fresh data
  try {
    const events = await fetchEvents();
    eventCache = events;
    eventCacheTimestamp = now;
    
    const event = events.find(e => e.url === eventUrl);
    return event ? event.id : null;
  } catch (error) {
    console.error('Error resolving event id:', error);
    return null;
  }
}

/**
 * Get event data from event URL
 * @param {string} eventUrl - The event URL
 * @returns {object|null} - The event object or null if not found
 */
export async function getEventData(eventUrl) {
  // Check cache first
  const now = Date.now();
  if (eventCache && (now - eventCacheTimestamp) < CACHE_DURATION) {
    return eventCache.find(e => e.url === eventUrl) || null;
  }

  // Fetch fresh data
  try {
    const events = await fetchEvents();
    eventCache = events;
    eventCacheTimestamp = now;
    
    return events.find(e => e.url === eventUrl) || null;
  } catch (error) {
    console.error('Error getting event data:', error);
    return null;
  }
}

/**
 * Clear the event cache (useful for testing or when events change)
 */
export function clearEventCache() {
  eventCache = null;
  eventCacheTimestamp = 0;
}
