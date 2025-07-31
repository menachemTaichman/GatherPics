import { create } from 'zustand';

// Data change types for tracking what needs to be updated
export const CHANGE_TYPES = {
  // Group changes
  GROUP_UPDATED: 'GROUP_UPDATED',
  GROUP_DELETED: 'GROUP_DELETED',
  GROUP_CREATED: 'GROUP_CREATED',
  GROUP_FACES_TRANSFERRED: 'GROUP_FACES_TRANSFERRED',
  GROUP_MERGED: 'GROUP_MERGED',
  
  // Moment changes
  MOMENT_CREATED: 'MOMENT_CREATED',
  MOMENT_UPDATED: 'MOMENT_UPDATED',
  MOMENT_DELETED: 'MOMENT_DELETED',
  MOMENT_PHOTOS_ADDED: 'MOMENT_PHOTOS_ADDED',
  MOMENT_PHOTOS_REMOVED: 'MOMENT_PHOTOS_REMOVED',
  
  // Photo changes
  PHOTO_SELECTION_CHANGED: 'PHOTO_SELECTION_CHANGED',
  PHOTO_VIEWER_UPDATED: 'PHOTO_VIEWER_UPDATED',
  
  // Global changes
  GROUPS_REFRESH: 'GROUPS_REFRESH',
  MOMENTS_REFRESH: 'MOMENTS_REFRESH',
  PHOTOS_REFRESH: 'PHOTOS_REFRESH'
};

