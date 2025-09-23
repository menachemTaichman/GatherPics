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

// -------- Browser-scoped persistence (no cross-tab sync) --------
const STORE_PERSIST_KEY = 'frw_data_store_v2';

function serializeForPersist(state) {
  try {
    const plain = { ...state };
    if (plain.selectedImages instanceof Set) {
      plain.selectedImages = Array.from(plain.selectedImages);
    }
    // Also serialize relations from Set to Array
    if (plain.relations) {
      const serializedRelations = {};
      for (const relKey in plain.relations) {
        serializedRelations[relKey] = {};
        const parentMap = plain.relations[relKey];
        for (const parentId in parentMap) {
          if (parentMap[parentId] instanceof Set) {
            serializedRelations[relKey][parentId] = Array.from(parentMap[parentId]);
          } else {
            // Should be an array already if coming from old state, or just some other value.
            serializedRelations[relKey][parentId] = parentMap[parentId];
          }
        }
      }
      plain.relations = serializedRelations;
    }
    return plain;
  } catch {
    return state;
  }
}

function reviveFromPersist(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const next = { ...obj };
  if (Array.isArray(next.selectedImages)) {
    next.selectedImages = new Set(next.selectedImages);
  }
  next.entities = next.entities || { images: {}, groups: {}, moments: {}, albums: {} };
  next.relations = next.relations || { groupImages: {}, momentImages: {}, albumImages: {} };
  
  // Revive relations from Array to Set
  if (next.relations) {
    const revivedRelations = {};
    for (const relKey in next.relations) {
      revivedRelations[relKey] = {};
      const parentMap = next.relations[relKey];
      for (const parentId in parentMap) {
        if (Array.isArray(parentMap[parentId])) {
          revivedRelations[relKey][parentId] = new Set(parentMap[parentId]);
        } else {
          // Should not happen with new serialization, but handle for safety.
          revivedRelations[relKey][parentId] = parentMap[parentId];
        }
      }
    }
    next.relations = revivedRelations;
  }

  next.view = next.view || { includeArchived: false, current: null };
  return next;
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
    images: {},
    groups: {},
    moments: {},
    albums: {},
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
    const key = entity;
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
    const key = entity;
    const nextMap = { ...state.entities[key] };
    let changed = false;
    ids.forEach((id) => { if (nextMap[id] !== undefined) { delete nextMap[id]; changed = true; } });
    if (!changed) return;
    const nextEntities = { ...state.entities, [key]: nextMap };

    // Also remove from all relations
    const nextRelations = { ...state.relations };
    const removeFromRelation = (relKey) => {
      const map = { ...(nextRelations[relKey] || {}) };
      const setIds = new Set(ids);
      Object.keys(map).forEach((parentId) => {
        const currentSet = map[parentId];
        if (currentSet instanceof Set) {
          const newSet = new Set(currentSet);
          let changed = false;
          for (const idToRemove of setIds) {
            if (newSet.delete(idToRemove)) {
              changed = true;
            }
          }
          if (changed) {
            map[parentId] = newSet;
          }
        }
      });
      nextRelations[relKey] = map;
    };
    if (entity === 'images') {
      removeFromRelation('groupImages');
      removeFromRelation('momentImages');
      removeFromRelation('albumImages');
    }

    set({ entities: nextEntities, relations: nextRelations });
  },
  _relationAdd: ({ relation, parentId, ids }) => {
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
    
    const currentSet = nextRelations[relKey]?.[pid] || new Set();
    const newSet = new Set(currentSet);
    let changed = false;
    normIds.forEach(id => {
      if (!newSet.has(id)) {
        newSet.add(id);
        changed = true;
      }
    });

    if (!changed) return;

    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: newSet };
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

    const currentSet = nextRelations[relKey]?.[pid];
    if (!currentSet || currentSet.size === 0) return;

    const newSet = new Set(currentSet);
    let changed = false;
    normIds.forEach(id => {
      if (newSet.delete(id)) {
        changed = true;
      }
    });

    if (!changed) return;

    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: newSet };
    set({ relations: nextRelations });
  },
  _relationMove: ({ relation, fromParentId, toParentId, ids }) => {
    const state = get();
    if (!relation || fromParentId === undefined || toParentId === undefined || !Array.isArray(ids)) return;
    // remove from source
    get()._relationRemove({ relation, parentId: fromParentId, ids });
    // add to target
    get()._relationAdd({ relation, parentId: toParentId, ids });
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
    
    const prevSet = state.relations[relKey]?.[pid] || new Set();
    const newSet = new Set(normIds);
    
    if (prevSet.size === newSet.size && [...prevSet].every(id => newSet.has(id))) return;

    nextRelations[relKey] = { ...nextRelations[relKey], [pid]: newSet };
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
          get()._relationAdd({ relation: ch.relation, parentId: ch.parentId, ids: ch.ids || [] });
          break;
        case CHANGE_TYPES.RELATION_REMOVE:
          get()._relationRemove({ relation: ch.relation, parentId: ch.parentId, ids: ch.ids || [] });
          break;
        case CHANGE_TYPES.RELATION_MOVE:
          get()._relationMove({ relation: ch.relation, fromParentId: ch.fromParentId, toParentId: ch.toParentId, ids: ch.ids || [] });
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
      const curr = state.entities.groups[groupId] || {};
      return { entities: { ...state.entities, groups: { ...state.entities.groups, [groupId]: { ...curr, ...updates } } } };
    });
  },
  
  replaceGroup: (groupId, newGroupData) => {
    set((state) => ({ entities: { ...state.entities, groups: { ...state.entities.groups, [newGroupData.id || groupId]: newGroupData } } }));
  },
  
  deleteGroup: (groupId) => {
    // Normalized sync
    set((state) => {
      const next = { ...state.entities.groups };
      delete next[groupId];
      const rel = { ...state.relations.groupImages };
      delete rel[groupId];
      return { entities: { ...state.entities, groups: next }, relations: { ...state.relations, groupImages: rel } };
    });
  },
  
  addGroup: (group) => {
    set((state) => ({ entities: { ...state.entities, groups: { ...state.entities.groups, [group.id]: group } } }));
  },
  
  // Transfer faces between groups
  transferFaces: (result) => {
    set(() => ({ lastTransferResult: { ...result, transferred_images_data: result.transferred_images_data || [] } }));
  },


  
  // Moment operations
  updateMoment: (momentId, updates) => {
    set((state) => {
      const curr = state.entities.moments[momentId] || {};
      return { entities: { ...state.entities, moments: { ...state.entities.moments, [momentId]: { ...curr, ...updates } } } };
    });
  },
  
  deleteMoment: (momentId) => {
    set((state) => {
      const next = { ...state.entities.moments };
      delete next[momentId];
      return { entities: { ...state.entities, moments: next } };
    });
  },
  
  addMoment: (moment) => {
    set((state) => ({ entities: { ...state.entities, moments: { ...state.entities.moments, [moment.id]: moment } } }));
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
    entities: { images: {}, groups: {}, moments: {}, albums: {} },
    relations: { groupImages: {}, momentImages: {}, albumImages: {} },
    view: { includeArchived: false, current: null }
  })
}));

