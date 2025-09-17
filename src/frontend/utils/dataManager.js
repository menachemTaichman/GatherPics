import { create } from 'zustand';

// Data change types for tracking what needs to be updated
export const CHANGE_TYPES = {
  // Group changes
  GROUP_UPDATED: 'GROUP_UPDATED',
  GROUP_DELETED: 'GROUP_DELETED',
  GROUP_CREATED: 'GROUP_CREATED',
  GROUP_FACES_TRANSFERRED: 'GROUP_FACES_TRANSFERRED',
  
  // Moment changes
  MOMENT_CREATED: 'MOMENT_CREATED',
  MOMENT_UPDATED: 'MOMENT_UPDATED',
  MOMENT_DELETED: 'MOMENT_DELETED',
  MOMENT_IMAGES_ADDED: 'MOMENT_IMAGES_ADDED',
  MOMENT_IMAGES_REMOVED: 'MOMENT_IMAGES_REMOVED',
  
  // Image changes
  IMAGE_ALBUMS_UPDATED: 'IMAGE_ALBUMS_UPDATED',
  IMAGE_SELECTION_CHANGED: 'IMAGE_SELECTION_CHANGED',
  IMAGE_VIEWER_UPDATED: 'IMAGE_VIEWER_UPDATED',
  
  // Global changes
  GROUPS_REFRESH: 'GROUPS_REFRESH',
  MOMENTS_REFRESH: 'MOMENTS_REFRESH',
};

