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
  IMAGE_SELECTION_CHANGED: 'IMAGE_SELECTION_CHANGED',
  IMAGE_VIEWER_UPDATED: 'IMAGE_VIEWER_UPDATED',
  
  // Global changes
  GROUPS_REFRESH: 'GROUPS_REFRESH',
  MOMENTS_REFRESH: 'MOMENTS_REFRESH',
  IMAGES_REFRESH: 'IMAGES_REFRESH'
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
  
  // Actions
  setGroups: (groups) => set({ groups }),
  setMoments: (moments) => set({ moments }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearLastTransferResult: () => set({ lastTransferResult: null }),
  
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
          
          // Update image count by subtracting images that need to be removed
          if (result.images_to_remove_from_source) {
            const currentCount = sourceGroup.image_count || sourceGroup.imageCount || sourceGroup.image_ids?.length || 0;
            sourceGroup.image_count = Math.max(0, currentCount - result.images_to_remove_from_source.length);
            if (sourceGroup.imageCount !== undefined) {
              sourceGroup.imageCount = sourceGroup.image_count;
            }
            if (sourceGroup.image_ids) {
              sourceGroup.image_ids = sourceGroup.image_ids.filter(id => 
                !result.images_to_remove_from_source.includes(id)
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
          
          // Update image count by adding images that need to be added
          if (result.images_to_add_to_target) {
            const currentCount = targetGroup.image_count || targetGroup.imageCount || targetGroup.image_ids?.length || 0;
            targetGroup.image_count = currentCount + result.images_to_add_to_target.length;
            if (targetGroup.imageCount !== undefined) {
              targetGroup.imageCount = targetGroup.image_count;
            }
            if (targetGroup.image_ids) {
              // Create a set of existing image IDs to avoid duplicates
              const existingImageIds = new Set(targetGroup.image_ids);
              const newImageIds = result.images_to_add_to_target.filter(id => !existingImageIds.has(id));
              targetGroup.image_ids = [...targetGroup.image_ids, ...newImageIds];
            } else {
              targetGroup.image_ids = [...result.images_to_add_to_target];
            }
          }
          
          // Do not heuristically set representative face on client.
          // The backend is the source of truth and should provide
          // updated_target_group when representative changes.
          
          newGroups[targetGroupIndex] = targetGroup;
        }
      }
      
      // Add new group if it was created or if target group doesn't exist in store
      if (targetGroupIndex === -1) {
        // Prefer complete backend data when available
        if (result.updated_target_group) {
          const newGroup = {
            groupID: result.updated_target_group.groupID,
            label: result.updated_target_group.label,
            image_count: result.updated_target_group.image_ids?.length || 0,
            imageCount: result.updated_target_group.image_ids?.length || 0,
            image_ids: result.updated_target_group.image_ids || [],
            representative_face: result.updated_target_group.representative_face || '',
            created_at: result.updated_target_group.created_at || new Date().toISOString(),
            updated_at: result.updated_target_group.updated_at || new Date().toISOString()
          };
          if (!newGroups.some(g => g.groupID === newGroup.groupID)) {
            newGroups.push(newGroup);
          }
        } else if (result.new_group_name) {
          // New group created
          const newGroup = {
            groupID: result.target_group_id,
            label: result.new_group_name,
            image_count: result.images_to_add_to_target ? result.images_to_add_to_target.length : 0,
            imageCount: result.images_to_add_to_target ? result.images_to_add_to_target.length : 0,
            image_ids: result.images_to_add_to_target || [],
            // Do not set representative_face heuristically; wait for backend-provided value
            representative_face: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          // Double-check we're not adding a duplicate
          if (!newGroups.some(g => g.groupID === result.target_group_id)) {
            newGroups.push(newGroup);
          }
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

 