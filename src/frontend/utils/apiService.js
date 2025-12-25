import axios from 'axios';
import { useDataStore, STORAGE_KEYS } from './dataManager';
import { resolveEventId } from './eventResolver';
import jwtService from './jwtService';

// API base URL - centralized configuration
// Use relative URLs (empty string) in both dev and production since:
// - In dev: Vite proxy handles it and cookies work
// - In production: Flask serves both frontend and backend from the same domain
// VITE_API_BASE is only needed for vite.config.js proxy target in development
const API_BASE = '';

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
    const publicEndpoints = ['/api/events/resolve', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];
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

function normalizeChangeItems(entity, items) {
  const normalizedEntity = String(entity || '').toLowerCase();
  const rawItems = Array.isArray(items)
    ? items
    : items && typeof items === 'object'
      ? Object.entries(items).map(([id, value]) => ({ id, ...value }))
      : [];

  if (normalizedEntity === 'event' || normalizedEntity === 'events') {
    return rawItems
      .map((evt) => {
        if (!evt) return null;
        const eventId = evt.event_id || evt.id || evt.eventId || evt.url || evt.slug;
        if (!eventId) return null;
        return {
          ...evt,
          id: eventId,
          event_id: eventId,
        };
      })
      .filter(Boolean);
  }

  return rawItems;
}

function normalizeChanges(changes, defaultEventId) {
  return changes.map((ch) => {
    const items = normalizeChangeItems(ch?.entity, ch?.items);
    return {
      ...ch,
      entity: ch?.entity === 'events' ? 'event' : ch?.entity,
      items,
      event_id: ch?.event_id || defaultEventId || 'general',
      ignoreScope: ch?.ignoreScope !== undefined ? ch.ignoreScope : true,
      broadcast: false,
    };
  });
}

