import axios from 'axios';
import { useDataStore } from './dataManager';
import { resolveEventId } from './eventResolver';
import jwtService from './jwtService';

// API base URL - centralized configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  async (config) => {
    // All requests rely on JWT cookies now; no Authorization header injection
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    if (response.data && response.data.changes) {
      const store = useDataStore.getState();
      const changes = response.data.changes;
      store.applyChanges(Array.isArray(changes) ? changes : []);
    }
    return response;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// URL construction helpers - centralized
export const urlHelpers = {
  getEventUrl: async (eventUrl, endpoint) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}${endpoint}`;
  },
  
  getDisplayImageUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/display/${imageId}.webp`;
  },
  getThumbnailUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/thumb/${imageId}.webp`;
  },
  getHighQualityUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.webp`;
  },
  getOriginalUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/original/${imageId}.webp`;
  },
  getFaceCropUrl: async (eventUrl, faceId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/faces/${faceId}.webp`;
  },
  
  getRelativeDisplayUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `/api/events/${eventId}/display/${imageId}.webp`;
  },
  getRelativeThumbnailUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `/api/events/${eventId}/thumb/${imageId}.webp`;
  },
  getRelativeFaceCropUrl: async (eventUrl, faceId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `/api/events/${eventId}/faces/${faceId}.webp`;
  },

  getDisplayImageUrlSync: (eventId, imageId) => {
    return `${API_BASE}/api/events/${eventId}/display/${imageId}.webp`;
  },
  getThumbnailUrlSync: (eventId, imageId) => {
    return `${API_BASE}/api/events/${eventId}/thumb/${imageId}.webp`;
  },
  getHighQualityUrlSync: (eventId, imageId) => {
    return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.webp`;
  },
  getOriginalUrlSync: (eventId, imageId) => {
    return `${API_BASE}/api/events/${eventId}/original/${imageId}.webp`;
  },
  getFaceCropUrlSync: (eventId, faceId) => {
    return `${API_BASE}/api/events/${eventId}/faces/${faceId}.webp`;
  },
  
  getRelativeDisplayUrlSync: (eventId, imageId) => {
    return `/api/events/${eventId}/display/${imageId}.webp`;
  },
  getRelativeThumbnailUrlSync: (eventId, imageId) => {
    return `/api/events/${eventId}/thumb/${imageId}.webp`;
  },
  getRelativeFaceCropUrlSync: (eventId, faceId) => {
    return `/api/events/${eventId}/faces/${faceId}.webp`;
  },
};

// Normalization helpers to provide consistent id fields and camelCase refs
function normalizeFace(face) {
  if (!face || typeof face !== 'object') return face;
  const normalized = { ...face };
  // id
  if (!normalized.id) normalized.id = normalized.face_id || normalized.faceID;
  if ('face_id' in normalized) delete normalized.face_id;
  if ('faceID' in normalized) delete normalized.faceID;
  
  // groupId
  if (!normalized.groupId) normalized.groupId = normalized.group_id || normalized.groupID;
  if ('group_id' in normalized) delete normalized.group_id;
  if ('groupID' in normalized) delete normalized.groupID;

  // imageId (for convenience in some payloads)
  if (!normalized.imageId) normalized.imageId = normalized.image_id || normalized.imageID;
  if ('image_id' in normalized) delete normalized.image_id;
  if ('imageID' in normalized) delete normalized.imageID;
  
  return normalized;
}

function normalizeImage(img) {
  if (!img || typeof img !== 'object') return img;
  const normalized = { ...img };
  if (!normalized.id) normalized.id = normalized.image_id || normalized.imageID;
  if ('image_id' in normalized) delete normalized.image_id;
  if ('imageID' in normalized) delete normalized.imageID;
  
  if (Array.isArray(normalized.faces)) normalized.faces = normalized.faces.map(normalizeFace);
  if (Array.isArray(normalized.albums)) normalized.albums = normalized.albums.map(normalizeAlbum);
  if (normalized.moment && typeof normalized.moment === 'object') normalized.moment = normalizeMoment(normalized.moment);
  return normalized;
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object') return group;
  const normalized = { ...group };
  if (!normalized.id) normalized.id = normalized.group_id || normalized.groupID;
  if ('group_id' in normalized) delete normalized.group_id;
  if ('groupID' in normalized) delete normalized.groupID;
  return normalized;
}

function normalizeMoment(moment) {
  if (!moment || typeof moment !== 'object') return moment;
  const normalized = { ...moment };
  if (!normalized.id) normalized.id = normalized.moment_id || normalized.momentID;
  if ('moment_id' in normalized) delete normalized.moment_id;
  if ('momentID' in normalized) delete normalized.momentID;
  return normalized;
}

function normalizeAlbum(album) {
  if (!album || typeof album !== 'object') return album;
  const normalized = { ...album };
  if (!normalized.id) normalized.id = normalized.album_id || normalized.albumID;
  if ('album_id' in normalized) delete normalized.album_id;
  if ('albumID' in normalized) delete normalized.albumID;
  return normalized;
}

async function getEventIdForApi(eventUrl) {
  if (!eventUrl) {
    throw new Error('Event URL is required');
  }
  const eventId = await resolveEventId(eventUrl);
  if (!eventId) {
    throw new Error(`Event not found: ${eventUrl}`);
  }
  return eventId;
}

// Groups API
export const groupsAPI = {
  getAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups`);
    const data = response.data || {};
    if (Array.isArray(data.groups)) {
      data.groups = data.groups.map(normalizeGroup);
    }
    return data;
  },

  getById: async (groupId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}`, { params });
    const data = response.data || {};
    if (data.group) data.group = normalizeGroup(data.group);
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },

  update: async (groupId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/groups/${groupId}`, updates);
    return response.data;
  },

  delete: async (groupId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/groups/${groupId}`);
    return response.data;
  },

  checkName: async (label, excludeGroupId = '', eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/groups/check-name`, {
      label,
      exclude_group_id: excludeGroupId
    });
    return response.data;
  },

  transferFaces: async (sourceGroupId, targetGroupId, faceIds, eventUrl, newGroupName = null) => {
    const eventId = await getEventIdForApi(eventUrl);
    const requestData = {
      source_group_id: sourceGroupId,
      target_group_id: targetGroupId,
      face_ids: faceIds
    };
    
    // Add new_group_name if provided (for creating new groups)
    if (newGroupName) {
      requestData.new_group_name = newGroupName;
    }
    
    
    const response = await api.post(`/api/events/${eventId}/groups/transfer-faces`, requestData);
    return response.data;
  },

  getFaces: async (groupId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/faces`);
    const data = response.data || {};
    if (Array.isArray(data.faces)) {
      data.faces = data.faces.map(normalizeFace);
    }
    return data;
  },

  getRelated: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups/related`, { params });
    const data = response.data || {};
    if (Array.isArray(data.related_groups)) {
      data.related_groups = data.related_groups.map(normalizeGroup);
    }
    return data;
  },
};

