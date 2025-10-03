import { create } from 'zustand';

export const CHANGE_TYPES = {
  UPSERT: 'UPSERT',
  UPDATE: 'UPDATE',
  INSERT: 'INSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_SET: 'RELATION_SET',
};

// Generate a stable tab id per reload
const TAB_ID = (() => {
  try {
    const key = '__tab_id__';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
  } catch {}
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('__tab_id__', id); } catch {}
  return id;
})();

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

function persistEntitiesSession(entities) {
  try {
    const plain = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    ['images','groups','moments','albums','faces'].forEach((k) => {
      const src = entities[k] || {};
      const out = {};
      Object.keys(src).forEach((id) => {
        const e = src[id];
        const copy = { ...e };
        Object.keys(copy).forEach((fk) => {
          if (copy[fk] instanceof Set) copy[fk] = Array.from(copy[fk]);
        });
        out[id] = copy;
      });
      plain[k] = out;
    });
    sessionStorage.setItem('entities', JSON.stringify(plain));
  } catch {}
}

function hydrateEntitiesSession() {
  try {
    // Clear on actual reloads so each F5 starts with a fresh session
    const nav = (performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation') : [];
    const isReload = Array.isArray(nav) && nav.length > 0 ? (nav[0]?.type === 'reload') : (performance && performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      sessionStorage.removeItem('entities');
    }
  } catch {}

  try {
    const raw = sessionStorage.getItem('entities');
    const base = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const revived = { ...base };
    ['images','groups','moments','albums','faces'].forEach((k) => {
      const src = parsed?.[k] || {};
      const out = {};
      Object.keys(src).forEach((id) => {
        const e = { ...src[id] };
        Object.keys(e).forEach((fk) => {
          if (Array.isArray(e[fk])) e[fk] = new Set(e[fk].map(String));
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

export const useDataStore = create((set, get) => {
  // Broadcast channel for cross-tab sync
  let channel = null;
  try {
    channel = new BroadcastChannel('data-sync');
  } catch {}

  const initialState = {
    // Minimal UI state (not persisted)
    selectedImages: new Set(),
    imageViewer: { show: false, image: null, index: 0 },
    loading: false,
    error: null,
    favoritesAlbumId: null,
    archiveAlbumId: null,

    // Per-tab scopes: what relations to apply (components add/remove)
    scope: {},
    scopes: {},
    scopeCounts: {},

    // Entities persisted per-tab in sessionStorage
    entities: hydrateEntitiesSession(),
  };

  const applyUpsertsFromEntitiesDict = (childTypeKey, entitiesDict, nextEntities) => {
    if (!entitiesDict || typeof entitiesDict !== 'object') return;
    const map = { ...(nextEntities[childTypeKey] || {}) };
    Object.keys(entitiesDict).forEach((id) => {
      const raw = entitiesDict[id] || {};
      const normalized = { id, ...raw };
      ['images','faces','albums'].forEach((rk) => {
        if (rk in normalized) normalized[rk] = coerceToSet(normalized[rk]);
      });
      map[id] = { ...(map[id] || { id }), ...normalized };
    });
    nextEntities[childTypeKey] = map;
  };

  const shouldApplyRelation = (relation, parentId) => {
    const state = get();
    const single = state.scope || {};
    const scopesMap = state.scopes || {};
    const scopesList = [single, ...Object.values(scopesMap)];
    const [parentType] = String(relation || '').split('.');
    const parentKey = normalizeEntityKey(parentType);
    for (const sc of scopesList) {
      if (!sc || !sc.entity) continue;
      if (sc.entity === parentType && (!sc.id || String(sc.id) === String(parentId))) return true;
      if (sc.entity === 'all' && String(sc.id) === String(parentKey)) return true;
    }
    return false;
  };

  const isEntityInsertAllowedByScopes = (entityKey) => {
    const state = get();
    const single = state.scope || {};
    const scopesMap = state.scopes || {};
    const scopesList = [single, ...Object.values(scopesMap)];

    // Helper: does any scope match exactly this entity set?
    const hasAllScope = scopesList.some((sc) => sc && sc.entity === 'all' && String(sc.id) === String(entityKey));
    if (hasAllScope) return true;

    // Singular entity type
    const singular = String(entityKey).replace(/s$/, '');

    // Direct entity scope (e.g., group:<id> allows group upserts)
    const hasDirect = scopesList.some((sc) => sc && sc.entity === singular);
    if (hasDirect) return true;

    // Relationship-derived allowances
    // images are allowed under group/album/moment/image scopes
    if (entityKey === 'images') {
      const hasParent = scopesList.some((sc) => sc && (sc.entity === 'group' || sc.entity === 'album' || sc.entity === 'moment' || sc.entity === 'image'));
      if (hasParent) return true;
    }
    // groups/albums/faces are allowed under image scope (e.g., image.groups, image.albums, image.faces)
    if (entityKey === 'groups' || entityKey === 'albums' || entityKey === 'faces') {
      const hasImage = scopesList.some((sc) => sc && sc.entity === 'image');
      if (hasImage) return true;
    }

    return false;
  };

  const broadcast = (changes) => {
    try {
      if (!channel) return;
      channel.postMessage({ tabId: TAB_ID, changes });
    } catch {}
  };

  if (channel) {
    try {
      channel.onmessage = (ev) => {
        const data = ev?.data || {};
        if (!data || data.tabId === TAB_ID) return;
        const incoming = Array.isArray(data.changes) ? data.changes : [];
        get().applyChanges(incoming, { fromBroadcast: true });
      };
    } catch {}
  }

  return {
    ...initialState,

    // Actions
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setFavoritesAlbumId: (id) => set({ favoritesAlbumId: id }),
    setArchiveAlbumId: (id) => set({ archiveAlbumId: id }),
    setScope: (scope) => set((state) => {
      const scopes = {};
      if (scope?.entity) {
        const key = `${scope.entity}:${scope.id ?? ''}`;
        scopes[key] = { entity: scope.entity, id: scope.id };
      }
      return { scope: { entity: scope?.entity, id: scope?.id }, scopes, scopeCounts: scopes && Object.keys(scopes).length ? { [Object.keys(scopes)[0]]: 1 } : {} };
    }),
    addScope: (scope) => set((state) => {
      if (!scope?.entity) return {};
      const key = `${scope.entity}:${scope.id ?? ''}`;
      const nextScopes = { ...(state.scopes || {}), [key]: { entity: scope.entity, id: scope.id } };
      const counts = { ...(state.scopeCounts || {}) };
      counts[key] = (counts[key] || 0) + 1;
      return { scopes: nextScopes, scopeCounts: counts };
    }),
    removeScope: (scope) => set((state) => {
      if (!scope?.entity) return {};
      const key = `${scope.entity}:${scope.id ?? ''}`;
      const counts = { ...(state.scopeCounts || {}) };
      const curr = counts[key] || 0;
      if (curr <= 1) {
        delete counts[key];
        const nextScopes = { ...(state.scopes || {}) };
        delete nextScopes[key];
        return { scopes: nextScopes, scopeCounts: counts };
      } else {
        counts[key] = curr - 1;
        return { scopeCounts: counts };
      }
    }),

    // Core change applier (supports new relation entities dict)
    applyChanges: (changes, options = {}) => {
      if (!Array.isArray(changes) || changes.length === 0) return;
      const nextEntities = { ...get().entities };

      // Helper to resolve effective flags (per-change overrides > call-level > type defaults)
      const resolveFlags = (ch) => {
        const type = ch?.type;
        const typeDefaults = {
          UPSERT: { ignoreScope: false, broadcast: true },
          UPDATE: { ignoreScope: true, broadcast: true },
          INSERT: { ignoreScope: true, broadcast: false },
          RELATION_ADD: { ignoreScope: false, broadcast: true },
          RELATION_REMOVE: { ignoreScope: false, broadcast: true },
          RELATION_SET: { ignoreScope: false, broadcast: true },
          REMOVE: { ignoreScope: false, broadcast: true },
        }[type] || { ignoreScope: false, broadcast: true };
        const callIgnore = Object.prototype.hasOwnProperty.call(options, 'ignoreScope') ? !!options.ignoreScope : undefined;
        const callBroadcast = Object.prototype.hasOwnProperty.call(options, 'broadcast') ? !!options.broadcast : undefined;
        const effIgnore = Object.prototype.hasOwnProperty.call(ch, 'ignoreScope') ? !!ch.ignoreScope : (callIgnore !== undefined ? callIgnore : typeDefaults.ignoreScope);
        const effBroadcast = Object.prototype.hasOwnProperty.call(ch, 'broadcast') ? !!ch.broadcast : (callBroadcast !== undefined ? callBroadcast : typeDefaults.broadcast);
        return { ignoreScope: effIgnore, broadcast: effBroadcast };
      };

      const ensureEntity = (key, id) => {
        const map = nextEntities[key] || {};
        const curr = map[id] || { id };
        nextEntities[key] = map;
        return curr;
      };

      const saveBack = (key, id, obj) => {
        nextEntities[key] = { ...nextEntities[key], [id]: obj };
      };

      const outgoing = [];

      changes.forEach((ch) => {
        if (!ch || !ch.type) return;
        const { ignoreScope: effIgnoreScope, broadcast: effBroadcast } = resolveFlags(ch);

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
            const exists = !!map[id];
            // Gate only inserts unless ignoreScope=true
            if (!exists && !effIgnoreScope && !isEntityInsertAllowedByScopes(key)) return;
            const prev = map[id] || { id };
            const merged = { ...prev, ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in merged) merged[rk] = coerceToSet(merged[rk]);
            });
            map[id] = merged;
          });
          nextEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (ch.type === CHANGE_TYPES.UPDATE) {
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
            if (!map[id]) return; // update-only
            const merged = { ...map[id], ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in merged) merged[rk] = coerceToSet(merged[rk]);
            });
            map[id] = merged;
          });
          nextEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (ch.type === CHANGE_TYPES.INSERT) {
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
            if (map[id]) return; // insert-only
            const merged = { id, ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in merged) merged[rk] = coerceToSet(merged[rk]);
            });
            map[id] = merged;
          });
          nextEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (
          ch.type === CHANGE_TYPES.RELATION_SET ||
          ch.type === CHANGE_TYPES.RELATION_ADD ||
          ch.type === CHANGE_TYPES.RELATION_REMOVE
        ) {
          const [parentType, childType] = String(ch.relation || '').split('.');
          const parentKey = normalizeEntityKey(parentType);
          if (!parentKey) return;
          const field = normalizeEntityKey(childType).replace(/s$/, 's');

          // Apply child entity upserts when 'entities' dict is provided (local only, ignore scopes)
          if (ch.entities && (ch.type === CHANGE_TYPES.RELATION_SET || ch.type === CHANGE_TYPES.RELATION_ADD)) {
            const childKey = normalizeEntityKey(childType);
            applyUpsertsFromEntitiesDict(childKey, ch.entities, nextEntities);
          }

          // Gate relation mutations by scope
          const parentId = String(ch.parentId ?? '');
          if (!parentId) return;
          if (!effIgnoreScope && !shouldApplyRelation(ch.relation, parentId)) return;

          // RELATION_MOVE unsupported in v4

          const parent = ensureEntity(parentKey, parentId);
          const current = coerceToSet(parent[field]);

          if (ch.type === CHANGE_TYPES.RELATION_SET) {
            // Prefer entities dict keys when present
            const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
            parent[field] = coerceToSet(ids);
          } else if (ch.type === CHANGE_TYPES.RELATION_ADD) {
            const set = new Set(current);
            const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
            ids.forEach((id) => set.add(String(id)));
            parent[field] = set;
          } else if (ch.type === CHANGE_TYPES.RELATION_REMOVE) {
            const set = new Set(current);
            (ch.ids || []).forEach((id) => set.delete(String(id)));
            parent[field] = set;
          }
          saveBack(parentKey, parentId, parent);
          if (effBroadcast) {
            const { entities, ...sanitized } = ch;
            outgoing.push({ ...sanitized });
          }
          return;
        }

        if (ch.type === CHANGE_TYPES.REMOVE) {
          const key = normalizeEntityKey(ch.entity);
          if (!key) return;
          const ids = ch.ids || [];
          const map = { ...(nextEntities[key] || {}) };
          ids.forEach((id) => { delete map[id]; });
          nextEntities[key] = map;
          // Removal broadcast as-is
          const { broadcast: effBroadcastRemove } = resolveFlags(ch);
          if (effBroadcastRemove) outgoing.push(ch);
          return;
        }
      });

      set({ entities: nextEntities });
      persistEntitiesSession(nextEntities);
      if (!options.fromBroadcast && outgoing.length > 0) broadcast(outgoing);
    },

    // Image operations
    setSelectedImages: (selectedImages) => set({ selectedImages }),
    setImageViewer: (imageViewer) => set({ imageViewer }),
    clearData: () => {
      const empty = { images: {}, groups: {}, moments: {}, albums: {}, faces: {} };
      persistEntitiesSession(empty);
      set({
        selectedImages: new Set(),
        imageViewer: { show: false, image: null, index: 0 },
        loading: false,
        error: null,
        entities: empty
      });
    },

    // Optional helper for UI that emits minimal changes
    transferFaces: (transferData = {}) => {
      const changes = [];
      if (transferData.target_group_id && Array.isArray(transferData.images_added) && transferData.images) {
        const entitiesDict = {};
        transferData.images_added.forEach((id) => {
          const img = transferData.images?.[id] || { id };
          entitiesDict[id] = img;
        });
        changes.push({
          type: CHANGE_TYPES.RELATION_ADD,
          relation: 'group.images',
          parentId: transferData.target_group_id,
          entities: entitiesDict,
        });
      }
      if (transferData.old_group_deleted && transferData.old_group_id) {
        changes.push({ type: CHANGE_TYPES.REMOVE, entity: 'group', ids: [transferData.old_group_id] });
      }
      if (changes.length > 0) get().applyChanges(changes);
    },
  };
});

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

 