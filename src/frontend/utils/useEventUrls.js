import { useState, useEffect } from 'react';
import { resolveEventId } from './eventResolver';
import { API_BASE } from './apiService';
import jwtService from './jwtService';

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
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/api/events/${eventId}/display/${imageId}.webp${qs}`;
    },
    getThumbnailUrl: (imageId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/api/events/${eventId}/thumb/${imageId}.webp${qs}`;
    },
    getHighQualityUrl: (imageId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.webp${qs}`;
    },
    getOriginalUrl: (imageId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/api/events/${eventId}/original/${imageId}.webp${qs}`;
    },
    getFaceCropUrl: (faceId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/api/events/${eventId}/faces/${faceId}.webp${qs}`;
    },
    
    // Relative URLs
    getRelativeDisplayUrl: (imageId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `/api/events/${eventId}/display/${imageId}.webp${qs}`;
    },
    getRelativeThumbnailUrl: (imageId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `/api/events/${eventId}/thumb/${imageId}.webp${qs}`;
    },
    getRelativeFaceCropUrl: (faceId) => {
      if (!eventId) return null;
      const token = jwtService.getTokenSync();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `/api/events/${eventId}/faces/${faceId}.webp${qs}`;
    },
  };

  return {
    eventId,
    loading,
    error,
    urlHelpers
  };
}
