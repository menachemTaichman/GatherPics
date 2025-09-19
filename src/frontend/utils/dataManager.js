import { create } from 'zustand';

// Data change types for tracking what needs to be updated
export const CHANGE_TYPES = {
  // Group changes
  GROUP_UPDATED: 'GROUP_UPDATED',
  GROUP_DELETED: 'GROUP_DELETED',
  GROUP_CREATED: 'GROUP_CREATED',
  GROUP_FACES_TRANSFERRED: 'GROUP_FACES_TRANSFERRED',
  
  // Generic normalized changes (new schema)
  UPSERT: 'UPSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_MOVE: 'RELATION_MOVE',
  RELATION_SET: 'RELATION_SET',
  
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

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (a[k] !== b[k]) return false;
  }
  return true;
}

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
  
  // Normalized entities and relations (v2)
  entities: {
    imagesById: {},
    groupsById: {},
    momentsById: {},
    albumsById: {},
  },
  relations: {
    groupImages: {},   // { [groupId]: string[] }
    momentImages: {},  // { [momentId]: string[] }
    albumImages: {},   // { [albumId]: string[] }
  },
  
  // View preferences (minimal; components can adopt later)
  view: {
    includeArchived: false,
    current: null, // { type: 'group'|'album'|'moment'|'gallery', id?, filter?, sort? }
  },
  
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
  
  // -------- Normalized helpers (v2) --------
  _upsertEntities: ({ entity, items }) => {
    const state = get();
    if (!Array.isArray(items) || !entity) return;
    const key = `${entity}sById`;
    const prevMap = state.entities[key];
    const nextMap = { ...prevMap };
    let changed = false;
    items.forEach((it) => {
      if (!it) return;
      // Prefer id, but keep legacy groupID/momentID/albumID
      const id = it.id || it.imageID || it.groupID || it.momentID || it.albumID;
      if (id === undefined || id === null) return;
      const prev = nextMap[id];
      if (!prev || !shallowEqual(prev, it)) {
        nextMap[id] = prev ? { ...prev, ...it } : it;
        changed = true;
      }
    });
    if (changed) {
      set({ entities: { ...state.entities, [key]: nextMap } });

      // Back-compat: keep groups/moments arrays in sync for components still reading them
      if (entity === 'group') {
        const updated = Object.values(nextMap).map((g) => g);
        set({ groups: updated });
      }
      if (entity === 'moment') {
        const updated = Object.values(nextMap).map((m) => m);
        set({ moments: updated });
      }
    }
  },
  _removeEntities: ({ entity, ids }) => {
    const state = get();
    if (!Array.isArray(ids) || !entity) return;
    const key = `${entity}sById`;
    const nextMap = { ...state.entities[key] };
    let changed = false;
    ids.forEach((id) => { if (nextMap[id] !== undefined) { delete nextMap[id]; changed = true; } });
    if (!changed) return;
    const nextEntities = { ...state.entities, [key]: nextMap };

    // Also remove from all relations
    const nextRelations = { ...state.relations };
    const removeFromRelation = (relKey) => {
      const map = { ...(nextRelations[relKey] || {}) };
      Object.keys(map).forEach((parentId) => {
        const arr = map[parentId] || [];
        const setIds = new Set(ids);
        const filtered = arr.filter((x) => !setIds.has(x));
        if (filtered.length !== arr.length) map[parentId] = filtered;
      });
      nextRelations[relKey] = map;
    };
    if (entity === 'image') {
      removeFromRelation('groupImages');
      removeFromRelation('momentImages');
      removeFromRelation('albumImages');
    }

    set({ entities: nextEntities, relations: nextRelations });

    // Back-compat arrays
    if (entity === 'group') {
      set((prev) => ({ groups: prev.groups.filter((g) => !ids.includes(g.groupID)) }));
    }
    if (entity === 'moment') {
      set((prev) => ({ moments: prev.moments.filter((m) => !ids.includes(m.momentID)) }));
    }
  },
  _relationAdd: ({ relation, parentId, ids, position }) => {
    const state = get();
    if (!relation || parentId === undefined || !Array.isArray(ids)) return;
    const nextRelations = { ...state.relations };
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const arr = [...(nextRelations[relKey][parentId] || [])];
    const existing = new Set(arr);
    const toAdd = ids.filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    if (position === 'start') {
      arr.unshift(...toAdd);
    } else if (typeof position === 'number') {
      arr.splice(Math.max(0, Math.min(position, arr.length)), 0, ...toAdd);
    } else {
      arr.push(...toAdd);
    }
    nextRelations[relKey] = { ...nextRelations[relKey], [parentId]: arr };
    set({ relations: nextRelations });
  },
  _relationRemove: ({ relation, parentId, ids }) => {
    const state = get();
    if (!relation || parentId === undefined || !Array.isArray(ids)) return;
    const nextRelations = { ...state.relations };
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const arr = [...(nextRelations[relKey][parentId] || [])];
    const removeSet = new Set(ids);
    const filtered = arr.filter((id) => !removeSet.has(id));
    if (filtered.length === arr.length) return;
    nextRelations[relKey] = { ...nextRelations[relKey], [parentId]: filtered };
    set({ relations: nextRelations });
  },
  _relationMove: ({ relation, fromParentId, toParentId, ids, position }) => {
    const state = get();
    if (!relation || fromParentId === undefined || toParentId === undefined || !Array.isArray(ids)) return;
    // remove from source
    get()._relationRemove({ relation, parentId: fromParentId, ids });
    // add to target
    get()._relationAdd({ relation, parentId: toParentId, ids, position });
  },
  _relationSet: ({ relation, parentId, ids }) => {
    const state = get();
    if (!relation || parentId === undefined || !Array.isArray(ids)) return;
    const nextRelations = { ...state.relations };
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const prev = nextRelations[relKey][parentId] || state.relations[relKey][parentId] || [];
    if (prev.length === ids.length && prev.every((v, i) => v === ids[i])) return; // no change
    // Deduplicate and set
    const seen = new Set();
    const deduped = [];
    ids.forEach((id) => { if (!seen.has(id)) { seen.add(id); deduped.push(id); } });
    nextRelations[relKey] = { ...nextRelations[relKey], [parentId]: deduped };
    set({ relations: nextRelations });
  },
  applyChanges: (changes) => {
    if (!Array.isArray(changes)) return;
    changes.forEach((ch) => {
      if (!ch || !ch.type) return;
      switch (ch.type) {
        case CHANGE_TYPES.UPSERT:
          get()._upsertEntities({ entity: ch.entity, items: ch.items || [] });
          break;
        case CHANGE_TYPES.REMOVE:
          get()._removeEntities({ entity: ch.entity, ids: ch.ids || [] });
          break;
        case CHANGE_TYPES.RELATION_ADD:
          get()._relationAdd({ relation: ch.relation, parentId: ch.parentId, ids: ch.ids || [], position: ch.position });
          break;
        case CHANGE_TYPES.RELATION_REMOVE:
          get()._relationRemove({ relation: ch.relation, parentId: ch.parentId, ids: ch.ids || [] });
          break;
        case CHANGE_TYPES.RELATION_MOVE:
          get()._relationMove({ relation: ch.relation, fromParentId: ch.fromParentId, toParentId: ch.toParentId, ids: ch.ids || [], position: ch.position });
          break;
        case CHANGE_TYPES.RELATION_SET:
          get()._relationSet({ relation: ch.relation, parentId: ch.parentId, ids: ch.ids || [] });
          break;
        default:
          // Fall back to legacy handler if needed
          break;
      }
    });
  },

  // Group operations
  updateGroup: (groupId, updates) => {
    set((state) => ({
      groups: state.groups.map(group => 
        group.groupID === groupId ? { ...group, ...updates } : group
      )
    }));
    // Keep normalized map in sync
    set((state) => {
      const curr = state.entities.groupsById[groupId] || {};
      return { entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [groupId]: { ...curr, ...updates } } } };
    });
  },
  
  replaceGroup: (groupId, newGroupData) => {
    set((state) => ({
      groups: state.groups.map(group => 
        group.groupID === groupId ? newGroupData : group
      )
    }));
    // Normalized sync
    set((state) => ({ entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [newGroupData.groupID || newGroupData.id || groupId]: newGroupData } } }));
  },
  
  deleteGroup: (groupId) => {
    set((state) => ({
      groups: state.groups.filter(group => group.groupID !== groupId)
    }));
    // Normalized sync
    set((state) => {
      const next = { ...state.entities.groupsById };
      delete next[groupId];
      const rel = { ...state.relations.groupImages };
      delete rel[groupId];
      return { entities: { ...state.entities, groupsById: next }, relations: { ...state.relations, groupImages: rel } };
    });
  },
  
  addGroup: (group) => {
    set((state) => ({
      groups: [...state.groups, group]
    }));
    // Normalized sync
    set((state) => ({ entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [group.groupID || group.id]: group } } }));
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
    // Optional: reflect relation changes if present in result (back-compat path)
    try {
      const src = result.old_group_id;
      const dst = (result.updated_target_group && (result.updated_target_group.groupID || result.updated_target_group.id)) || result.target_group_id;
      const toRemove = result.images_to_remove_from_source || [];
      const toAdd = result.images_to_add_to_target || [];
      if (src && Array.isArray(toRemove) && toRemove.length > 0) {
        get()._relationRemove({ relation: 'group.images', parentId: src, ids: toRemove });
      }
      if (dst && Array.isArray(toAdd) && toAdd.length > 0) {
        get()._relationAdd({ relation: 'group.images', parentId: dst, ids: toAdd });
      }
      if (result.updated_source_group) {
        get()._upsertEntities({ entity: 'group', items: [result.updated_source_group] });
      }
      if (result.updated_target_group) {
        get()._upsertEntities({ entity: 'group', items: [result.updated_target_group] });
      }
      if (result.old_group_deleted && src) {
        get()._removeEntities({ entity: 'group', ids: [src] });
      }
    } catch {}
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
    error: null,
    entities: { imagesById: {}, groupsById: {}, momentsById: {}, albumsById: {} },
    relations: { groupImages: {}, momentImages: {}, albumImages: {} },
    view: { includeArchived: false, current: null }
  })
}));

