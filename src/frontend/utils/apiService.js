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

// In-flight requests deduplication (per-tab)
const inflightRequests = new Map();

function withDedupe(key, factory) {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }
  const promise = (async () => {
    try {
      return await factory();
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, promise);
  return promise;
}

// Request interceptor - Add Authorization header with access token
api.interceptors.request.use(
  async (config) => {
    // Skip auth header for public endpoints
    const publicEndpoints = ['/api/events', '/api/events/resolve', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];
    const isPublicEndpoint = publicEndpoints.some(endpoint => config.url?.includes(endpoint));
    
    if (!isPublicEndpoint) {
      const token = jwtService.getTokenSync();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle changes and 401 errors
api.interceptors.response.use(
  (response) => {
    // Apply changes to store if present
    if (response.data && response.data.changes) {
      const store = useDataStore.getState();
      const changes = Array.isArray(response.data.changes) 
        ? response.data.changes 
        : [];
      
      // Extract event_id from request URL
      const eventIdMatch = response.config.url?.match(/\/events\/([^\/]+)/);
      const defaultEventId = eventIdMatch ? eventIdMatch[1] : 'general';
      
      // Inject event_id into changes that don't have it
      const enrichedChanges = changes.map(ch => ({
        ...ch,
        event_id: ch.event_id || defaultEventId
      }));
      
      store.applyChanges(enrichedChanges);
      
      // Remove changes from response to prevent double application
      const { changes: _, ...responseDataWithoutChanges } = response.data;
      response.data = responseDataWithoutChanges;
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    
    // Handle 401 Unauthorized errors
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        // Try to refresh the token
        await jwtService.refresh();
        
        // Update the authorization header with new token
        const newToken = jwtService.getTokenSync();
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        
        // Retry the original request
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed - token is invalid
        // Clear token and let the auth context handle login modal
        jwtService.clearToken();
        
        // Dispatch custom event to trigger login modal
        window.dispatchEvent(new CustomEvent('auth:required'));
        
        // In production, suppress the error logging since this is expected behavior
        if (import.meta.env.MODE === 'production') {
          // Return a rejected promise without logging
          return Promise.reject({ 
            ...refreshError, 
            silent: true,
            message: 'Authentication required' 
          });
        }
        
        return Promise.reject(refreshError);
      }
    }
    
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

// Resolve event URL by event ID (cached; single-event route only)
let __eventsIndexById = null;
export async function getEventUrlById(eventId) {
  if (!eventId) return null;
  if (__eventsIndexById && __eventsIndexById[eventId]) return __eventsIndexById[eventId];
  try {
    const res = await api.get(`/api/events/${eventId}/url`);
    const url = res?.data?.url || null;
    if (url) {
      __eventsIndexById = { ...( __eventsIndexById || {} ), [eventId]: url };
      return url;
    }
  } catch {}
  return null;
}

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
    const key = `GROUPS_GET_ALL:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups`);
      return response.data || {};
    });
  },

  getById: async (groupId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUP_GET_BY_ID:${eventId}:${groupId}:${JSON.stringify(params||{})}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/${groupId}`, { params });
      return response.data || {};
    });
  },

  getWithFaces: async (groupId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUP_GET_WITH_FACES:${eventId}:${groupId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/${groupId}/with-faces`);
      return response.data || {};
    });
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
    const key = `CHECK_NAME:${eventId}:${label}:${excludeGroupId || ''}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/groups/check-name`, {
        label,
        exclude_group_id: excludeGroupId
      });
      return response.data;
    });
  },

  transferFaces: async (targetGroupId, faceIds, eventUrl, newGroupName = null) => {
    const eventId = await getEventIdForApi(eventUrl);
    const requestData = {
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
    const key = `GROUP_GET_FACES:${eventId}:${groupId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/${groupId}/faces`);
      const data = response.data || {};
      if (Array.isArray(data.faces)) {
        data.faces = data.faces.map(normalizeFace);
      }
      return data;
    });
  },

  getFacesInImage: async (groupId, imageId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUP_GET_FACES_IN_IMAGE:${eventId}:${groupId}:${imageId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/${groupId}/faces?image_id=${imageId}`);
      const data = response.data || {};
      if (Array.isArray(data.faces)) {
        data.faces = data.faces.map(normalizeFace);
      }
      return data;
    });
  },

  getFacesInImages: async (groupId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUP_GET_FACES_IN_IMAGES:${eventId}:${groupId}:${imageIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/${groupId}/faces?image_ids=${imageIds.join(',')}`);
      return response.data || {};
    });
  },

  getRelated: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUPS_GET_RELATED:${eventId}:${JSON.stringify(params||{})}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/groups/related`, { params });
      const data = response.data || {};
      if (Array.isArray(data.related_groups)) {
        data.related_groups = data.related_groups.map(normalizeGroup);
      }
      return data;
    });
  },
};

// Moments API
export const momentsAPI = {
  getAll: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `MOMENTS_GET_ALL:${eventId}:${JSON.stringify(params||{})}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/moments`, { params });
      return response.data || {};
    });
  },

  getById: async (momentId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `MOMENT_GET_BY_ID:${eventId}:${momentId}:${JSON.stringify(params||{})}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/moments/${momentId}`, { params });
      return response.data || {};
    });
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

  removeImages: async (imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/moments/images`, { data: { image_ids: imageIds } });
    return response.data;
  },

  getImages: async (momentId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `MOMENTS_GET_IMAGES:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/moments/images`);
      return response.data || {};
    });
  },

  checkName: async (label, excludeMomentId = '', eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_MOMENT_NAME:${eventId}:${label}:${excludeMomentId || ''}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/moments/check-name`, { 
        label,
        exclude_moment_id: excludeMomentId 
      });
      return response.data;
    });
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
    const key = `GET_IMAGE:${eventId}:${imageId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/images/${imageId}`);
      const data = response.data || {};
      if (data.image) data.image = normalizeImage(data.image);
      return data;
    });
  },

  delete: async (imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/images`, { 
      data: { image_ids: Array.isArray(imageIds) ? imageIds : [imageIds] } 
    });
    return response.data;
  },

  getUploadLimits: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GET_UPLOAD_LIMITS:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/upload/limits`);
      return response.data;
    });
  },

  upload: async (files, assignMoments, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const formData = new FormData();
    
    // Add files to FormData
    for (const file of files) {
      formData.append('files', file);
    }
    
    // Add assign_moments option
    formData.append('assign_moments', assignMoments ? 'true' : 'false');
    
    const response = await api.post(`/api/events/${eventId}/images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  uploadWithProgress: async (files, assignMoments, eventUrl, onProgress) => {
    const eventId = await getEventIdForApi(eventUrl);
    
    // Step 1: Upload files to server
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    
    let uploadedFilenames = [];
    try {
      const uploadResponse = await api.post(`/api/events/${eventId}/images/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      uploadedFilenames = uploadResponse.data.filenames || [];
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to upload files');
    }
    
    // Step 2: Process with SSE, passing the uploaded filenames
    return new Promise((resolve, reject) => {
      const fileNamesParam = uploadedFilenames.length > 0 
        ? `&file_names=${encodeURIComponent(uploadedFilenames.join(','))}` 
        : '';
      const url = `${API_BASE}/api/events/${eventId}/images/process-stream?assign_moments=${assignMoments}${fileNamesParam}`;
      
      // EventSource with credentials for cookie-based auth
      const eventSource = new EventSource(url, { withCredentials: true });
      
      // Cleanup on timeout (5 minutes max)
      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('Processing timeout'));
      }, 5 * 60 * 1000);
      
      const cleanup = () => {
        clearTimeout(timeout);
        eventSource.close();
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.step === 'complete') {
            cleanup();
            
            // Apply changes to store
            if (data.changes) {
              const store = useDataStore.getState();
              store.applyChanges(Array.isArray(data.changes) ? data.changes : []);
            }
            
            // Ensure result exists before resolving
            if (!data.result) {
              console.error('Complete event received but no result:', data);
              reject(new Error('Processing completed but no result data received'));
              return;
            }
            
            resolve(data.result);
          } else if (data.step === 'error') {
            cleanup();
            reject(new Error(data.message || 'Processing failed'));
          } else {
            // Progress update
            if (onProgress) {
              onProgress(data);
            }
          }
        } catch (parseError) {
          console.error('Failed to parse SSE data:', parseError, 'Raw event:', event.data);
          cleanup();
          reject(new Error('Failed to parse server response: ' + parseError.message));
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        cleanup();
        reject(new Error('Connection to server lost'));
      };
    });
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
    const key = `ALBUMS_GET_ALL:${eventId}:${JSON.stringify(params||{})}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/albums`, { params });
      return response.data;
    });
  },

  getById: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `ALBUM_GET_BY_ID:${eventId}:${albumId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/albums/${albumId}`);
      return response.data || {};
    });
  },

  update: async (albumId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/albums/${albumId}`, updates);
    return response.data;
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

  delete: async (albumId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/albums/${albumId}`);
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
  },

  create: async (albumData, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/albums`, albumData);
    return response.data;
  },

  checkName: async (label, excludeAlbumId = '', eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_ALBUM_NAME:${eventId}:${label}:${excludeAlbumId || ''}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/albums/check-name`, {
        label,
        exclude_album_id: excludeAlbumId
      });
      return response.data;
    });
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
export const profilesAPI = {
  // Get all profiles
  getAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `PROFILES_GET_ALL:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/profiles`);
      return response.data;
    });
  },
  
  // Get profile by ID (with scopes for relations)
  getById: async (profileId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `PROFILE_GET_BY_ID:${eventId}:${profileId}:${JSON.stringify(params||{})}`;
    const result = await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/profiles/${profileId}`, { params });
      return response.data;
    });
    return result;
  },
  
  // Check if profile name exists
  checkName: async (label, excludeProfileId, restrictedToEventUrl) => {
    let restrictedToEventId = null;
    if (restrictedToEventUrl) {
      restrictedToEventId = await getEventIdForApi(restrictedToEventUrl);
    }
    const response = await api.post(`/api/profiles/check-name`, {
      label,
      exclude_profile_id: excludeProfileId,
      restricted_to_event_id: restrictedToEventId
    });
    return response.data;
  },
  
  // Create profile
  create: async (profileData, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/profiles`, profileData);
    return response.data;
  },
  
  // Update profile
  update: async (profileId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}`, updates);
    return response.data;
  },
  
  // Delete profile
  delete: async (profileId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}`);
    return response.data;
  },
  
  // Get profile password
  getPassword: async (profileId) => {
    const response = await api.get(`/api/profiles/${profileId}/password`);
    return response.data;
  },
  
  // Update profile password
  updatePassword: async (profileId, password) => {
    const response = await api.put(`/api/profiles/${profileId}/password`, {
      password
    });
    return response.data;
  },
  
  // === Accessibility Management (for ManageAccessModal) ===
  // These handle whitelist/blacklist logic based on all_images/all_albums flags
  
  // Set images as accessible to profile
  setImagesAccessible: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible-images`, {
      image_ids: imageIds
    });
    return response.data;
  },
  
  // Set images as inaccessible to profile
  setImagesInaccessible: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible-images`, {
      data: { image_ids: imageIds }
    });
    return response.data;
  },
  
  // Set albums as accessible to profile
  setAlbumsAccessible: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible-albums`, {
      album_ids: albumIds
    });
    return response.data;
  },
  
  // Set albums as inaccessible to profile
  setAlbumsInaccessible: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible-albums`, {
      data: { album_ids: albumIds }
    });
    return response.data;
  },
  
  // Set groups as accessible to profile
  setGroupsAccessible: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible-groups`, {
      group_ids: groupIds
    });
    return response.data;
  },
  
  // Set groups as inaccessible to profile
  setGroupsInaccessible: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible-groups`, {
      data: { group_ids: groupIds }
    });
    return response.data;
  },
  
  // === Direct Child Manipulation (for EditProfileModal) ===
  // These directly add/remove from profile relations, ignoring accessibility logic
  
  // Add images to profile (direct relation)
  addImagesToProfile: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/images`, {
      image_ids: imageIds
    });
    return response.data;
  },
  
  // Remove images from profile (direct relation)
  removeImagesFromProfile: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/images`, {
      data: { image_ids: imageIds }
    });
    return response.data;
  },
  
  // Add albums to profile (direct relation)
  addAlbumsToProfile: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/albums`, {
      album_ids: albumIds
    });
    return response.data;
  },
  
  // Remove albums from profile (direct relation)
  removeAlbumsFromProfile: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/albums`, {
      data: { album_ids: albumIds }
    });
    return response.data;
  },
  
  // Add groups to profile (direct relation)
  addGroupsToProfile: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/groups`, {
      group_ids: groupIds
    });
    return response.data;
  },
  
  // Remove groups from profile (direct relation)
  removeGroupsFromProfile: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/groups`, {
      data: { group_ids: groupIds }
    });
    return response.data;
  },
  
  // Check image access for profile
  checkImageAccess: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_IMAGE_ACCESS:${eventId}:${profileId}:${imageIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/images/check`, {
        image_ids: imageIds
      });
      return response.data;
    });
  },
  
  // Check album access for profile
  checkAlbumAccess: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_ALBUM_ACCESS:${eventId}:${profileId}:${albumIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/albums/check`, {
        album_ids: albumIds
      });
      return response.data;
    });
  },
  
  // Check group access for profile
  checkGroupAccess: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_GROUP_ACCESS:${eventId}:${profileId}:${groupIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/groups/check`, {
        group_ids: groupIds
      });
      return response.data;
    });
  },
  
  // Get current profile data
  getCurrentProfile: async (eventUrl = null) => {
    const params = {};
    let eventId = null;
    if (eventUrl) {
      eventId = await getEventIdForApi(eventUrl);
      params.event_id = eventId;
    }
    const key = `GET_CURRENT_PROFILE:${eventId || 'no-event'}`;
    return await withDedupe(key, async () => {
      const response = await api.get('/api/profiles/current', { params });
      return response.data;
    });
  },
  
  // Get archived access for current profile
  getArchivedAccess: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/profiles/current/archived-access`);
    return response.data;
  },
  
  // Get favorites access for current profile
  getFavoritesAccess: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/profiles/current/favorites-access`);
    return response.data;
  },
  
  // Get current profile preferences
  getPreferences: async () => {
    const key = 'GET_PROFILE_PREFERENCES';
    return await withDedupe(key, async () => {
      const response = await api.get('/api/profiles/current/preferences');
      return response.data;
    });
  },
  
  // Update a single preference
  updatePreference: async (preferenceGroup, preferenceKey, preferenceValue) => {
    const response = await api.put('/api/profiles/current/preferences', {
      preference_group: preferenceGroup,
      preference_key: preferenceKey,
      preference_value: preferenceValue
    });
    return response.data;
  },

  // === Public Access Code Management ===
  
  // Generate public access code for a profile
  generatePublicAccessCode: async (profileId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/public-access-code`);
    return response.data;
  },
  
  // Reset public access code for a profile (generates new one)
  resetPublicAccessCode: async (profileId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/public-access-code`);
    return response.data;
  },
  
  // Remove public access code for a profile
  removePublicAccessCode: async (profileId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/public-access-code`);
    return response.data;
  }
};

// Uploads API
export const uploadsAPI = {
  // Get all uploads
  getAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `UPLOADS_GET_ALL:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/uploads`);
      return response.data;
    });
  },
  
  // Get upload by ID
  getById: async (uploadId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `UPLOAD_GET_BY_ID:${eventId}:${uploadId}`;
    const result = await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/uploads/${uploadId}`);
      return response.data;
    });
    return result;
  },
  
  // Update upload (notes only)
  update: async (uploadId, data, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.patch(`/api/events/${eventId}/uploads/${uploadId}`, data);
    return response.data;
  },
  
  // Delete upload
  delete: async (uploadId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/uploads/${uploadId}`);
    return response.data;
  },
  
};

// Requests API
export const requestsAPI = {
  // ==================== MANAGER ROUTES ====================
  
  // Get all requests (for managers)
  getAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `REQUESTS_GET_ALL:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/requests`);
      return response.data;
    });
  },
  
  // Get request by ID (for managers)
  getById: async (requestId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `REQUEST_GET_BY_ID:${eventId}:${requestId}`;
    const result = await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/requests/${requestId}`);
      return response.data;
    });
    return result;
  },
  
  // Delete request (for managers)
  delete: async (requestId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/requests/${requestId}`);
    return response.data;
  },
  
  // ==================== USER ROUTES (my requests) ====================
  
  // Get all my requests
  getMyRequests: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/my-requests`);
    return response.data;
  },
  
  // Get open requests count (for managers)
  getOpenCount: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/requests`);
    return {
      count: response.data?.changes?.[0]?.items?.filter(r => !r.is_closed).length || 0
    };
  },
  
  // Get my request by ID
  getMyRequestById: async (requestId, eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    // Include cache-busting param in key if present
    const cacheKey = params._t ? `${eventId}:${requestId}:${params._t}` : `${eventId}:${requestId}`;
    const key = `MY_REQUEST_GET_BY_ID:${cacheKey}`;
    const result = await withDedupe(key, async () => {
      const queryString = params._t ? `?_t=${params._t}` : '';
      const response = await api.get(`/api/events/${eventId}/my-requests/${requestId}${queryString}`);
      return response.data;
    });
    return result;
  },
  
  // Create request (POST to /requests endpoint)
  create: async (data, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/requests`, data);
    return response.data;
  },
  
  // Update my request
  updateMyRequest: async (requestId, data, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.patch(`/api/events/${eventId}/my-requests/${requestId}`, data);
    return response.data;
  },
  
  // Delete my request
  deleteMyRequest: async (requestId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/my-requests/${requestId}`);
    return response.data;
  },
    
  // Toggle request (approve/deny groups)
  toggle: async (requestId, groupsApproved, groupsDenied, closedDetails, profileName, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const data = { 
      groupsApproved: groupsApproved || [],
      groupsDenied: groupsDenied || [],
      closedDetails: closedDetails || null,
      profileName: profileName || null
    };
    const response = await api.post(`/api/events/${eventId}/requests/${requestId}/toggle`, data);
    return response.data;
  },
  
};

// Notifications API
export const notificationsAPI = {
  getMy: async () => {
    const response = await api.get(`/api/notifications/my`);
    return response.data || {};
  },
  markAllRead: async () => {
    const response = await api.patch(`/api/notifications/my/mark-all-read`);
    return response.data || {};
  },
  markRead: async (notificationId, read = 1) => {
    const response = await api.patch(`/api/notifications/my/${notificationId}/read`, { read });
    return response.data || {};
  },
  delete: async (notificationId) => {
    const response = await api.delete(`/api/notifications/my/${notificationId}`);
    return response.data || {};
  },
  deleteAll: async () => {
    const response = await api.delete(`/api/notifications/my/all`);
    return response.data || {};
  },
  getUnreadCount: async () => {
    const response = await api.get(`/api/notifications/my/unread-count`);
    return response.data || {};
  },
  getTotalCount: async () => {
    const response = await api.get(`/api/notifications/my/total-count`);
    return response.data || {};
  },
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
  },

  // Authenticate with public access code
  authenticateWithPublicCode: async (eventUrl, publicCode) => {
    const eventId = await getEventIdForApi(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    
    const response = await api.post(`/api/events/${eventId}/public-access/${publicCode}`, {}, { 
      withCredentials: true 
    });
    return response.data;
  }
};

// Export constants for components that need them
export { API_BASE };

export default api; 


