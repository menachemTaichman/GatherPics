import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getEventData } from '../utils/eventResolver';
import { API_BASE } from '../utils/apiService';

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
        import('../utils/eventResolver').then(({ cacheEventData }) => {
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
  // IMPORTANT: These functions capture eventId from closure, so they will use the current eventId
  // even if urlHelpers object reference doesn't change
  const urlHelpers = useMemo(() => {
    // Capture current eventId and loading state in closure
    const currentEventId = eventId;
    const isLoading = loading;
    
    return {
      getDisplayImageUrl: (imageId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/display/${imageId}.webp`;
      },
      getThumbnailUrl: (imageId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/thumb/${imageId}.webp`;
      },
      getHighQualityUrl: (imageId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/high_quality/${imageId}.jpg`;
      },
      getOriginalUrl: (imageId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/original/${imageId}.jpg`;
      },
      getFaceCropUrl: (faceId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/faces/${faceId}.webp`;
      },
      getRepresentativeUrl: (entity, parentId) => {
        if (!currentEventId) {
          return null;
        }
        return `${API_BASE}/api/events/${currentEventId}/${entity}/${parentId}/representative`;
      },
    
      getRepresentativeWithFallback: (entity, parentId) => {
        if (!currentEventId) return null;
        return `${API_BASE}/api/events/${currentEventId}/${entity}/${parentId}/representative`;
      },
      
      getDefaultPlaceholder: () => null,
      
      // Relative URLs
      getRelativeDisplayUrl: (imageId) => {
        if (!currentEventId) return null;
        return `/api/events/${currentEventId}/display/${imageId}.webp`;
      },
      getRelativeThumbnailUrl: (imageId) => {
        if (!currentEventId) return null;
        return `/api/events/${currentEventId}/thumb/${imageId}.webp`;
      },
      getRelativeFaceCropUrl: (faceId) => {
        if (!currentEventId) return null;
        return `/api/events/${currentEventId}/faces/${faceId}.webp`;
      },
      
      // Navigation helpers
      navigateToGroups: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/people`;
      },
      navigateToAlbums: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/albums`;
      },
      navigateToTimeline: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/timeline`;
      },
      navigateToUploads: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/uploads`;
      },
      navigateToRequests: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/requests`;
      },
      navigateToFeedbacks: () => {
        if (!eventUrl) return;
        window.location.href = `/${eventUrl}/feedbacks`;
      },
    };
  }, [eventId, eventUrl, loading]);

  

  return {
    eventId,
    eventData,
    loading,
    error,
    urlHelpers
  };
}


