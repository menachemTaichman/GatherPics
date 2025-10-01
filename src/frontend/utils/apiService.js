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
      
      // Remove changes from response to prevent double application
      const { changes: _, ...responseDataWithoutChanges } = response.data;
      response.data = responseDataWithoutChanges;
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
  
  getRepresentativeUrl: async (eventUrl, entity, parentId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/${entity}/${parentId}/representative`;
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
  getRepresentativeUrlSync: (eventId, entity, parentId) => {
    return `${API_BASE}/api/events/${eventId}/${entity}/${parentId}/representative`;
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
  if (!normalized.id) normalized.id = normalized.face_id;
  if ('face_id' in normalized) delete normalized.face_id;
  
  // groupId
  if (!normalized.groupId) normalized.groupId = normalized.group_id;
  if ('group_id' in normalized) delete normalized.group_id;

  // imageId (for convenience in some payloads)
  if (!normalized.imageId) normalized.imageId = normalized.image_id;
  if ('image_id' in normalized) delete normalized.image_id;
  
  return normalized;
}

function normalizeImage(img) {
  if (!img || typeof img !== 'object') return img;
  const normalized = { ...img };
  if (!normalized.id) normalized.id = normalized.image_id;
  if ('image_id' in normalized) delete normalized.image_id;
  
  if (Array.isArray(normalized.faces)) normalized.faces = normalized.faces.map(normalizeFace);
  if (Array.isArray(normalized.albums)) normalized.albums = normalized.albums.map(normalizeAlbum);
  if (normalized.moment && typeof normalized.moment === 'object') normalized.moment = normalizeMoment(normalized.moment);
  return normalized;
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object') return group;
  const normalized = { ...group };
  if (!normalized.id) normalized.id = normalized.group_id;
  if ('group_id' in normalized) delete normalized.group_id;
  return normalized;
}

function normalizeMoment(moment) {
  if (!moment || typeof moment !== 'object') return moment;
  const normalized = { ...moment };
  if (!normalized.id) normalized.id = normalized.moment_id;
  if ('moment_id' in normalized) delete normalized.moment_id;
  return normalized;
}

function normalizeAlbum(album) {
  if (!album || typeof album !== 'object') return album;
  const normalized = { ...album };
  if (!normalized.id) normalized.id = normalized.album_id;
  if ('album_id' in normalized) delete normalized.album_id;
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
    return response.data || {};
  },

  getById: async (groupId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}`, { params });
    return response.data || {};
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
    return response.data || {};
  },

  getById: async (momentId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}`, { params });
    return response.data || {};
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
  getImages: async (imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const params = imageIds && imageIds.length > 0 ? { image_ids: imageIds.join(',') } : {};
    const response = await api.get(`/api/events/${eventId}/images`, { params });
    const data = response.data || {};
    if (Array.isArray(data.images)) data.images = data.images.map(normalizeImage);
    return data;
  },
  
  getImage: async (imageId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/images/${imageId}`);
    const data = response.data || {};
    if (data.image) data.image = normalizeImage(data.image);
    return data;
  }
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
    return response.data || {};
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
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/albums/favorites/images`, {
      image_ids: Array.isArray(imageIds) ? imageIds : [imageIds],
      is_favorite: isFavorite
    });
    return response.data;
  },

  toggleArchive: async (imageIds, isArchived, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/albums/archive/images`, {
      image_ids: Array.isArray(imageIds) ? imageIds : [imageIds],
      is_archived: isArchived
    });
    return response.data;
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
    // Just call the API directly - the response interceptor will handle data updates
    try {
      const result = await groupsAPI.update(groupId, updates, eventUrl);
      return result;
    } catch (error) {
      throw error;
    }
  },

  // Optimistic group delete
  deleteGroup: async (groupId, rollbackFn, eventUrl) => {
    // Just call the API directly - the response interceptor will handle data updates
    try {
      const result = await groupsAPI.delete(groupId, eventUrl);
      return result;
    } catch (error) {
      throw error;
    }
  },

  createMoment: async (momentData, rollbackFn, eventUrl) => {
    // Just call the API directly - the response interceptor will handle data updates
    try {
      const result = await momentsAPI.create(momentData, eventUrl);
      return result;
    } catch (error) {
      throw error;
    }
  },

  // Optimistic moment update
  updateMoment: async (momentId, updates, rollbackFn, eventUrl) => {
    // Just call the API directly - the response interceptor will handle data updates
    try {
      const result = await momentsAPI.update(momentId, updates, eventUrl);
      return result;
    } catch (error) {
      throw error;
    }
  },

  // Optimistic moment delete
  deleteMoment: async (momentId, rollbackFn, eventUrl) => {
    // Just call the API directly - the response interceptor will handle data updates
    try {
      const result = await momentsAPI.delete(momentId, eventUrl);
      return result;
    } catch (error) {
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