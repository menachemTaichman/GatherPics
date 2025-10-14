import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getEventData } from './eventResolver';
import { API_BASE } from './apiService';

export function useEventUrls(eventUrl) {
  const location = useLocation();
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  

  useEffect(() => {
    
    if (!eventUrl) {
      setError('Event URL is required');
      setLoading(false);
      return;
    }

    // Check if event data was passed via router state (from home page)
    const passedEventData = location.state?.eventData;
    if (passedEventData && passedEventData.url === eventUrl) {
      setEventData(passedEventData);
      setError(null);
      setLoading(false);
      
      // IMPORTANT: Also cache it in the resolver for future navigations
      import('./eventResolver').then(({ cacheEventData }) => {
        cacheEventData(eventUrl, passedEventData);
      });
      
      return;
    }

    // Single-flight + idempotent resolve for same eventUrl
    const inFlightRef = useEventUrls.__inFlightRef || (useEventUrls.__inFlightRef = { current: false });
    const lastResolvedRef = useEventUrls.__lastResolvedRef || (useEventUrls.__lastResolvedRef = { current: null });
    if (inFlightRef.current) {
      
      return;
    }
    if (lastResolvedRef.current === eventUrl && eventData) {
      
      return;
    }

    const resolveEvent = async () => {
      try {
        inFlightRef.current = true;
        setLoading(true);
        const data = await getEventData(eventUrl);
        if (data) {
          setEventData(data);
          setError(null);
          lastResolvedRef.current = eventUrl;
        } else {
          setError(`Event not found: ${eventUrl}`);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        inFlightRef.current = false;
      }
    };

    resolveEvent();
  }, [eventUrl, location.state]);

  // Extract eventId from eventData
  // Support both 'id' and 'event_id' for flexibility
  const eventId = eventData?.id || eventData?.event_id || null;

  // Synchronous URL helpers that work with the resolved eventId
  const urlHelpers = useMemo(() => ({
    getDisplayImageUrl: (imageId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/display/${imageId}.webp`;
    },
    getThumbnailUrl: (imageId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/thumb/${imageId}.webp`;
    },
    getHighQualityUrl: (imageId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.webp`;
    },
    getOriginalUrl: (imageId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/original/${imageId}.webp`;
    },
    getFaceCropUrl: (faceId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/faces/${faceId}.webp`;
    },
    getRepresentativeUrl: (entity, parentId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/${entity}/${parentId}/representative`;
    },
    
    getRepresentativeWithFallback: (entity, parentId) => {
      if (!eventId) return null;
      return `${API_BASE}/api/events/${eventId}/${entity}/${parentId}/representative`;
    },
    
    getDefaultPlaceholder: () => null,
    
    // Relative URLs
    getRelativeDisplayUrl: (imageId) => {
      if (!eventId) return null;
      return `/api/events/${eventId}/display/${imageId}.webp`;
    },
    getRelativeThumbnailUrl: (imageId) => {
      if (!eventId) return null;
      return `/api/events/${eventId}/thumb/${imageId}.webp`;
    },
    getRelativeFaceCropUrl: (faceId) => {
      if (!eventId) return null;
      return `/api/events/${eventId}/faces/${faceId}.webp`;
    },
  }), [eventId]);

  

  return {
    eventId,
    eventData,
    loading,
    error,
    urlHelpers
  };
}
