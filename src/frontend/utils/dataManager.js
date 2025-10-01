import { create } from 'zustand';

export const CHANGE_TYPES = {
  UPSERT: 'UPSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_MOVE: 'RELATION_MOVE',
  RELATION_SET: 'RELATION_SET',
};

function normalizeEntityKey(entity) {
  if (!entity) return entity;
  switch (String(entity)) {
    case 'image': return 'images';
    case 'group': return 'groups';
    case 'moment': return 'moments';
    case 'album': return 'albums';
    case 'face': return 'faces';
    default: return entity;
  }
}

function coerceToSet(val) {
  if (!val) return new Set();
  if (val instanceof Set) return val;
  if (Array.isArray(val)) return new Set(val.map(String));
  return new Set();
}

function persistEntities(entities) {
  try {
    const plain = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    ['images','groups','moments','albums','faces'].forEach((k) => {
      const src = entities[k] || {};
      const out = {};
      Object.keys(src).forEach((id) => {
        const e = src[id];
        const copy = { ...e };
        Object.keys(copy).forEach((fk) => {
          if (copy[fk] instanceof Set) {
            copy[fk] = Array.from(copy[fk]);
          }
        });
        out[id] = copy;
      });
      plain[k] = out;
    });
    localStorage.setItem('entities', JSON.stringify(plain));
  } catch {}
}

