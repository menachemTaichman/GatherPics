import axios from 'axios';
import { useDataStore, CHANGE_TYPES, handleDataChange } from './dataManager';

// API base URL
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to log requests
api.interceptors.request.use(
  (config) => {
    console.log('API Request:', {
      method: config.method?.toUpperCase(),
      url: config.url,
      data: config.data,
      dataString: JSON.stringify(config.data),
      headers: config.headers
    });
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle change instructions
api.interceptors.response.use(
  (response) => {
    console.log('API Response:', {
      status: response.status,
      url: response.config.url,
      data: response.data
    });
    // Process change instructions from backend
    if (response.data && response.data.changes) {
      response.data.changes.forEach(change => {
        handleDataChange(change.type, change.data);
      });
    }
    return response;
  },
  (error) => {
    console.error('API Error:', error);
    console.error('API Error Details:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
      url: error.config?.url
    });
    return Promise.reject(error);
  }
);

// Groups API
export const groupsAPI = {
  // Get all groups
  getAll: async () => {
    const response = await api.get('/api/groups');
    return response.data;
  },

  // Get specific group
  getById: async (groupId) => {
    const response = await api.get(`/api/groups/${groupId}`);
    return response.data;
  },

  // Update group
  update: async (groupId, updates) => {
    console.log('groupsAPI.update called with:', { groupId, updates });
    const response = await api.put(`/api/groups/${groupId}`, updates);
    console.log('groupsAPI.update response:', response.data);
    return response.data;
  },

  // Delete group
  delete: async (groupId) => {
    const response = await api.delete(`/api/groups/${groupId}`);
    return response.data;
  },

  // Check group name conflict
  checkName: async (label, excludeGroupId = '') => {
    const response = await api.post('/api/groups/check-name', {
      label,
      exclude_group_id: excludeGroupId
    });
    return response.data;
  },

  // Transfer faces between groups
  transferFaces: async (oldGroupId, faceIds, targetGroupId = null, newGroupName = null) => {
    const response = await api.post('/api/groups/transfer-faces', {
      old_group_id: oldGroupId,
      face_ids: faceIds,
      target_group_id: targetGroupId,
      new_group_name: newGroupName
    });
    return response.data;
  },

  // Merge groups
  merge: async (sourceGroupIds, targetGroupId) => {
    const response = await api.post('/api/groups/merge', {
      source_group_ids: sourceGroupIds,
      target_group_id: targetGroupId
    });
    
    // The response should include the updated target group data
    // This allows the frontend to update state correctly without additional API calls
    return response.data;
  },

  // Get group photos
  getPhotos: async (groupId) => {
    const response = await api.get(`/api/groups/${groupId}/photos`);
    return response.data;
  },

  // Get group photos complete
  getPhotosComplete: async (groupId) => {
    const response = await api.get(`/api/groups/${groupId}/photos-complete`);
    return response.data;
  },

  // Get group crops
  getCrops: async (groupId) => {
    const response = await api.get(`/api/groups/${groupId}/crops`);
    return response.data;
  },

  // Get related groups
  getRelatedGroups: async (groupId) => {
    const response = await api.get(`/api/groups/${groupId}/related-groups`);
    return response.data;
  },

  // Get filtered photos
  getFilteredPhotos: async (groupId, filterGroups = [], filterMode = 'and', onlySelected = false) => {
    const params = new URLSearchParams();
    
    // Add filter groups as multiple parameters
    filterGroups.forEach(groupId => {
      params.append('filter_groups', groupId);
    });
    
    params.append('filter_mode', filterMode);
    params.append('only_selected', onlySelected.toString());
    
    const response = await api.get(`/api/groups/${groupId}/filtered-photos?${params.toString()}`);
    return response.data;
  }
};

// Moments API
export const momentsAPI = {
  // Get all moments
  getAll: async () => {
    const response = await api.get('/api/moments');
    return response.data;
  },

  // Create moment
  create: async (momentData) => {
    const response = await api.post('/api/moments', momentData);
    return response.data;
  },

  // Update moment
  update: async (momentId, updates) => {
    const response = await api.put(`/api/moments/${momentId}`, updates);
    return response.data;
  },

  // Delete moment
  delete: async (momentId) => {
    const response = await api.delete(`/api/moments/${momentId}`);
    return response.data;
  },

  // Get moment photos
  getPhotos: async (momentId) => {
    const response = await api.get(`/api/moments/${momentId}/photos`);
    return response.data;
  },

  // Get moment photos complete
  getPhotosComplete: async (momentId) => {
    const response = await api.get(`/api/moments/${momentId}/photos-complete`);
    return response.data;
  },

  // Get moment photos in period
  getPhotosInPeriod: async (momentId) => {
    const response = await api.get(`/api/moments/${momentId}/photos-in-period`);
    return response.data;
  }
};

// Photos API
export const photosAPI = {
  // Get photo faces
  getFaces: async (imageId) => {
    const response = await api.get(`/api/photos/${imageId}/faces`);
    return response.data;
  },

  // Get photo info
  getInfo: async (imageId) => {
    const response = await api.get(`/api/photos/${imageId}/info`);
    return response.data;
  },

  // Get photo complete
  getComplete: async (imageId) => {
    const response = await api.get(`/api/photos/${imageId}/complete`);
    return response.data;
  }
};

// Download API
export const downloadAPI = {
  // Download images
  download: async (imageIds, format = 'zip') => {
    const response = await api.post('/api/download', {
      image_ids: imageIds,
      format
    });
    return response.data;
  }
};

// Images API
export const imagesAPI = {
  // Get all images
  getAll: async () => {
    const response = await api.get('/api/images.json');
    return response.data;
  }
};

// Optimistic update helpers
export const optimisticUpdates = {
  // Optimistic group update
  updateGroup: async (groupId, updates, rollbackFn) => {
    console.log('optimisticUpdates.updateGroup called with:', { groupId, updates });
    const store = useDataStore.getState();
    const previousState = store.groups.find(g => g.groupID === groupId);
    
    // Apply optimistic update
    store.updateGroup(groupId, updates);
    
    try {
      console.log('Calling groupsAPI.update...');
      const result = await groupsAPI.update(groupId, updates);
      console.log('groupsAPI.update result:', result);
      
      // Process any change instructions from the backend
      if (result.changes) {
        result.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      }
      
      return result;
    } catch (error) {
      console.error('optimisticUpdates.updateGroup error:', error);
      // Rollback on error
      if (rollbackFn && previousState) {
        rollbackFn(previousState);
      }
      throw error;
    }
  },

  // Optimistic group delete
  deleteGroup: async (groupId, rollbackFn) => {
    const store = useDataStore.getState();
    const previousState = store.groups.find(g => g.groupID === groupId);
    
    // Apply optimistic update
    store.deleteGroup(groupId);
    
    try {
      const result = await groupsAPI.delete(groupId);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        store.addGroup(previousState);
      }
      throw error;
    }
  },

  // Optimistic moment update
  updateMoment: async (momentId, updates, rollbackFn) => {
    const store = useDataStore.getState();
    const previousState = store.moments.find(m => m.id === momentId);
    
    // Apply optimistic update
    store.updateMoment(momentId, updates);
    
    try {
      const result = await momentsAPI.update(momentId, updates);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
        rollbackFn(previousState);
      }
      throw error;
    }
  },

  // Optimistic moment delete
  deleteMoment: async (momentId, rollbackFn) => {
    const store = useDataStore.getState();
    const previousState = store.moments.find(m => m.id === momentId);
    
    // Apply optimistic update
    store.deleteMoment(momentId);
    
    try {
      const result = await momentsAPI.delete(momentId);
      return result;
    } catch (error) {
      // Rollback on error
      if (rollbackFn && previousState) {
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

export default api; 