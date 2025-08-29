import axios from 'axios';
import { useDataStore, CHANGE_TYPES, handleDataChange } from './dataManager';

// API base URL - centralized configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// Fixed event ID (should match backend) - centralized
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
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
  getEventUrl: (endpoint) => `${API_BASE}/api/events/${FIXED_EVENT_ID}${endpoint}`,
  
  // Get image URLs
  getDisplayImageUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`,
  getThumbnailUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/thumb/${imageId}.webp`,
  getHighQualityUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/high_quality/${imageId}.webp`,
  getOriginalUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/original/${imageId}.webp`,
  getFaceCropUrl: (faceId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`,
  
  // Get relative URLs (for use in components that need relative paths)
  getRelativeDisplayUrl: (imageId) => `/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`,
  getRelativeThumbnailUrl: (imageId) => `/api/events/${FIXED_EVENT_ID}/thumb/${imageId}.webp`,
  getRelativeFaceCropUrl: (faceId) => `/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`,
};

// Groups API
export const groupsAPI = {
  // Get all groups
  getAll: async (eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups`);
    return response.data;
  },

  // Get specific group
  getById: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}`);
    return response.data;
  },

  // Update group
  update: async (groupId, updates, eventId = FIXED_EVENT_ID) => {
    const response = await api.put(`/api/events/${eventId}/groups/${groupId}`, updates);
    return response.data;
  },

  // Delete group
  delete: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.delete(`/api/events/${eventId}/groups/${groupId}`);
    return response.data;
  },

  // Check group name conflict
  checkName: async (label, excludeGroupId = '', eventId = FIXED_EVENT_ID) => {
    const response = await api.post(`/api/events/${eventId}/groups/check-name`, {
      label,
      exclude_group_id: excludeGroupId
    });
    return response.data;
  },

  // Transfer faces between groups
  transferFaces: async (sourceGroupId, targetGroupId, faceIds, eventId = FIXED_EVENT_ID, newGroupName = null) => {
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

  // Get group images
  getImages: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/images`);
    return response.data;
  },

  // Get group images complete
  getImagesComplete: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/images-complete`);
    return response.data;
  },

  // Get group crops
  getCrops: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/crops`);
    return response.data;
  },

  // Get related groups
  getRelatedGroups: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/related-groups`);
    return response.data;
  },

  // Get filtered images
  getFilteredImages: async (groupId, filterGroups = [], filterMode = 'and', onlySelected = false, currentImageIds = [], eventId = FIXED_EVENT_ID) => {
    const params = new URLSearchParams();
    
    params.append('mode', filterMode);
    params.append('only', onlySelected.toString());
    
    if (filterGroups.length > 0) {
      params.append('related_groups', filterGroups.join(','));
    }

    if (currentImageIds.length > 0) {
      params.append('current_image_ids', currentImageIds.join(','));
    }
    
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/filtered-images?${params.toString()}`);
    return response.data;
  },

  // Get group representative face
  getRepresentative: async (groupId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/groups/${groupId}/representative`);
    return response.data;
  }
};

// Moments API
export const momentsAPI = {
  // Get all moments
  getAll: async (eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/moments`);
    return response.data;
  },

  // Get specific moment
  getById: async (momentId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}`);
    return response.data;
  },

  // Create moment
  create: async (momentData, eventId = FIXED_EVENT_ID) => {
    const response = await api.post(`/api/events/${eventId}/moments`, momentData);
    return response.data;
  },

  // Update moment
  update: async (momentId, updates, eventId = FIXED_EVENT_ID) => {
    const response = await api.put(`/api/events/${eventId}/moments/${momentId}`, updates);
    return response.data;
  },

  // Delete moment
  delete: async (momentId, eventId = FIXED_EVENT_ID) => {
    const response = await api.delete(`/api/events/${eventId}/moments/${momentId}`);
    return response.data;
  },

  // Get moment images
  getImages: async (momentId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}/images`);
    return response.data;
  },

  // Get moment images complete
  getImagesComplete: async (momentId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}/images-complete`);
    return response.data;
  },



  // Get moment representative image
  getRepresentative: async (momentId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/moments/${momentId}/representative`);
    return response.data;
  }
};

// Images API
export const imagesAPI = {
  // Get image faces
  getFaces: async (imageId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/images/${imageId}/faces`);
    return response.data;
  },

  // Get image info
  getInfo: async (imageId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/images/${imageId}/info`);
    return response.data;
  },

  // Get image complete
  getComplete: async (imageId, eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/images/${imageId}/complete`);
    return response.data;
  },

  // Get all images
  getAll: async (eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/images.json`);
    return response.data;
  }
};

// Download API
export const downloadAPI = {
  // Download images
  download: async (imageIds, format = 'zip', eventId = FIXED_EVENT_ID) => {
    const response = await api.post(`/api/events/${eventId}/download`, {
      image_ids: imageIds,
      format
    });
    return response.data;
  }
};



// Profile API
export const profileAPI = {
  // Get profile permissions
  getPermissions: async (eventId = FIXED_EVENT_ID) => {
    const response = await api.get(`/api/events/${eventId}/profile/permissions`);
    return response.data;
  }
};

// Optimistic update helpers
export const optimisticUpdates = {
  // Optimistic group update
  updateGroup: async (groupId, updates, rollbackFn, eventId = FIXED_EVENT_ID) => {
    const store = useDataStore.getState();
    const previousState = store.groups.find(g => g.groupID === groupId);
    
    // Apply optimistic update
    store.updateGroup(groupId, updates);
    
    try {
      const result = await groupsAPI.update(groupId, updates, eventId);
      
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
  deleteGroup: async (groupId, rollbackFn, eventId = FIXED_EVENT_ID) => {
    const store = useDataStore.getState();
    const previousState = store.groups.find(g => g.groupID === groupId);
    
    // Apply optimistic update
    store.deleteGroup(groupId);
    
    try {
      const result = await groupsAPI.delete(groupId, eventId);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        store.addGroup(previousState);
      }
      throw error;
    }
  },

  createMoment: async (momentData, rollbackFn, eventId = FIXED_EVENT_ID) => {
    const store = useDataStore.getState();
    const tempId = `temp-${Date.now()}`;
    const newMoment = { ...momentData, momentID: tempId };

    // Apply optimistic update
    store.addMoment(newMoment);

    try {
      const result = await momentsAPI.create(momentData, eventId);
      
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
  updateMoment: async (momentId, updates, rollbackFn, eventId = FIXED_EVENT_ID) => {
    const store = useDataStore.getState();
    const previousState = store.moments.find(m => m.momentID === momentId);
    
    // Apply optimistic update
    store.updateMoment(momentId, updates);
    
    try {
      const result = await momentsAPI.update(momentId, updates, eventId);
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
  deleteMoment: async (momentId, rollbackFn, eventId = FIXED_EVENT_ID) => {
    const store = useDataStore.getState();
    const previousState = store.moments.find(m => m.momentID === momentId);
    
    // Apply optimistic update
    store.deleteMoment(momentId);
    
    try {
      const result = await momentsAPI.delete(momentId, eventId);
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

// Export constants for components that need them
export { FIXED_EVENT_ID, API_BASE };

export default api; 