function hydrateEntities() {
  try {
    const raw = localStorage.getItem('entities');
    if (!raw) return { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    const parsed = JSON.parse(raw);
    const revived = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    ['images','groups','moments','albums','faces'].forEach((k) => {
      const src = parsed?.[k] || {};
      const out = {};
      Object.keys(src).forEach((id) => {
        const e = { ...src[id] };
        Object.keys(e).forEach((fk) => {
          if (Array.isArray(e[fk])) {
            e[fk] = new Set(e[fk].map(String));
          }
        });
        out[id] = e;
      });
      revived[k] = out;
    });
    return revived;
  } catch {
    return { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
  }
}

export const useDataStore = create((set, get) => ({
  // Minimal UI state (not persisted)
  selectedImages: new Set(),
  imageViewer: { show: false, image: null, index: 0 },
  loading: false,
  error: null,
  favoritesAlbumId: null,
  archiveAlbumId: null,

  // Entities only (persisted as 'entities')
  entities: hydrateEntities(),

  // Actions
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFavoritesAlbumId: (id) => set({ favoritesAlbumId: id }),
  setArchiveAlbumId: (id) => set({ archiveAlbumId: id }),

  // Core change applier (changes-only contract)
  applyChanges: (changes) => {
    if (!Array.isArray(changes) || changes.length === 0) return;
    const state = get();
    const nextEntities = { ...state.entities };

    const ensureEntity = (key, id) => {
      const map = nextEntities[key] || {};
      const curr = map[id] || { id };
      nextEntities[key] = map;
      return curr;
    };

    const saveBack = (key, id, obj) => {
      nextEntities[key] = { ...nextEntities[key], [id]: obj };
    };

    changes.forEach((ch) => {
      if (!ch || !ch.type) return;

      if (ch.type === CHANGE_TYPES.UPSERT) {
        const key = normalizeEntityKey(ch.entity);
        if (!key) return;
        const items = Array.isArray(ch.items)
          ? ch.items
          : (ch.items && typeof ch.items === 'object')
            ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
            : [];
        const map = { ...(nextEntities[key] || {}) };
        items.forEach((it) => {
          if (!it) return;
          const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id;
          if (!id) return;
          const prev = map[id] || { id };
          const merged = { ...prev, ...it };
          // Standard embedded relation fields coerced to Sets (ids only)
          ['images', 'faces', 'albums'].forEach((rk) => {
            if (rk in merged) merged[rk] = coerceToSet(merged[rk]);
          });
          map[id] = merged;
        });
        nextEntities[key] = map;
        return;
      }

      if (
        ch.type === CHANGE_TYPES.RELATION_SET ||
        ch.type === CHANGE_TYPES.RELATION_ADD ||
        ch.type === CHANGE_TYPES.RELATION_REMOVE ||
        ch.type === CHANGE_TYPES.RELATION_MOVE
      ) {
        const [parentType, childType] = String(ch.relation || '').split('.');
        const key = normalizeEntityKey(parentType);
        if (!key) return;
        const field = normalizeEntityKey(childType).replace(/s$/, 's');

        if (ch.type === CHANGE_TYPES.RELATION_MOVE) {
          const fromId = String(ch.fromParentId);
          const toId = String(ch.toParentId);
          if (fromId) {
            const fromParent = ensureEntity(key, fromId);
            const s = coerceToSet(fromParent[field]);
            (ch.ids || []).forEach((id) => s.delete(String(id)));
            fromParent[field] = s;
            saveBack(key, fromId, fromParent);
          }
          if (toId) {
            const toParent = ensureEntity(key, toId);
            const s = coerceToSet(toParent[field]);
            (ch.ids || []).forEach((id) => s.add(String(id)));
            toParent[field] = s;
            saveBack(key, toId, toParent);
          }
          return;
        }

        const parentId = String(ch.parentId ?? '');
        if (!parentId) return;
        const parent = ensureEntity(key, parentId);
        const current = coerceToSet(parent[field]);

        if (ch.type === CHANGE_TYPES.RELATION_SET) {
          parent[field] = coerceToSet(ch.ids || []);
        } else if (ch.type === CHANGE_TYPES.RELATION_ADD) {
          const set = new Set(current);
          (ch.ids || []).forEach((id) => set.add(String(id)));
          parent[field] = set;
        } else if (ch.type === CHANGE_TYPES.RELATION_REMOVE) {
          const set = new Set(current);
          (ch.ids || []).forEach((id) => set.delete(String(id)));
          parent[field] = set;
        }
        saveBack(key, parentId, parent);
        return;
      }

      if (ch.type === CHANGE_TYPES.REMOVE) {
        const key = normalizeEntityKey(ch.entity);
        if (!key) return;
        const ids = ch.ids || [];
        const map = { ...(nextEntities[key] || {}) };
        ids.forEach((id) => {
          delete map[id];
        });
        nextEntities[key] = map;
        return;
      }
    });

    set({ entities: nextEntities });
    persistEntities(nextEntities);
  },

  // Image operations
  setSelectedImages: (selectedImages) => set({ selectedImages }),
  setImageViewer: (imageViewer) => set({ imageViewer }),
  clearData: () => {
    const empty = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    persistEntities(empty);
    set({
      selectedImages: new Set(),
      imageViewer: { show: false, image: null, index: 0 },
      loading: false,
      error: null,
      entities: empty
    });
  }
}));

export const selectors = {
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
    const group = state.entities?.groups?.[groupId];
    const ids = Array.from(group?.images || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  albumImages: (state, albumId) => {
    const album = state.entities?.albums?.[albumId];
    const ids = Array.from(album?.images || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  momentImages: (state, momentId) => {
    const moment = state.entities?.moments?.[momentId];
    const ids = Array.from(moment?.images || []);
    return ids.map((id) => state.entities?.images?.[id]).filter(Boolean);
  },
  imageById: (state, id) => state.entities?.images?.[id] || null,
  albumMembershipSets: (state) => {
    const favId = state.favoritesAlbumId;
    const arcId = state.archiveAlbumId;
    const favSet = (favId && state.entities?.albums?.[favId]?.images) || new Set();
    const arcSet = (arcId && state.entities?.albums?.[arcId]?.images) || new Set();
    return { favoritesSet: favSet, archiveSet: arcSet };
  },
  isFavorite: (state, imageId) => {
    const favId = state.favoritesAlbumId;
    const favSet = favId && state.entities?.albums?.[favId]?.images;
    if (favSet instanceof Set) return favSet.has(String(imageId));
    const img = state.entities?.images?.[imageId];
    return !!(img?.is_favorite ?? img?.is_favorites);
  },
  isArchived: (state, imageId) => {
    const arcId = state.archiveAlbumId;
    const arcSet = arcId && state.entities?.albums?.[arcId]?.images;
    if (arcSet instanceof Set) return arcSet.has(String(imageId));
    const img = state.entities?.images?.[imageId];
    return !!img?.is_archived;
  },
  visibleImages: (state, ids, { includeArchived = true } = {}) => {
    const list = (ids || []).map((id) => state.entities?.images?.[id]).filter(Boolean);
    if (includeArchived) return list;
    return list.filter((img) => !img?.is_archived);
  },
};

 