import { useEffect, useMemo } from 'react';
import { useEventGeneralById } from '../utils/dataManager';
import { eventsAPI } from '../utils/apiService';

export function useEventDefaultAlbums(eventId, eventUrl, options = {}) {
  const { skipFetch = false, onError = null } = options;
  const eventData = useEventGeneralById(eventId);

  useEffect(() => {
    if (skipFetch) return;
    if (!eventUrl || !eventId) return;
    if (eventData && (eventData.archive_album_id || eventData.favorites_album_id)) return;

    eventsAPI.getById(eventUrl).catch((err) => {
      if (onError) {
        try {
          onError(err);
        } catch {
          // swallow handler errors
        }
      }
    });
  }, [
    skipFetch,
    eventUrl,
    eventId,
    eventData,
    onError,
  ]);

  const archiveAlbumId = eventData?.archive_album_id ?? null;
  const favoritesAlbumId = eventData?.favorites_album_id ?? null;

  const defaultAlbumIds = useMemo(() => {
    if (!archiveAlbumId && !favoritesAlbumId) {
      return null;
    }
    const ids = new Set();
    if (archiveAlbumId) ids.add(String(archiveAlbumId));
    if (favoritesAlbumId) ids.add(String(favoritesAlbumId));
    return ids;
  }, [archiveAlbumId, favoritesAlbumId]);

  return {
    eventData,
    archiveAlbumId,
    favoritesAlbumId,
    defaultAlbumIds,
  };
}