// Data change handler - processes API responses and updates state accordingly
export const handleDataChange = (changeType, data, store = useDataStore.getState()) => {
  // New generic schema passthrough
  if (
    changeType === CHANGE_TYPES.UPSERT ||
    changeType === CHANGE_TYPES.REMOVE ||
    changeType === CHANGE_TYPES.RELATION_ADD ||
    changeType === CHANGE_TYPES.RELATION_REMOVE ||
    changeType === CHANGE_TYPES.RELATION_MOVE
  ) {
    const normalized = [{ type: changeType, ...data }];
    // If data is already a change object, accept array too
    const changesArray = Array.isArray(data) ? data : normalized;
    store.applyChanges(changesArray);
    return;
  }
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

// -------- Selectors (helpers for components) --------
export const selectors = {
  groupImages: (state, groupId) => {
    const ids = (state.relations?.groupImages?.[groupId] || []);
    return ids.map((id) => state.entities?.imagesById?.[id]).filter(Boolean);
  },
  albumImages: (state, albumId) => {
    const ids = (state.relations?.albumImages?.[albumId] || []);
    return ids.map((id) => state.entities?.imagesById?.[id]).filter(Boolean);
  },
  momentImages: (state, momentId) => {
    const ids = (state.relations?.momentImages?.[momentId] || []);
    return ids.map((id) => state.entities?.imagesById?.[id]).filter(Boolean);
  },
  imageById: (state, id) => state.entities?.imagesById?.[id] || null,
  // Album membership helpers
  albumMembershipSets: (state) => {
    const favId = state.favoritesAlbumId;
    const arcId = state.archiveAlbumId;
    const favSet = new Set((favId && state.relations?.albumImages?.[favId]) || []);
    const arcSet = new Set((arcId && state.relations?.albumImages?.[arcId]) || []);
    return { favoritesSet: favSet, archiveSet: arcSet };
  },
  isFavorite: (state, imageId) => {
    const favId = state.favoritesAlbumId;
    if (favId && state.relations?.albumImages?.[favId]) return state.relations.albumImages[favId].includes(imageId);
    const img = state.entities?.imagesById?.[imageId];
    return !!(img?.is_favorite ?? img?.is_favorites);
  },
  isArchived: (state, imageId) => {
    const arcId = state.archiveAlbumId;
    if (arcId && state.relations?.albumImages?.[arcId]) return state.relations.albumImages[arcId].includes(imageId);
    const img = state.entities?.imagesById?.[imageId];
    return !!img?.is_archived;
  },
  visibleImages: (state, ids, { includeArchived = true } = {}) => {
    const arcId = state.archiveAlbumId;
    const archiveSet = new Set((arcId && state.relations?.albumImages?.[arcId]) || []);
    const list = (ids || []).map((id) => state.entities?.imagesById?.[id]).filter(Boolean);
    if (includeArchived) return list;
    return list.filter((img) => !archiveSet.has(img.id) && !img?.is_archived);
  },
};

 