// Moments API
export const momentsAPI = {
  getAll: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/moments`, { params });
    const data = response.data || {};
    if (Array.isArray(data.moments)) {
      data.moments = data.moments.map(normalizeMoment);
    }
    return data;
  },

  getById: async (momentId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}`, { params });
    const data = response.data || {};
    if (data.moment) data.moment = normalizeMoment(data.moment);
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },

  create: async (momentData, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/moments`, momentData);
    return response.data;
  },

  update: async (momentId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/moments/${momentId}`, updates);
    return response.data;
  },

  delete: async (momentId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/moments/${momentId}`);
    return response.data;
  },

  addImages: async (momentId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/moments/${momentId}/images`, { image_ids: imageIds });
    const data = response.data || {};
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },

  removeImages: async (momentId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/moments/${momentId}/images`, { data: { image_ids: imageIds } });
    return response.data;
  },
};

// Images API
export const imagesAPI = {
  getDetails: async (imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/images`, { image_ids: imageIds });
    const data = response.data || {};
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },
};

// Albums API
export const albumsAPI = {
  getAll: async (eventUrl, options = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const params = {};
    if (options.exclude_defaults) {
        params.exclude_defaults = 'true';
    }
    const response = await api.get(`/api/events/${eventId}/albums`, { params });
    return response.data;
  },

  getById: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/albums/${albumId}`);
    const data = response.data || {};
    if (data.album) data.album = normalizeAlbum(data.album);
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },

  update: async (albumId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/albums/${albumId}`, updates);
    return response.data;
  },

  getImages: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/albums/${albumId}/images`);
    const data = response.data || {};
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },

  addImages: async (albumId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/albums/${albumId}/images`, { image_ids: imageIds });
    return response.data;
  },

  removeImages: async (albumId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/albums/${albumId}/images`, { data: { image_ids: imageIds } });
    return response.data;
  },

  toggleFavorite: async (imageIds, isFavorite, eventUrl) => {
    const store = useDataStore.getState();
    let favoritesAlbumId = store.favoritesAlbumId;

    if (!favoritesAlbumId) {
      const eventId = await getEventIdForApi(eventUrl);
      const response = await api.get(`/api/events/${eventId}/albums/defaults/favorites`);
      const data = response.data || {};
      if (data.album) {
        const albumId = data.album.id || data.album.albumID;
        store.setFavoritesAlbumId(albumId);
        favoritesAlbumId = albumId;
      }
    }

    if (!favoritesAlbumId) {
      throw new Error("Favorites album not found.");
    }
    
    if (isFavorite) {
      return albumsAPI.removeImages(favoritesAlbumId, imageIds, eventUrl);
    } else {
      return albumsAPI.addImages(favoritesAlbumId, imageIds, eventUrl);
    }
  },

  addToArchive: async (imageIds, eventUrl) => {
    const store = useDataStore.getState();
    let archiveAlbumId = store.archiveAlbumId;
    
    if (!archiveAlbumId) {
        const eventId = await getEventIdForApi(eventUrl);
        const response = await api.get(`/api/events/${eventId}/albums/defaults/archive`);
        const data = response.data || {};
        if (data.album) {
            const albumId = data.album.id || data.album.albumID;
            store.setArchiveAlbumId(albumId);
            archiveAlbumId = albumId;
        }
    }

    if (!archiveAlbumId) {
        throw new Error("Archive album not found.");
    }
    
    return albumsAPI.addImages(archiveAlbumId, imageIds, eventUrl);
  },

  toggleArchive: async (imageIds, isArchived, eventUrl) => {
    const store = useDataStore.getState();
    let archiveAlbumId = store.archiveAlbumId;

    if (!archiveAlbumId) {
      const eventId = await getEventIdForApi(eventUrl);
      const response = await api.get(`/api/events/${eventId}/albums/defaults/archive`);
      const data = response.data || {};
      if (data.album) {
        const albumId = data.album.id || data.album.albumID;
        store.setArchiveAlbumId(albumId);
        archiveAlbumId = albumId;
      }
    }

    if (!archiveAlbumId) {
      throw new Error('Archive album not found.');
    }

    if (isArchived) {
      return albumsAPI.removeImages(archiveAlbumId, imageIds, eventUrl);
    }
    return albumsAPI.addImages(archiveAlbumId, imageIds, eventUrl);
  }
};

// Download API
export const downloadAPI = {
  // Download images
  download: async (imageIds, format = 'zip', eventUrl, options = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(
      `/api/events/${eventId}/download`,
      {
        image_ids: imageIds,
        format,
        quality: options.quality || 'high'
      },
      { responseType: 'blob' }
    );
    return response.data; // Blob
  }
};

// Profile API
export const profileAPI = {
  // Get profile permissions
  getPermissions: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/profile/permissions`);
    return response.data;
  }
};

