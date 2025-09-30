import { useState, useEffect } from 'react';
import { resolveEventId } from './eventResolver';
import { API_BASE } from './apiService';

export function useEventUrls(eventUrl) {
  const [eventId, setEventId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!eventUrl) {
      setError('Event URL is required');
      setLoading(false);
      return;
    }

    const resolveEvent = async () => {
      try {
        setLoading(true);
        const id = await resolveEventId(eventUrl);
        if (id) {
          setEventId(id);
          setError(null);
        } else {
          setError(`Event not found: ${eventUrl}`);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    resolveEvent();
  }, [eventUrl]);

  // Synchronous URL helpers that work with the resolved eventId
  const urlHelpers = {
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
  };

  return {
    eventId,
    loading,
    error,
    urlHelpers
  };
}