// Data store using Zustand for centralized state management
export const useDataStore = create((set, get) => ({
  // State
  groups: [],
  moments: [],
  selectedImages: new Set(),
  imageViewer: { show: false, image: null, index: 0 },
  loading: false,
  error: null,
  lastImagesRefresh: null,
  lastAlbumAdd: null,
  favoritesAlbumId: null,
  archiveAlbumId: null,
  
  // Actions
  setGroups: (groups) => set({ groups }),
  setMoments: (moments) => set({ moments }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearLastTransferResult: () => set({ lastTransferResult: null }),
  setImagesRefresh: (data) => set({ lastImagesRefresh: { timestamp: Date.now(), imageIds: data.image_ids } }),
  addImagesToAlbum: (result) => set({ lastAlbumAdd: result }),
  setFavoritesAlbumId: (id) => set({ favoritesAlbumId: id }),
  setArchiveAlbumId: (id) => set({ archiveAlbumId: id }),
  
  // Group operations
  updateGroup: (groupId, updates) => {
    set((state) => ({
      groups: state.groups.map(group => 
        group.groupID === groupId ? { ...group, ...updates } : group
      )
    }));
  },
  
  replaceGroup: (groupId, newGroupData) => {
    set((state) => ({
      groups: state.groups.map(group => 
        group.groupID === groupId ? newGroupData : group
      )
    }));
  },
  
  deleteGroup: (groupId) => {
    set((state) => ({
      groups: state.groups.filter(group => group.groupID !== groupId)
    }));
  },
  
  addGroup: (group) => {
    set((state) => ({
      groups: [...state.groups, group]
    }));
  },
  
  // Transfer faces between groups
  transferFaces: (result) => {
    set((state) => {
      const newGroups = [...state.groups];
      
      // Update source group if it exists and wasn't deleted
      if (result.updated_source_group) {
        const sourceGroupIndex = newGroups.findIndex(g => g.groupID === result.updated_source_group.groupID);
        if (sourceGroupIndex !== -1) {
          newGroups[sourceGroupIndex] = result.updated_source_group;
        }
      }
      
      // Remove source group if it was deleted
      if (result.old_group_deleted && result.old_group_id) {
        const sourceGroupIndex = newGroups.findIndex(g => g.groupID === result.old_group_id);
        if (sourceGroupIndex !== -1) {
          newGroups.splice(sourceGroupIndex, 1);
        }
      }
      
      // Update or add target group
      if (result.updated_target_group) {
        const targetGroupIndex = newGroups.findIndex(g => g.groupID === result.updated_target_group.groupID);
        if (targetGroupIndex !== -1) {
          newGroups[targetGroupIndex] = result.updated_target_group;
        } else {
          newGroups.push(result.updated_target_group);
        }
      }
      
      // Ensure no duplicate groups in the final array
      const uniqueGroups = newGroups.reduce((unique, group) => {
        if (!unique.some(g => g.groupID === group.groupID)) {
          unique.push(group);
        }
        return unique;
      }, []);
      
      return { 
        groups: uniqueGroups,
        lastTransferResult: {
          ...result,
          transferred_images_data: result.transferred_images_data || [] // Include full image data
        }
      };
    });
  },


  
  // Moment operations
  updateMoment: (momentId, updates) => {
    set((state) => ({
      moments: state.moments.map(moment => 
        moment.momentID === momentId ? { ...moment, ...updates } : moment
      )
    }));
  },
  
  deleteMoment: (momentId) => {
    set((state) => ({
      moments: state.moments.filter(moment => moment.momentID !== momentId)
    }));
  },
  
  addMoment: (moment) => {
    set((state) => ({
      moments: [...state.moments, moment]
    }));
  },
  
  // Image operations
  setSelectedImages: (selectedImages) => set({ selectedImages }),
  setImageViewer: (imageViewer) => set({ imageViewer }),
  
  // Clear all data
  clearData: () => set({
    groups: [],
    moments: [],
    selectedImages: new Set(),
    imageViewer: { show: false, image: null, index: 0 },
    loading: false,
    error: null
  })
}));

// Data change handler - processes API responses and updates state accordingly
export const handleDataChange = (changeType, data, store = useDataStore.getState()) => {
  switch (changeType) {
    case CHANGE_TYPES.GROUP_UPDATED:
      // Merge updates to avoid losing fields when backend sends partial payloads
      store.updateGroup(data.groupID, data);
      break;
      
    case CHANGE_TYPES.GROUP_DELETED:
      store.deleteGroup(data.groupID);
      break;
      
    case CHANGE_TYPES.GROUP_CREATED:
      store.addGroup(data);
      break;
      
    case CHANGE_TYPES.GROUP_FACES_TRANSFERRED:
      store.transferFaces(data);
      break;
      

      
    case CHANGE_TYPES.IMAGE_ALBUMS_UPDATED:
      store.setImagesRefresh(data);
      break;
      
    case CHANGE_TYPES.MOMENT_UPDATED:
      store.updateMoment(data.momentID, data);
      break;
      
    case CHANGE_TYPES.MOMENT_DELETED:
      store.deleteMoment(data.momentID);
      break;
      
    case CHANGE_TYPES.MOMENT_CREATED:
      store.addMoment(data);
      break;
      
    case CHANGE_TYPES.GROUPS_REFRESH:
      // This will trigger a full refresh of groups
      break;
      
    case CHANGE_TYPES.MOMENTS_REFRESH:
      // This will trigger a full refresh of moments
      break;
    
    default:
      console.warn(`Unknown change type: ${changeType}`);
  }
};

// API wrapper that includes change tracking
export const apiCall = async (method, url, data = null, expectedChanges = []) => {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.message || 'API call failed');
    }
    
    // Process any expected changes
    if (expectedChanges && expectedChanges.length > 0) {
      expectedChanges.forEach(change => {
        handleDataChange(change.type, change.data || result);
      });
    }
    
    return result;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};

// Optimistic update helper
export const optimisticUpdate = async (updateFn, apiCall, rollbackFn) => {
  // Apply optimistic update
  const previousState = updateFn();
  
  try {
    // Make API call
    const result = await apiCall();
    
    // If successful, apply any additional changes from response
    if (result.changes) {
      result.changes.forEach(change => {
        handleDataChange(change.type, change.data);
      });
    }
    
    return result;
  } catch (error) {
    // Rollback on error
    if (rollbackFn) {
      rollbackFn(previousState);
    }
    throw error;
  }
};

 