// Optimistic update helpers
export const optimisticUpdates = {
  // Optimistic group update
  updateGroup: async (groupId, updates, rollbackFn, eventUrl) => {
    const store = useDataStore.getState();
    const previousState = store.entities?.groupsById?.[groupId];
    
    // Apply optimistic update
    store.updateGroup(groupId, updates);
    
    try {
      const result = await groupsAPI.update(groupId, updates, eventUrl);
      if (Array.isArray(result.changes)) {
        store.applyChanges(result.changes);
      }
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        rollbackFn(previousState);
      }
      throw error;
    }
  },

  // Optimistic group delete
  deleteGroup: async (groupId, rollbackFn, eventUrl) => {
    const store = useDataStore.getState();
    const previousState = store.entities?.groupsById?.[groupId];
    
    // Apply optimistic update
    store.deleteGroup(groupId);
    
    try {
      const result = await groupsAPI.delete(groupId, eventUrl);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        store.addGroup(previousState);
      }
      throw error;
    }
  },

  createMoment: async (momentData, rollbackFn, eventUrl) => {
    const store = useDataStore.getState();
    const tempId = `temp-${Date.now()}`;
    const newMoment = { ...momentData, momentID: tempId };

    // Apply optimistic update
    store.addMoment(newMoment);

    try {
      const result = await momentsAPI.create(momentData, eventUrl);
      if (result.moment) {
        store.applyChanges([{ type: 'UPSERT', entity: 'moments', items: [result.moment] }]);
      }
      if (Array.isArray(result.changes)) {
        store.applyChanges(result.changes);
      }
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn) {
        rollbackFn();
      }
      store.deleteMoment(tempId);
      throw error;
    }
  },

  // Optimistic moment update
  updateMoment: async (momentId, updates, rollbackFn, eventUrl) => {
    const store = useDataStore.getState();
    const previousState = store.entities?.momentsById?.[momentId];
    
    // Apply optimistic update
    store.updateMoment(momentId, updates);
    
    try {
      const result = await momentsAPI.update(momentId, updates, eventUrl);
      if (Array.isArray(result.changes)) {
        store.applyChanges(result.changes);
      }
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        rollbackFn(previousState);
      } else if (previousState) {
        store.updateMoment(momentId, previousState);
      }
      throw error;
    }
  },

  // Optimistic moment delete
  deleteMoment: async (momentId, rollbackFn, eventUrl) => {
    const store = useDataStore.getState();
    const previousState = store.entities?.momentsById?.[momentId];
    
    // Apply optimistic update
    store.deleteMoment(momentId);
    
    try {
      const result = await momentsAPI.delete(momentId, eventUrl);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        rollbackFn(previousState);
      } else if (previousState) {
        store.applyChanges([{ type: 'UPSERT', entity: 'moments', items: [previousState] }]);
      }
      throw error;
    }
  }
};

// Error handling utilities
export const handleAPIError = (error, defaultMessage = 'An error occurred') => {
  if (error.response) {
    // Server responded with error status
    const message = error.response.data?.message || error.response.data?.error || defaultMessage;
    return { error: true, message };
  } else if (error.request) {
    // Network error
    return { error: true, message: 'Network error. Please check your connection.' };
  } else {
    // Other error
    return { error: true, message: error.message || defaultMessage };
  }
};


// JWT Authentication helpers
export const authAPI = {
  updateIncludeArchived: async (includeArchived) => {
    try {
      const token = await jwtService.updateIncludeArchived(includeArchived);
      return { success: true, token, include_archived: includeArchived };
    } catch (error) {
      console.error('Failed to update include_archived setting:', error);
      throw error;
    }
  },

  // Get current JWT token
  getCurrentToken: async () => {
    try {
      return await jwtService.getCurrentToken();
    } catch (error) {
      console.error('Failed to get current token:', error);
      throw error;
    }
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return jwtService.hasToken();
  }
};

// Export constants for components that need them
export { API_BASE };

export default api; 