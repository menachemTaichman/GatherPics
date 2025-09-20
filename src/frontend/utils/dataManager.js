import { create } from 'zustand';

// Data change types for tracking what needs to be updated
export const CHANGE_TYPES = {
  UPSERT: 'UPSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_MOVE: 'RELATION_MOVE',
  RELATION_SET: 'RELATION_SET',
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
      const id = it.id;
      if (id === undefined || id === null) return;
      const prev = nextMap[id];
      if (!prev || !shallowEqual(prev, it)) {
        nextMap[id] = prev ? { ...prev, ...it } : it;
        changed = true;
      }
    });
    if (changed) {
      set({ entities: { ...state.entities, [key]: nextMap } });
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
  },
  _relationAdd: ({ relation, parentId, ids, position }) => {
    const state = get();
    if (!relation || parentId === undefined || !Array.isArray(ids)) return;
    const nextRelations = { ...state.relations };
    const pid = String(parentId);
    const normIds = ids.map((v) => String(v));
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const arr = [...(nextRelations[relKey][pid] || [])];
    const existing = new Set(arr);
    const toAdd = normIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    if (position === 'start') {
      arr.unshift(...toAdd);
    } else if (typeof position === 'number') {
      arr.splice(Math.max(0, Math.min(position, arr.length)), 0, ...toAdd);
    } else {
      arr.push(...toAdd);
    }
    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: arr };
    set({ relations: nextRelations });
  },
  _relationRemove: ({ relation, parentId, ids }) => {
    const state = get();
    if (!relation || parentId === undefined || !Array.isArray(ids)) return;
    const nextRelations = { ...state.relations };
    const pid = String(parentId);
    const normIds = ids.map((v) => String(v));
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const arr = [...(nextRelations[relKey][pid] || [])];
    const removeSet = new Set(normIds);
    const filtered = arr.filter((id) => !removeSet.has(id));
    if (filtered.length === arr.length) return;
    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: filtered };
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
    const pid = String(parentId);
    const normIds = ids.map((v) => String(v));
    const relKey = relation.includes('group') ? 'groupImages'
                  : relation.includes('moment') ? 'momentImages'
                  : relation.includes('album') ? 'albumImages'
                  : null;
    if (!relKey) return;
    const prev = nextRelations[relKey][pid] || state.relations[relKey][pid] || [];
    if (prev.length === normIds.length && prev.every((v, i) => v === normIds[i])) return; // no change
    // Deduplicate and set
    const seen = new Set();
    const deduped = [];
    normIds.forEach((id) => { if (!seen.has(id)) { seen.add(id); deduped.push(id); } });
    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: deduped };
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
    // Keep normalized map in sync
    set((state) => {
      const curr = state.entities.groupsById[groupId] || {};
      return { entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [groupId]: { ...curr, ...updates } } } };
    });
  },
  
  replaceGroup: (groupId, newGroupData) => {
    set((state) => ({ entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [newGroupData.id || groupId]: newGroupData } } }));
  },
  
  deleteGroup: (groupId) => {
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
    set((state) => ({ entities: { ...state.entities, groupsById: { ...state.entities.groupsById, [group.id]: group } } }));
  },
  
  // Transfer faces between groups
  transferFaces: (result) => {
    set(() => ({ lastTransferResult: { ...result, transferred_images_data: result.transferred_images_data || [] } }));
  },


  
  // Moment operations
  updateMoment: (momentId, updates) => {
    set((state) => {
      const curr = state.entities.momentsById[momentId] || {};
      return { entities: { ...state.entities, momentsById: { ...state.entities.momentsById, [momentId]: { ...curr, ...updates } } } };
    });
  },
  
  deleteMoment: (momentId) => {
    set((state) => {
      const next = { ...state.entities.momentsById };
      delete next[momentId];
      return { entities: { ...state.entities, momentsById: next } };
    });
  },
  
  addMoment: (moment) => {
    set((state) => ({ entities: { ...state.entities, momentsById: { ...state.entities.momentsById, [moment.id]: moment } } }));
  },
  
  // Image operations
  setSelectedImages: (selectedImages) => set({ selectedImages }),
  setImageViewer: (imageViewer) => set({ imageViewer }),
  
  // Clear all data
  clearData: () => set({
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
// Legacy change handlers and API wrappers removed. All updates must come via `changes` schema.

// -------- Selectors (helpers for components) --------
export const selectors = {
  // Return cached arrays to preserve referential equality across unrelated store updates
  groupsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.groupsById || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  momentsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.momentsById || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
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
    const list = (ids || []).map((id) => state.entities?.imagesById?.[id]).filter(Boolean);
    if (includeArchived) return list;
    return list.filter((img) => !img?.is_archived);
  },
};

 