// Data store using Zustand for centralized state management
export const useDataStore = create((set, get) => ({
  // State
  groups: [],
  moments: [],
  selectedPhotos: new Set(),
  photoViewer: { show: false, photo: null, index: 0 },
  loading: false,
  error: null,
  
  // Actions
  setGroups: (groups) => set({ groups }),
  setMoments: (moments) => set({ moments }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  
  // Group operations
  updateGroup: (groupId, updates) => {
    set((state) => ({
      groups: state.groups.map(group => 
        group.groupID === groupId ? { ...group, ...updates } : group
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
      
      // Find source and target groups
      const sourceGroupIndex = newGroups.findIndex(g => g.groupID === result.old_group_id);
      const targetGroupIndex = newGroups.findIndex(g => g.groupID === result.target_group_id);
      
      // Update source group if it exists and wasn't deleted
      if (sourceGroupIndex !== -1 && !result.old_group_deleted) {
        // Use updated source group data from backend if available, otherwise update manually
        if (result.updated_source_group) {
          newGroups[sourceGroupIndex] = result.updated_source_group;
        } else {
          const sourceGroup = { ...newGroups[sourceGroupIndex] };
          
          // Update photo count by subtracting transferred photos
          if (result.transferred_photos) {
            const currentCount = sourceGroup.photo_count || sourceGroup.photoCount || sourceGroup.image_ids?.length || 0;
            sourceGroup.photo_count = Math.max(0, currentCount - result.transferred_photos.length);
            if (sourceGroup.photoCount !== undefined) {
              sourceGroup.photoCount = sourceGroup.photo_count;
            }
            if (sourceGroup.image_ids) {
              sourceGroup.image_ids = sourceGroup.image_ids.filter(id => 
                !result.transferred_photos.includes(id)
              );
            }
          }
          
          newGroups[sourceGroupIndex] = sourceGroup;
        }
      }
      
      // Remove source group if it was deleted
      if (result.old_group_deleted && sourceGroupIndex !== -1) {
        newGroups.splice(sourceGroupIndex, 1);
      }
      
      // Update target group if it exists
      if (targetGroupIndex !== -1) {
        // Use updated target group data from backend if available, otherwise update manually
        if (result.updated_target_group) {
          newGroups[targetGroupIndex] = result.updated_target_group;
        } else {
          const targetGroup = { ...newGroups[targetGroupIndex] };
          
          // Update photo count by adding transferred photos
          if (result.transferred_photos) {
            const currentCount = targetGroup.photo_count || targetGroup.photoCount || targetGroup.image_ids?.length || 0;
            targetGroup.photo_count = currentCount + result.transferred_photos.length;
            if (targetGroup.photoCount !== undefined) {
              targetGroup.photoCount = targetGroup.photo_count;
            }
            if (targetGroup.image_ids) {
              // Create a set of existing image IDs to avoid duplicates
              const existingImageIds = new Set(targetGroup.image_ids);
              const newImageIds = result.transferred_photos.filter(id => !existingImageIds.has(id));
              targetGroup.image_ids = [...targetGroup.image_ids, ...newImageIds];
            } else {
              targetGroup.image_ids = [...result.transferred_photos];
            }
          }
          
          // Update representative face if the target group didn't have one
          if (!targetGroup.face_representive && result.transferred_faces && result.transferred_faces.length > 0) {
            targetGroup.face_representive = result.transferred_faces[0];
          }
          
          newGroups[targetGroupIndex] = targetGroup;
        }
      }
      
      // Add new group if it was created or if target group doesn't exist in store
      if (targetGroupIndex === -1) {
        // Target group doesn't exist in store - add it
        if (result.new_group_name) {
          // New group created
          const newGroup = {
            groupID: result.target_group_id,
            label: result.new_group_name,
            photo_count: result.transferred_photos ? result.transferred_photos.length : 0,
            photoCount: result.transferred_photos ? result.transferred_photos.length : 0,
            image_ids: result.transferred_photos || [],
            face_representive: result.transferred_faces && result.transferred_faces.length > 0 ? result.transferred_faces[0] : '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          newGroups.push(newGroup);
        } else if (result.updated_target_group) {
          // Existing group that wasn't in store - add it with complete data
          const newGroup = {
            groupID: result.updated_target_group.groupID,
            label: result.updated_target_group.label,
            photo_count: result.updated_target_group.image_ids?.length || 0,
            photoCount: result.updated_target_group.image_ids?.length || 0,
            image_ids: result.updated_target_group.image_ids || [],
            face_representive: result.updated_target_group.face_representive || '',
            created_at: result.updated_target_group.created_at || new Date().toISOString(),
            updated_at: result.updated_target_group.updated_at || new Date().toISOString()
          };
          newGroups.push(newGroup);
        }
      }
      
      return { 
        groups: newGroups,
        lastTransferResult: {
          ...result,
          transferred_photos_data: result.transferred_photos_data || [] // Include full photo data
        }
      };
    });
  },
  
  // Moment operations
  updateMoment: (momentId, updates) => {
    set((state) => ({
      moments: state.moments.map(moment => 
        moment.id === momentId ? { ...moment, ...updates } : moment
      )
    }));
  },
  
  deleteMoment: (momentId) => {
    set((state) => ({
      moments: state.moments.filter(moment => moment.id !== momentId)
    }));
  },
  
  addMoment: (moment) => {
    set((state) => ({
      moments: [...state.moments, moment]
    }));
  },
  
  // Photo operations
  setSelectedPhotos: (selectedPhotos) => set({ selectedPhotos }),
  setPhotoViewer: (photoViewer) => set({ photoViewer }),
  
  // Clear all data
  clearData: () => set({
    groups: [],
    moments: [],
    selectedPhotos: new Set(),
    photoViewer: { show: false, photo: null, index: 0 },
    loading: false,
    error: null
  })
}));

// Data change handler - processes API responses and updates state accordingly
export const handleDataChange = (changeType, data, store = useDataStore.getState()) => {
  switch (changeType) {
    case CHANGE_TYPES.GROUP_UPDATED:
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
      
    case CHANGE_TYPES.MOMENT_UPDATED:
      store.updateMoment(data.id, data);
      break;
      
    case CHANGE_TYPES.MOMENT_DELETED:
      store.deleteMoment(data.id);
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