// Hydrate once from localStorage (per browser, per profile). No cross-tab live sync.
try {
  const raw = localStorage.getItem(STORE_PERSIST_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    const revived = reviveFromPersist(parsed);
    if (revived) {
      useDataStore.setState({ ...useDataStore.getState(), ...revived });
    }
  }
} catch {}

// Persist on any change
try {
  useDataStore.subscribe((state) => {
    try {
      const serialized = serializeForPersist(state);
      localStorage.setItem(STORE_PERSIST_KEY, JSON.stringify(serialized));
    } catch {}
  });
} catch {}

// On tab activation, refresh from persisted store so other tabs' writes are observed
function rehydrateFromBrowserStore() {
  try {
    const raw = localStorage.getItem(STORE_PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const revived = reviveFromPersist(parsed);
    if (revived) {
      useDataStore.setState((prev) => ({ ...prev, ...revived }));
    }
  } catch {}
}

try {
  window.addEventListener('focus', rehydrateFromBrowserStore);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rehydrateFromBrowserStore();
  });
} catch {}

// Data change handler - processes API responses and updates state accordingly
// Legacy change handlers and API wrappers removed. All updates must come via `changes` schema.

// -------- Selectors (helpers for components) --------
export const selectors = {
  // Return cached arrays to preserve referential equality across unrelated store updates
  groupsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.groups || null;
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
      const ref = state.entities?.moments || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  groupImages: (state, groupId) => {
    const ids = Array.from(state.relations?.groupImages?.[groupId] || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  albumImages: (state, albumId) => {
    const ids = Array.from(state.relations?.albumImages?.[albumId] || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  momentImages: (state, momentId) => {
    const ids = Array.from(state.relations?.momentImages?.[momentId] || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  imageById: (state, id) => state.entities?.images?.[id] || null,
  // Album membership helpers
  albumMembershipSets: (state) => {
    const favId = state.favoritesAlbumId;
    const arcId = state.archiveAlbumId;
    const favSet = (favId && state.relations?.albumImages?.[favId]) || new Set();
    const arcSet = (arcId && state.relations?.albumImages?.[arcId]) || new Set();
    return { favoritesSet: favSet, archiveSet: arcSet };
  },
  isFavorite: (state, imageId) => {
    const favId = state.favoritesAlbumId;
    if (favId && state.relations?.albumImages?.[favId]) return state.relations.albumImages[favId].has(imageId);
    const img = state.entities?.images?.[imageId];
    return !!(img?.is_favorite ?? img?.is_favorites);
  },
  isArchived: (state, imageId) => {
    const arcId = state.archiveAlbumId;
    if (arcId && state.relations?.albumImages?.[arcId]) return state.relations.albumImages[arcId].has(imageId);
    const img = state.entities?.images?.[imageId];
    return !!img?.is_archived;
  },
  visibleImages: (state, ids, { includeArchived = true } = {}) => {
    const list = (ids || []).map((id) => state.entities?.images?.[id]).filter(Boolean);
    if (includeArchived) return list;
    return list.filter((img) => !img?.is_archived);
  },
};

 