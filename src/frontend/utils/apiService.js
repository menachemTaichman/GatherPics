import axios from 'axios';
import { useDataStore, CHANGE_TYPES, handleDataChange } from './dataManager';
import { resolveEventId } from './eventResolver';
import { getSetting } from './settings';
import jwtService from './jwtService';

// API base URL - centralized configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  async (config) => {
    // Add JWT token to all requests (except public endpoints)
    const isPublicEndpoint = config.url === '/api/events' || config.url?.includes('/set-include-archived');
    if (!isPublicEndpoint) {
      // This is a protected endpoint, add JWT token
      try {
        const authHeader = await jwtService.getAuthHeader();
        if (authHeader.Authorization) {
          config.headers = { ...config.headers, ...authHeader };
        }
      } catch (error) {
        console.warn('Failed to add JWT token to request:', error);
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle change instructions
api.interceptors.response.use(
  (response) => {
    // Process change instructions from backend
    if (response.data && response.data.changes) {
      response.data.changes.forEach(change => {
        handleDataChange(change.type, change.data);
      });
    }
    return response;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// URL construction helpers - centralized
export const urlHelpers = {
  // Get full API URL for event-scoped endpoints
  getEventUrl: async (eventUrl, endpoint) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}${endpoint}`;
  },
  
  // Get image URLs (async versions for when you need to resolve eventUrl)
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
  
  // Get relative URLs (for use in components that need relative paths)
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

  // Synchronous versions that work with already-resolved eventId
  // These are for use in components where eventId is already available
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
  
  // Synchronous relative URLs
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

// Helper function to get event ID for API calls
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
  // Get all groups
  getAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups`);
    return response.data;
  },

  // Get specific group
  getById: async (groupId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}`, { params });
    return response.data;
  },

  // Update group
  update: async (groupId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/groups/${groupId}`, updates);
    return response.data;
  },

  // Delete group
  delete: async (groupId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/groups/${groupId}`);
    return response.data;
  },

  // Check group name conflict
  checkName: async (label, excludeGroupId = '', eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/groups/check-name`, {
      label,
      exclude_group_id: excludeGroupId
    });
    return response.data;
  },

  // Transfer faces between groups
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
};

// Moments API
export const momentsAPI = {
  // Get all moments
  getAll: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/moments`, { params });
    return response.data;
  },

  // Get specific moment
  getById: async (momentId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}`, { params });
    return response.data;
  },

  // Create moment
  create: async (momentData, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/moments`, momentData);
    return response.data;
  },

  // Update moment
  update: async (momentId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/moments/${momentId}`, updates);
    return response.data;
  },

  // Delete moment
  delete: async (momentId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/moments/${momentId}`);
    return response.data;
  },

  // Add images to moment
  addImages: async (momentId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/moments/${momentId}/images`, { image_ids: imageIds });
    return response.data;
  },

  // Remove images from moment
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
    return response.data;
  },
};

// Albums API
export const albumsAPI = {
  // Get all albums
  getAll: async (eventUrl, options = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const params = {};
    if (options.exclude_defaults) {
        params.exclude_defaults = 'true';
    }
    const response = await api.get(`/api/events/${eventId}/albums`, { params });
    return response.data;
  },

  // Get specific album
  getById: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/albums/${albumId}`);
    return response.data;
  },

  // Update album
  update: async (albumId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/albums/${albumId}`, updates);
    return response.data;
  },

  // Get album images
  getImages: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/albums/${albumId}/images`);
    return response.data;
  },

  // Add images to album
  addImages: async (albumId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/albums/${albumId}/images`, { image_ids: imageIds });
    return response.data;
  },

  // Remove images from album
  removeImages: async (albumId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/albums/${albumId}/images`, { data: { image_ids: imageIds } });
    return response.data;
  },

  // Favorites helpers (uses default album label lookups client-side)
  toggleFavorite: async (imageIds, isFavorite, eventUrl) => {
    const store = useDataStore.getState();
    let favoritesAlbumId = store.favoritesAlbumId;

    if (!favoritesAlbumId) {
      const eventId = await getEventIdForApi(eventUrl);
      const all = await api.get(`/api/events/${eventId}/albums`);
      const fav = (all.data.albums || []).find(a => (a.label || '').toLowerCase() === 'favorites');
      if (fav) {
        favoritesAlbumId = fav.albumID;
        store.setFavoritesAlbumId(favoritesAlbumId);
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

  // Archive helpers
  addToArchive: async (imageIds, eventUrl) => {
    const store = useDataStore.getState();
    let archiveAlbumId = store.archiveAlbumId;
    
    if (!archiveAlbumId) {
        const eventId = await getEventIdForApi(eventUrl);
        const all = await api.get(`/api/events/${eventId}/albums`);
        const archive = (all.data.albums || []).find(a => (a.label || '').toLowerCase() === 'archive');
        if (archive) {
            archiveAlbumId = archive.albumID;
            store.setArchiveAlbumId(archiveAlbumId);
        }
    }

    if (!archiveAlbumId) {
        throw new Error("Archive album not found.");
    }
    
    return albumsAPI.addImages(archiveAlbumId, imageIds, eventUrl);
  },

  // Toggle archive status for images
  toggleArchive: async (imageIds, isArchived, eventUrl) => {
    const store = useDataStore.getState();
    let archiveAlbumId = store.archiveAlbumId;

    if (!archiveAlbumId) {
      const eventId = await getEventIdForApi(eventUrl);
      const all = await api.get(`/api/events/${eventId}/albums`);
      const archive = (all.data.albums || []).find(a => (a.label || '').toLowerCase() === 'archive');
      if (archive) {
        archiveAlbumId = archive.albumID;
        store.setArchiveAlbumId(archiveAlbumId);
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
    const previousState = store.groups.find(g => g.groupID === groupId);
    
    // Apply optimistic update
    store.updateGroup(groupId, updates);
    
    try {
      const result = await groupsAPI.update(groupId, updates, eventUrl);
      
      // Process any change instructions from the backend
      if (result.changes) {
        result.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
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
    const previousState = store.groups.find(g => g.groupID === groupId);
    
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
      
      // Update the temporary moment with the real data from the server
      store.updateMoment(tempId, result.moment);
      
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
    const previousState = store.moments.find(m => m.momentID === momentId);
    
    // Apply optimistic update
    store.updateMoment(momentId, updates);
    
    try {
      const result = await momentsAPI.update(momentId, updates, eventUrl);
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
    const previousState = store.moments.find(m => m.momentID === momentId);
    
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
        store.addMoment(previousState);
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

// Toast notification helper
export const showToast = (message, type = 'success', toastSetter) => {
  if (toastSetter) {
    toastSetter({ show: true, message, type });
    setTimeout(() => {
      toastSetter({ show: false, message: '', type: 'success' });
    }, 3000);
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