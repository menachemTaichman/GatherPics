// Event resolver utility
// This file handles resolving event ids from event URLs

// Cache for event data to avoid repeated API calls
let eventCache = new Map(); // Map<eventUrl, eventData>
let eventCacheTimestamp = new Map(); // Map<eventUrl, timestamp>
let inFlightRequests = new Map(); // Map<eventUrl, Promise> - for request deduplication
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch event data by URL from the backend (with request deduplication)
 * @param {string} eventUrl - The event URL
 * @returns {object|null} - The event object or null if not found
 */
async function fetchEventByUrl(eventUrl) {
  // Check if there's already a request in flight for this URL
  if (inFlightRequests.has(eventUrl)) {
    return inFlightRequests.get(eventUrl);
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      const response = await fetch(`/api/events/resolve?url=${encodeURIComponent(eventUrl)}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to resolve event URL');
      }
      const data = await response.json();
      return data.event;
    } catch (error) {
      console.error('Error fetching event:', error);
      return null;
    } finally {
      // Clean up in-flight request after completion
      inFlightRequests.delete(eventUrl);
    }
  })();

  // Store the promise so concurrent calls can reuse it
  inFlightRequests.set(eventUrl, requestPromise);
  
  return requestPromise;
}

/**
 * Resolve event id from event URL
 * @param {string} eventUrl - The event URL (e.g., 'noga-and-menachem-wedding')
 * @returns {string|null} - The event id or null if not found
 */
export async function resolveEventId(eventUrl) {
  // Check cache first
  const now = Date.now();
  const cachedTimestamp = eventCacheTimestamp.get(eventUrl);
  
  if (cachedTimestamp && (now - cachedTimestamp) < CACHE_DURATION) {
    const cachedEvent = eventCache.get(eventUrl);
    return cachedEvent ? (cachedEvent.id || cachedEvent.event_id) : null;
  }

  // Fetch fresh data
  try {
    const event = await fetchEventByUrl(eventUrl);
    
    if (event) {
      eventCache.set(eventUrl, event);
      eventCacheTimestamp.set(eventUrl, now);
      return event.id || event.event_id;
    }
    
    return null;
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
  const cachedTimestamp = eventCacheTimestamp.get(eventUrl);
  
  if (cachedTimestamp && (now - cachedTimestamp) < CACHE_DURATION) {
    return eventCache.get(eventUrl) || null;
  }

  // Fetch fresh data
  try {
    const event = await fetchEventByUrl(eventUrl);
    
    if (event) {
      eventCache.set(eventUrl, event);
      eventCacheTimestamp.set(eventUrl, now);
      return event;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting event data:', error);
    return null;
  }
}

/**
 * Manually cache event data (used when data is passed from router state)
 * @param {string} eventUrl - The event URL
 * @param {object} data - The event data to cache
 */
export function cacheEventData(eventUrl, data) {
  if (data && eventUrl) {
    eventCache.set(eventUrl, data);
    eventCacheTimestamp.set(eventUrl, Date.now());
  }
}

/**
 * Clear the event cache (useful for testing or when events change)
 */
export function clearEventCache() {
  eventCache.clear();
  eventCacheTimestamp.clear();
}