// Response interceptor - Handle changes and 401 errors
api.interceptors.response.use(
  (response) => {
    // Apply changes to store if present
    if (response.data && response.data.changes) {
      const store = useDataStore.getState();
      let changes = Array.isArray(response.data.changes) 
        ? response.data.changes 
        : [];
      
      // Special handling for currentProfile API: merge events field intelligently
      const isCurrentProfileEndpoint = response.config.url?.includes('/api/profiles/current') && 
                                        response.config.method === 'get';
      
      if (isCurrentProfileEndpoint) {
        changes = changes.map((ch) => {
          // Only transform localStorage UPSERT changes for currentProfile
          if (ch.type === 'UPSERT' && 
              ch.entity === 'localStorage' && 
              ch.items?.currentProfile) {
            
            try {
              // Get existing currentProfile from localStorage
              const storageKey = STORAGE_KEYS.CURRENT_PROFILE;
              const existingRaw = localStorage.getItem(storageKey);
              const existing = existingRaw ? JSON.parse(existingRaw) : {};
              
              // Extract events from new data
              const newProfile = ch.items.currentProfile;
              const newEvents = newProfile.events || {};
              const existingEvents = existing.events || {};
              
              // Merge events: preserve all existing events, update/merge the ones in new data
              const mergedEvents = { ...existingEvents };
              Object.keys(newEvents).forEach((eventId) => {
                // If event already exists, merge the data; otherwise, add it
                if (mergedEvents[eventId]) {
                  mergedEvents[eventId] = { ...mergedEvents[eventId], ...newEvents[eventId] };
                } else {
                  mergedEvents[eventId] = newEvents[eventId];
                }
              });
              
              // Merge all other fields (non-events) from new data into existing
              const { events: _, ...otherFields } = newProfile;
              const mergedProfile = { ...existing, ...otherFields, events: mergedEvents };
              
              // Return transformed change with merged profile
              return {
                ...ch,
                items: {
                  ...ch.items,
                  currentProfile: mergedProfile
                }
              };
            } catch (e) {
              console.warn('Failed to merge currentProfile events:', e);
              // Fall back to original change on error
              return ch;
            }
          }
          return ch;
        });
      }
      
      // Extract event_id from request URL
      const eventIdMatch = response.config.url?.match(/\/events\/([^\/]+)/);
      const defaultEventId = eventIdMatch ? eventIdMatch[1] : 'general';
      
      // Inject event_id into changes that don't have it
      const enrichedChanges = normalizeChanges(changes, defaultEventId);

      store.applyChanges(enrichedChanges);

      // Expose normalized changes for consumers that need to derive follow-up logic
      response.data.__appliedChanges = enrichedChanges;

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
    return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.jpg`;
  },
  getOriginalUrl: async (eventUrl, imageId) => {
    const eventId = await resolveEventId(eventUrl);
    if (!eventId) {
      throw new Error(`Event not found: ${eventUrl}`);
    }
    return `${API_BASE}/api/events/${eventId}/original/${imageId}.jpg`;
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
    return `${API_BASE}/api/events/${eventId}/high_quality/${imageId}.jpg`;
  },
  getOriginalUrlSync: (eventId, imageId) => {
    return `${API_BASE}/api/events/${eventId}/original/${imageId}.jpg`;
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

// Event management
export const eventsAPI = {
  list: async () => {
    const response = await api.get(`/api/events`);
    return response.data || {};
  },

  create: async (data) => {
    const response = await api.post(`/api/events`, data);
    return response.data || {};
  },

  delete: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}`);
    return response.data || {};
  },

  getById: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `EVENT_GET_BY_ID:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}`);
      return response.data || {};
    });
  },

  update: async (eventUrl, updates) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}`, updates);
    return response.data || {};
  },

  checkName: async (name, excludeEventId = null) => {
    const payload = { name, exclude_event_id: excludeEventId };
    const response = await api.post(`/api/events/check-name`, payload);
    return response.data || {};
  },

  checkUrl: async (url, excludeEventId = null) => {
    const payload = { url, exclude_event_id: excludeEventId };
    const response = await api.post(`/api/events/check-url`, payload);
    return response.data || {};
  },

  getUploadsLimits: async () => {
    const response = await api.get(`/api/events/uploads-limits`);
    return response.data || {};
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
    // Use getFacesInImages for consistency (single image is just a list with one item)
    return groupsAPI.getFacesInImages(groupId, [imageId], eventUrl);
  },

  getFacesInImages: async (groupId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `GROUP_GET_FACES_IN_IMAGES:${eventId}:${groupId}:${imageIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/groups/${groupId}/faces`, { image_ids: imageIds });
      const data = response.data || {};
      if (Array.isArray(data.faces)) {
        data.faces = data.faces.map(normalizeFace);
      }
      return data;
    });
  },

  getRelated: async (eventUrl, params = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const requestData = {
      image_ids: params.image_ids || [],
      selected_groups: params.selected_groups || []
    };
    const key = `GROUPS_GET_RELATED:${eventId}:${JSON.stringify(requestData)}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/groups/related`, requestData);
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

  update: async (imageId, updates, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.patch(`/api/events/${eventId}/images/${imageId}`, updates);
    return response.data;
  },

  delete: async (imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/images`, { 
      data: { image_ids: Array.isArray(imageIds) ? imageIds : [imageIds] } 
    });
    return response.data;
  },

  // New upload flow: Get presigned URLs, upload to S3, notify backend
  getUploadUrls: async (files, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const files_data = files.map(file => ({
      filename: file.name,
      size: file.size
    }));
    
    const response = await api.post(`/api/events/${eventId}/upload`, {
      files_data
    });
    return response.data;
  },

  notifyImageReady: async (uploadId, imageId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(`/api/events/${eventId}/upload/image_ready`, {
      upload_id: uploadId,
      image_id: imageId
    });
    return response.data;
  },

  notifyUploadFinished: async (uploadId, assignMoments, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const params = new URLSearchParams();
    if (assignMoments) {
      params.append('assign_moments', 'true');
    }
    const queryString = params.toString();
    const url = `/api/events/${eventId}/uploads/${uploadId}/finished${queryString ? `?${queryString}` : ''}`;
    const response = await api.get(url);
    return response.data;
  },

  getUploadProgress: async (uploadId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/uploads/${uploadId}/progress`);
    return response.data;
  },

  uploadWithProgress: async (files, assignMoments, eventUrl, onProgress = null) => {
    const eventId = await getEventIdForApi(eventUrl);
    // Set maximum concurrent uploads - 20 is a healthy and safe number
    const MAX_CONCURRENT_UPLOADS = 20;

    try {
      // Step 1: Get presigned URLs
      const uploadUrlsResponse = await imagesAPI.getUploadUrls(files, eventUrl);
      const { upload_id, upload_urls } = uploadUrlsResponse;
      
      if (!upload_urls || upload_urls.length === 0) {
        throw new Error('No upload URLs received');
      }

      if (onProgress) {
        onProgress({
          phase: 'init',
          upload_id,
          total: files.length,
          completed: 0,
          message: 'Upload initialized'
        });
      }
      
      // Step 2: Upload files with Concurrency Limit
      let completedCount = 0;
      const results = [];
      
      // Helper function that performs a single upload
      const uploadSingleFile = async (uploadInfo, index) => {
          const file = files[index];
          if (!file) throw new Error(`File not found index ${index}`);
          
          // Validate required fields
          if (!uploadInfo.image_id) {
            throw new Error(`Missing image_id for file ${file.name}`);
          }
          
          const uploadMethod = (uploadInfo.upload_method || 'POST').toUpperCase();
          let uploadResponse;

          if (uploadMethod === 'PUT') {
            // PUT to presigned URL (R2/S3)
            const headers = Object.assign(
              {},
              uploadInfo.upload_headers || {},
              { 'Content-Type': file.type || 'image/jpeg' }
            );
            uploadResponse = await fetch(uploadInfo.upload_url, {
              method: 'PUT',
              headers,
              body: file
            });
          } else {
            // POST (either presigned POST fields or direct upload endpoint)
            const formData = new FormData();
            formData.append('Content-Type', 'image/jpeg');
            
            if (uploadInfo.upload_fields) {
              Object.keys(uploadInfo.upload_fields).forEach(key => {
                formData.append(key, uploadInfo.upload_fields[key]);
              });
            } else {
              formData.append('image_id', uploadInfo.image_id);
            }
            
            // Let backend-provided filename drive the actual object name (falls back to local image_id or original)
            const uploadFilename = uploadInfo.stored_filename
              || (uploadInfo.image_id ? `${uploadInfo.image_id}.jpg` : file.name);
            formData.append('file', file, uploadFilename);
            
            uploadResponse = await fetch(uploadInfo.upload_url, {
              method: 'POST',
              body: formData
            });
          }
          
          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload ${file.name}: ${uploadResponse.statusText}`);
          }
          
          // Notify backend
          await imagesAPI.notifyImageReady(upload_id, uploadInfo.image_id, eventUrl);
          
          // Update progress
          completedCount++;
          if (onProgress) {
            onProgress({ 
              phase: 'uploading', 
              total: files.length, 
              completed: completedCount,
              message: `Uploaded ${completedCount} of ${files.length} files...`
            });
          }
          
          return { image_id: uploadInfo.image_id, file_index: index };
      };

      // --- Core: Queue Management ---
      // We use a simple "sliding window" technique to avoid choking the browser
      const executing = [];
      
      for (let i = 0; i < upload_urls.length; i++) {
          const uploadInfo = upload_urls[i];
          
          // Create the upload promise
          const p = uploadSingleFile(uploadInfo, i).then(
              res => ({ status: 'fulfilled', value: res }),
              err => {
                console.error(`Upload failed for file at index ${i}:`, err);
                return { status: 'rejected', reason: err };
              }
          );
          
          results.push(p); // Save the final result
          
          // Add to executing list, and remove when done
          const e = p.then(() => {
            const index = executing.indexOf(e);
            if (index > -1) {
              executing.splice(index, 1);
            }
          });
          executing.push(e);
          
          // If we've reached the limit, wait for one to finish before starting the next
          if (executing.length >= MAX_CONCURRENT_UPLOADS) {
              await Promise.race(executing);
          }
      }
      
      // Wait for all remaining uploads to finish
      const finalResults = await Promise.all(results);
      
      // Check failures
      const failures = finalResults.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn('Some files failed to upload:', failures);
      }
      
      // Final Finish Notification
      if (onProgress) {
        onProgress({ 
          phase: 'uploads_complete', 
          total: files.length, 
          completed: files.length, 
          message: 'All files uploaded to S3'
        });
      }
      
      await imagesAPI.notifyUploadFinished(upload_id, assignMoments, eventUrl);
      
      // Map results
      const fileToImageMap = {};
      finalResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          fileToImageMap[index] = result.value.image_id;
        }
      });
      
      return {
        upload_id,
        file_to_image_map: fileToImageMap,
        upload_urls: upload_urls.map((url, idx) => ({ ...url, file_index: idx }))
      };

    } catch (error) {
      throw new Error(error.response?.data?.error || error.message || 'Failed to upload files');
    }
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
  // Get presigned URLs for downloading images
  getDownloadUrls: async (imageIds, eventUrl, options = {}) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.post(
      `/api/events/${eventId}/download`,
      {
        image_ids: imageIds,
        quality: options.quality || 'high'
      }
    );
    return response.data; // { files: [{url, filename}], failed_images: [] }
  }
};

// Profile API
export const profilesAPI = {
  // Get all profiles
  getAll: async (eventUrl) => {
    // If no eventUrl, use general profiles route (for dashboard)
    if (!eventUrl) {
      const key = `PROFILES_GET_ALL:general`;
      return await withDedupe(key, async () => {
        const response = await api.get(`/api/profiles`);
        return response.data;
      });
    }
    // Otherwise use event-specific route
    const eventId = await getEventIdForApi(eventUrl);
    const key = `PROFILES_GET_ALL:${eventId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/events/${eventId}/profiles`);
      return response.data;
    });
  },
  
  // Get profiles filtered by event_id (uses profile_routes endpoint)
  getByEvent: async (eventId) => {
    if (!eventId) {
      throw new Error('event_id is required');
    }
    const key = `PROFILES_GET_BY_EVENT:${eventId}`;
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
  
  // Get general profile by ID (without event context)
  getGeneralById: async (profileId) => {
    const key = `PROFILE_GET_GENERAL_BY_ID:${profileId}`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/profiles/${profileId}`);
      return response.data;
    });
  },
  
  // Add event to profile
  addEvent: async (profileId, eventId) => {
    const response = await api.post(`/api/profiles/${profileId}/events/${eventId}`);
    return response.data;
  },
  
  // Remove event from profile
  removeEvent: async (profileId, eventId) => {
    const response = await api.delete(`/api/profiles/${profileId}/events/${eventId}`);
    return response.data;
  },
  
  // Delete event profile (removes from event, or deletes completely if restricted to that event)
  deleteEventProfile: async (profileId, eventId) => {
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}`);
    return response.data;
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
    if (eventUrl) {
      const eventId = await getEventIdForApi(eventUrl);
      const response = await api.post(`/api/events/${eventId}/profiles`, profileData);
      return response.data;
    } else {
      // Create general profile (not event-specific)
      const response = await api.post(`/api/profiles`, profileData);
      return response.data;
    }
  },
  
  // Update profile
  update: async (profileId, updates, eventUrl) => {
    if (eventUrl) {
      const eventId = await getEventIdForApi(eventUrl);
      const response = await api.put(`/api/events/${eventId}/profiles/${profileId}`, updates);
      return response.data;
    } else {
      // Update general profile (not event-specific)
      const response = await api.put(`/api/profiles/${profileId}`, updates);
      return response.data;
    }
  },
  
  // Delete profile
  delete: async (profileId, eventUrl) => {
    if (eventUrl) {
      const eventId = await getEventIdForApi(eventUrl);
      const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}`);
      return response.data;
    } else {
      // Delete general profile (not event-specific)
      const response = await api.delete(`/api/profiles/${profileId}`);
      return response.data;
    }
  },
  
  // Duplicate profile
  duplicate: async (profileId, overrides = {}) => {
    const payload = overrides || {};
    const response = await api.post(`/api/profiles/${profileId}/duplicate`, payload);
    return response.data;
  },
  
  
  // === Accessibility Management (for ManageAccessModal) ===
  // These handle whitelist/blacklist logic based on all_images/all_albums flags
  
  // Set images as accessible to profile
  setImagesAccessible: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      entity_type: 'images',
      ids: imageIds
    });
    return response.data;
  },
  
  // Set images as inaccessible to profile
  setImagesInaccessible: async (profileId, imageIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      data: {
        entity_type: 'images',
        ids: imageIds
      }
    });
    return response.data;
  },
  
  // Set albums as accessible to profile
  setAlbumsAccessible: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      entity_type: 'albums',
      ids: albumIds
    });
    return response.data;
  },
  
  // Set albums as inaccessible to profile
  setAlbumsInaccessible: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      data: {
        entity_type: 'albums',
        ids: albumIds
      }
    });
    return response.data;
  },
  
  // Set groups as accessible to profile
  setGroupsAccessible: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.put(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      entity_type: 'groups',
      ids: groupIds
    });
    return response.data;
  },
  
  // Set groups as inaccessible to profile
  setGroupsInaccessible: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
      data: {
        entity_type: 'groups',
        ids: groupIds
      }
    });
    return response.data;
  },
  
  // Get groups to request access for current profile
  getGroupsToRequestAccess: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.get(`/api/events/${eventId}/profiles/current/groups-to-request-access`);
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
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
        entity_type: 'images',
        ids: imageIds
      });
      return response.data;
    });
  },
  
  // Check album access for profile
  checkAlbumAccess: async (profileId, albumIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_ALBUM_ACCESS:${eventId}:${profileId}:${albumIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
        entity_type: 'albums',
        ids: albumIds
      });
      return response.data;
    });
  },
  
  // Check group access for profile
  checkGroupAccess: async (profileId, groupIds, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const key = `CHECK_GROUP_ACCESS:${eventId}:${profileId}:${groupIds.join(',')}`;
    return await withDedupe(key, async () => {
      const response = await api.post(`/api/events/${eventId}/profiles/${profileId}/accessible`, {
        entity_type: 'groups',
        ids: groupIds
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

  // Update current profile
  updateCurrentProfile: async (updates, eventUrl = null) => {
    const params = {};
    if (eventUrl) {
      const eventId = await getEventIdForApi(eventUrl);
      params.event_id = eventId;
    }
    const response = await api.put('/api/profiles/current', updates, { params });
    return response.data;
  },
  
  // Update current profile password
  updateCurrentProfilePassword: async (currentPassword, newPassword, eventUrl = null) => {
    const params = {};
    if (eventUrl) {
      const eventId = await getEventIdForApi(eventUrl);
      params.event_id = eventId;
    }
    const response = await api.put('/api/profiles/current/password', {
      current_password: currentPassword,
      new_password: newPassword
    }, { params });
    return response.data;
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
  generatePublicAccessCode: async (profileId) => {
    const response = await api.post(`/api/profiles/${profileId}/public-access-code`);
    return response.data;
  },
  
  // Reset public access code for a profile (generates new one)
  resetPublicAccessCode: async (profileId) => {
    const response = await api.post(`/api/profiles/${profileId}/public-access-code`);
    return response.data;
  },
  
  // Remove public access code for a profile
  removePublicAccessCode: async (profileId) => {
    const response = await api.delete(`/api/profiles/${profileId}/public-access-code`);
    return response.data;
  },

  // Get public access code for a profile
  getPublicAccessCode: async (profileId) => {
    const response = await api.get(`/api/profiles/${profileId}/public-access-code`);
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
  
  // Delete unready (failed) images in an upload
  deleteUnreadyImages: async (uploadId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/uploads/${uploadId}/unready_images`);
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

  // Delete all requests (for managers)
  deleteAll: async (eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const response = await api.delete(`/api/events/${eventId}/requests/all`);
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
  toggle: async (requestId, groupsApproved, groupsDenied, closedDetails, profileName, applicantProfileId, eventUrl) => {
    const eventId = await getEventIdForApi(eventUrl);
    const data = { 
      groups_approved: groupsApproved || [],
      groups_denied: groupsDenied || [],
      closed_details: closedDetails || null,
      profile_name: profileName || null,
      applicant_profile_id: applicantProfileId || null
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
  markRead: async (notificationId, read = true) => {
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
};

// Feedbacks API
export const feedbacksAPI = {
  // ==================== DEVELOPER ROUTES ====================
  
  // Get all feedbacks (for developer)
  getAll: async () => {
    const key = `FEEDBACKS_GET_ALL`;
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/feedbacks`);
      return response.data;
    });
  },
  
  // Get feedback by ID (for developer)
  getById: async (feedbackId) => {
    const key = `FEEDBACK_GET_BY_ID:${feedbackId}`;
    const result = await withDedupe(key, async () => {
      const response = await api.get(`/api/feedbacks/${feedbackId}`);
      return response.data;
    });
    return result;
  },
  
  // Update feedback (for developer)
  update: async (feedbackId, data) => {
    const response = await api.patch(`/api/feedbacks/${feedbackId}`, data);
    return response.data;
  },
  
  // Delete feedback (for developer)
  delete: async (feedbackId) => {
    const response = await api.delete(`/api/feedbacks/${feedbackId}`);
    return response.data;
  },

  // Delete all feedbacks (for developer)
  deleteAll: async () => {
    const response = await api.delete(`/api/feedbacks/all`);
    return response.data;
  },
  
  // ==================== USER ROUTES ====================
  
  // Get my feedbacks
  getMyFeedbacks: async () => {
    const response = await api.get(`/api/my-feedbacks`);
    return response.data;
  },
  
  // Get my feedback by ID
  getMyFeedbackById: async (feedbackId, params = {}) => {
    // Include cache-busting param in key if present
    const cacheKey = params._t ? `${feedbackId}:${params._t}` : `${feedbackId}`;
    const key = `MY_FEEDBACK_GET_BY_ID:${cacheKey}`;
    const result = await withDedupe(key, async () => {
      const queryString = params._t ? `?_t=${params._t}` : '';
      const response = await api.get(`/api/my-feedbacks/${feedbackId}${queryString}`);
      return response.data;
    });
    return result;
  },
  
  // Create feedback
  create: async (data) => {
    const response = await api.post(`/api/feedbacks`, data);
    return response.data;
  },
  
  // Update my feedback
  updateMyFeedback: async (feedbackId, data) => {
    const response = await api.patch(`/api/my-feedbacks/${feedbackId}`, data);
    return response.data;
  },
  
  // Delete my feedback
  deleteMyFeedback: async (feedbackId) => {
    const response = await api.delete(`/api/my-feedbacks/${feedbackId}`);
    return response.data;
  },
};

// Settings API
export const settingsAPI = {
  // Get system settings
  get: async () => {
    const key = 'SETTINGS_GET';
    return await withDedupe(key, async () => {
      const response = await api.get(`/api/settings`);
      return response.data;
    });
  },
  
  // Update system settings
  update: async (data) => {
    const response = await api.put(`/api/settings`, data);
    return response.data;
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
  },

  // Request password reset
  requestPasswordReset: async (email) => {
    const response = await api.post('/api/auth/request-password-reset', {
      email: email
    });
    return response.data;
  },

  // Validate reset token and get label
  validateResetToken: async (token) => {
    const response = await api.post('/api/auth/validate-reset-token', {
      token: token
    });
    return response.data;
  },

  // Reset password with token
  resetPassword: async (token, newPassword) => {
    const response = await api.post('/api/auth/reset-password', {
      token: token,
      new_password: newPassword
    }, {
      withCredentials: true
    });
    return response.data;
  }
};

// Export constants for components that need them
export { API_BASE };

export default api; 


