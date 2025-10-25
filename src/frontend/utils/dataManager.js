import { create } from 'zustand';

export const CHANGE_TYPES = {
  UPSERT: 'UPSERT',
  UPDATE: 'UPDATE',
  INSERT: 'INSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_SET: 'RELATION_SET',
  SCOPE_ADD: 'SCOPE_ADD',
  SCOPE_REMOVE: 'SCOPE_REMOVE',
};

// Shallow compare two plain objects (compares own enumerable keys, by reference for values)
function shallowEqualObjects(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// Compare two Sets by contents
function setsEqual(a, b) {
  if (a === b) return true;
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function objectDiffKeys(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach((k) => {
    if ((a && a[k]) instanceof Set && (b && b[k]) instanceof Set) {
      if (!setsEqual(a[k], b[k])) diffs.push(k);
    } else if ((a ? a[k] : undefined) !== (b ? b[k] : undefined)) {
      diffs.push(k);
    }
  });
  return diffs;
}

function objectDiffDetails(a, b, limit = 5) {
  const keys = objectDiffKeys(a, b).slice(0, limit);
  const details = keys.map((k) => {
    const av = a ? a[k] : undefined;
    const bv = b ? b[k] : undefined;
    const preview = (v) => {
      if (v instanceof Set) return `Set(size=${v.size})`;
      if (typeof v === 'object' && v !== null) return '[object]';
      return v;
    };
    return { key: k, from: preview(av), to: preview(bv) };
  });
  return details;
}

// Shallow compare two plain objects by own keys and primitive values
function shallowEqualPlainObject(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

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

// Per-runtime channel id (unique even for duplicated tabs)
const CHANNEL_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

function normalizeEntityKey(entity) {
  if (!entity) return entity;
  switch (String(entity)) {
    case 'image': return 'images';
    case 'group': return 'groups';
    case 'moment': return 'moments';
    case 'album': return 'albums';
    case 'face': return 'faces';
    case 'profile': return 'profiles';
    case 'upload': return 'uploads';
    case 'access_request': return 'access_requests';
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
    const plain = { images: {}, groups: {}, moments: {}, albums: {}, faces: {}, profiles: {}, uploads: {}, access_requests: {} };
    ['images','groups','moments','albums','faces','profiles','uploads','access_requests'].forEach((k) => {
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
    const base = { images: {}, groups: {}, moments: {}, albums: {}, faces: {}, profiles: {}, uploads: {}, access_requests: {} };
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const revived = { ...base };
    ['images','groups','moments','albums','faces','profiles','uploads','access_requests'].forEach((k) => {
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
    return { images: {}, groups: {}, moments: {}, albums: {}, faces: {}, profiles: {}, uploads: {}, access_requests: {} };
  }
}

export const useDataStore = create((set, get) => {
  // Broadcast channel for cross-tab sync
  let channel = null;
  try {
    channel = new BroadcastChannel('data-sync');
  } catch {}
  // Debug: Expose store to window for browser inspection
  if (typeof window !== 'undefined') {
    window.__dataStore = { getState: get };
  }

  // Sync diagnostics removed

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
    const prevMap = nextEntities[childTypeKey] || {};
    let map = prevMap;
    Object.keys(entitiesDict).forEach((id) => {
      const raw = entitiesDict[id] || {};
      const normalized = { id, ...raw };
      
      // Handle dict-based child relations for access_requests.groups
      if (childTypeKey === 'access_requests' && 'groups' in normalized && typeof normalized.groups === 'object' && !Array.isArray(normalized.groups)) {
        // Keep groups as dict - don't convert to Set
        // This allows components to access relation metadata
      } else {
        // Convert other relations to Sets as before
        ['images','faces','albums'].forEach((rk) => {
          if (rk in normalized) normalized[rk] = coerceToSet(normalized[rk]);
        });
      }
      
      const before = prevMap[id];
      const mergedCandidate = { ...(before || { id }), ...normalized };
      
      // Preserve Set references when contents didn't change
      ['images','faces','albums'].forEach((rk) => {
        if (before && before[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
          if (setsEqual(before[rk], mergedCandidate[rk])) mergedCandidate[rk] = before[rk];
        }
      });
      
      // Handle profile relations preservation
      if (childTypeKey === 'profiles') {
        ['images', 'albums'].forEach((rk) => {
          if (before && before[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
            if (setsEqual(before[rk], mergedCandidate[rk])) mergedCandidate[rk] = before[rk];
          }
        });
      }
      
      // Handle upload relations preservation
      if (childTypeKey === 'uploads') {
        ['images', 'groups', 'moments'].forEach((rk) => {
          if (before && before[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
            if (setsEqual(before[rk], mergedCandidate[rk])) mergedCandidate[rk] = before[rk];
          }
        });
      }
      
      // Handle access_requests relations preservation
      if (childTypeKey === 'access_requests') {
        // For groups dict, preserve if unchanged
        if (before && before.groups && mergedCandidate.groups && 
            typeof before.groups === 'object' && typeof mergedCandidate.groups === 'object' &&
            !Array.isArray(before.groups) && !Array.isArray(mergedCandidate.groups)) {
          if (shallowEqualPlainObject(before.groups, mergedCandidate.groups)) {
            mergedCandidate.groups = before.groups;
          }
        }
      }
      
      const nextObj = before && shallowEqualObjects(before, mergedCandidate) ? before : mergedCandidate;
      if (nextObj !== before) {
        if (map === prevMap) map = { ...prevMap };
        map[id] = nextObj;
      }
      if (childTypeKey === 'images' || childTypeKey === 'groups') {
        const replaced = nextObj !== before;
        const diff = replaced ? objectDiffKeys(before, nextObj) : [];
        const details = replaced ? objectDiffDetails(before, nextObj) : [];
        
      }
    });
    if (map !== prevMap) nextEntities[childTypeKey] = map;
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
    // images are allowed under group/album/moment/image/profile scopes
    if (entityKey === 'images') {
      const hasParent = scopesList.some((sc) => sc && (sc.entity === 'group' || sc.entity === 'album' || sc.entity === 'moment' || sc.entity === 'image' || sc.entity === 'profile'));
      if (hasParent) return true;
    }
    // groups/albums/faces are allowed under image scope (e.g., image.groups, image.albums, image.faces)
    if (entityKey === 'groups' || entityKey === 'albums' || entityKey === 'faces') {
      const hasImage = scopesList.some((sc) => sc && sc.entity === 'image');
      if (hasImage) return true;
    }
    // albums/images are allowed under profile scope (e.g., profile.images, profile.albums)
    if (entityKey === 'images' || entityKey === 'albums') {
      const hasProfile = scopesList.some((sc) => sc && sc.entity === 'profile');
      if (hasProfile) return true;
    }
    // images/groups/moments are allowed under upload scope
    if (entityKey === 'images' || entityKey === 'groups' || entityKey === 'moments') {
      const hasUpload = scopesList.some((sc) => sc && sc.entity === 'upload');
      if (hasUpload) return true;
    }
    // access_requests are allowed under all scopes (anyone can create requests)
    if (entityKey === 'access_requests') {
      return true;
    }

    return false;
  };

  // Fallback broadcast via localStorage 'storage' event for browsers/environments without BroadcastChannel
  const storageBroadcastPrefix = 'data-sync:';
  const fallbackBroadcast = (changes) => {
    try {
      const payload = { tabId: CHANNEL_ID, ts: Date.now(), changes };
      // Unique key per message to ensure storage events always fire
      const key = `${storageBroadcastPrefix}${payload.ts}:${Math.random().toString(36).slice(2,8)}`;
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {}
  };

  const broadcast = (changes) => {
    try {
      // Send via BroadcastChannel when available
      if (channel) {
        channel.postMessage({ tabId: CHANNEL_ID, changes });
      } else {
        // Only use localStorage fallback when BroadcastChannel is not available
        fallbackBroadcast(changes);
      }
    } catch {
      // If BroadcastChannel fails at runtime, fall back
      fallbackBroadcast(changes);
    }
  };

  if (channel) {
    try {
      channel.onmessage = (ev) => {
        const data = ev?.data || {};
        if (!data || data.tabId === CHANNEL_ID) return;
        const incoming = Array.isArray(data.changes) ? data.changes : [];
        get().applyChanges(incoming, { fromBroadcast: true, ignoreScope: true });
      };
    } catch {}
  }
  // Always register storage listener as a secondary path (covers cases where BroadcastChannel isn't available)
  try {
    window.addEventListener('storage', (e) => {
      if (!e.key || !e.key.startsWith(storageBroadcastPrefix) || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue || '{}');
        if (!data || data.tabId === CHANNEL_ID) return;
        const incoming = Array.isArray(data.changes) ? data.changes : [];
        get().applyChanges(incoming, { fromBroadcast: true, ignoreScope: true });
        // Clear key so subsequent writes always fire storage event (some browsers coalesce identical values)
        try { localStorage.removeItem(e.key); } catch {}
      } catch {}
    });
  } catch {}

  return {
    ...initialState,

    // Actions
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setFavoritesAlbumId: (id) => set({ favoritesAlbumId: id }),
    setArchiveAlbumId: (id) => set({ archiveAlbumId: id }),
    setScope: (scope) => set((state) => {
      const prev = state.scope || {};
      if ((prev.entity || '') === (scope?.entity || '') && String(prev.id || '') === String(scope?.id || '')) {
        return {};
      }
      
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
      const counts = { ...(state.scopeCounts || {}) };
      const currentCount = counts[key] || 0;
      
      // Always add/update the scope entry and increment the reference count
      const nextScopes = { ...(state.scopes || {}), [key]: { entity: scope.entity, id: scope.id } };
      counts[key] = currentCount + 1;
      
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
      const applyId = Math.random().toString(36).slice(2, 7);
      if (!Array.isArray(changes) || changes.length === 0) {
        return;
      }
      const prevEntities = get().entities;
      const prevGroupsRef = prevEntities?.groups;
      const typeCounts = {};
      const relationSummaries = [];
      const nextEntities = { ...get().entities };

    // Broadcast early so receivers can process regardless of this tab's gating
    if (!options.fromBroadcast && Array.isArray(changes) && changes.length > 0) {
      try { broadcast(changes); } catch {}
    }

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
        const prevMap = nextEntities[key] || {};
        const prevObj = prevMap[id];
        if (prevObj === obj) return; // No-op; keep map ref stable
        const nextMap = { ...prevMap, [id]: obj };
        nextEntities[key] = nextMap;
        
      };

      const outgoing = [];

      changes.forEach((ch) => {
        if (!ch || !ch.type) return;
        const { ignoreScope: effIgnoreScope, broadcast: effBroadcast } = resolveFlags(ch);
        typeCounts[ch.type] = (typeCounts[ch.type] || 0) + 1;

        if (ch.type === CHANGE_TYPES.UPSERT) {
          const key = normalizeEntityKey(ch.entity);
          if (!key) return;
          const items = Array.isArray(ch.items)
            ? ch.items
            : (ch.items && typeof ch.items === 'object')
              ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
              : [];
          const prevMap = nextEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id;
            if (!id) return;
            const exists = !!map[id];
            // Gate only inserts unless ignoreScope=true
            if (!exists && !effIgnoreScope && !isEntityInsertAllowedByScopes(key)) return;
            const prev = prevMap[id] || { id };
            const mergedCandidate = { ...prev, ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
            });
            // Handle profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            // Handle upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            // Preserve set refs when contents equal
            ['images','faces','albums'].forEach((rk) => {
              if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
              }
            });
            // Preserve profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            // Preserve upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
              
            }
          });
          if (map !== prevMap) nextEntities[key] = map;
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
          const prevMap = nextEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id || it.profile_id || it.upload_id;
            if (!id) return;
            if (!prevMap[id]) return; // update-only
            const prev = prevMap[id];
            const mergedCandidate = { ...prev, ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
            });
            // Handle profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            // Handle upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            ['images','faces','albums'].forEach((rk) => {
              if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
              }
            });
            // Preserve profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            // Preserve upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
              
            }
          });
          if (map !== prevMap) nextEntities[key] = map;
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
          const prevMap = nextEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id || it.profile_id || it.upload_id;
            if (!id) return;
            const exists = !!map[id];
            // Gate only inserts unless ignoreScope=true
            if (!exists && !effIgnoreScope && !isEntityInsertAllowedByScopes(key)) return;
            const prev = prevMap[id] || { id };
            const mergedCandidate = { ...prev, ...it };
            ['images', 'faces', 'albums'].forEach((rk) => {
              if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
            });
            // Handle profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            // Handle upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (rk in mergedCandidate) mergedCandidate[rk] = coerceToSet(mergedCandidate[rk]);
              });
            }
            // Preserve set refs when contents equal
            ['images','faces','albums'].forEach((rk) => {
              if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
              }
            });
            // Preserve profile relations
            if (key === 'profiles') {
              ['images', 'albums'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            // Preserve upload relations
            if (key === 'uploads') {
              ['images', 'groups', 'moments'].forEach((rk) => {
                if (prev && prev[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
                  if (setsEqual(prev[rk], mergedCandidate[rk])) mergedCandidate[rk] = prev[rk];
                }
              });
            }
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
            }
          });
          if (map !== prevMap) nextEntities[key] = map;
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
          if (!effIgnoreScope) {
            const allowed = shouldApplyRelation(ch.relation, parentId);
            if (!allowed) return;
          }

          // RELATION_MOVE unsupported in v4

          const parent = ensureEntity(parentKey, parentId);
          const current = coerceToSet(parent[field]);
          const beforeSize = current.size;
          let beforeKeysSample = [];
          try { beforeKeysSample = Array.from(current).slice(0, 5); } catch {}

          if (ch.type === CHANGE_TYPES.RELATION_SET) {
            // Prefer entities dict keys when present
            const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
            const nextSet = coerceToSet(ids);
            if (setsEqual(current, nextSet)) {
              // No change; skip saveBack
            } else {
              parent[field] = nextSet;
            }
            if (parentKey === 'groups' && field === 'images') {
              const afterSize = parent[field].size;
              relationSummaries.push({ type: ch.type, relation: ch.relation, parentId, beforeSize, afterSize, changed: beforeSize !== afterSize });
            }
          } else if (ch.type === CHANGE_TYPES.RELATION_ADD) {
            // If relationData is provided, store it directly instead of creating a Set
            if (ch.relationData) {
              parent[field] = ch.relationData;
            } else {
              const set = new Set(current);
              const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
              ids.forEach((id) => set.add(String(id)));
              if (!setsEqual(current, set)) parent[field] = set;
            }
            if (parentKey === 'groups' && field === 'images') {
              const afterSize = ch.relationData ? Object.keys(ch.relationData).length : parent[field].size;
              relationSummaries.push({ type: ch.type, relation: ch.relation, parentId, beforeSize, afterSize, delta: afterSize - beforeSize });
            }
            
          } else if (ch.type === CHANGE_TYPES.RELATION_REMOVE) {
            const set = new Set(current);
            (ch.ids || []).forEach((id) => set.delete(String(id)));
            if (!setsEqual(current, set)) parent[field] = set;
            if (parentKey === 'groups' && field === 'images') {
              const afterSize = set.size;
              relationSummaries.push({ type: ch.type, relation: ch.relation, parentId, beforeSize, afterSize, delta: afterSize - beforeSize });
            }
            
          }
          saveBack(parentKey, parentId, parent);
          if (effBroadcast) {
            outgoing.push(ch);
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

        if (ch.type === CHANGE_TYPES.SCOPE_ADD) {
          // Only apply scope instructions in the tab that requested the API
          // Don't broadcast these instructions to other tabs
          if (!options.fromBroadcast) {
            const entity = ch.entity;
            const id = ch.id;
            if (entity && id) {
              get().addScope({ entity, id });
            }
          }
          // Don't broadcast scope instructions to other tabs
          return;
        }

        if (ch.type === CHANGE_TYPES.SCOPE_REMOVE) {
          // Only apply scope instructions in the tab that requested the API
          // Don't broadcast these instructions to other tabs
          if (!options.fromBroadcast) {
            const entity = ch.entity;
            const id = ch.id;
            if (entity && id) {
              get().removeScope({ entity, id });
            }
          }
          // Don't broadcast scope instructions to other tabs
          return;
        }
      });

      set({ entities: nextEntities });
      
      const nextGroupsRef = nextEntities?.groups;
      const prevGroupsSize = prevGroupsRef ? Object.keys(prevGroupsRef).length : 0;
      const nextGroupsSize = nextGroupsRef ? Object.keys(nextGroupsRef).length : 0;
      
      persistEntitiesSession(nextEntities);
      
      // Receiver-side will have already received the early broadcast
    },

    // Image operations
    setSelectedImages: (selectedImages) => set({ selectedImages }),
    setImageViewer: (imageViewer) => set({ imageViewer }),
    clearData: () => {
      const empty = { images: {}, groups: {}, moments: {}, albums: {}, faces: {}, profiles: {}, uploads: {} };
      persistEntitiesSession(empty);
      set({
        selectedImages: new Set(),
        imageViewer: { show: false, image: null, index: 0 },
        loading: false,
        error: null,
        entities: empty
      });
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
      const prevLen = lastArr.length;
      lastRef = ref;
      const nextArr = Object.values(ref || {});
      // Check referential stability of elements
      let sameRefs = 0;
      const prevById = {};
      lastArr.forEach(g => { if (g && g.id) prevById[g.id] = g; });
      nextArr.forEach(g => { if (g && prevById[g.id] === g) sameRefs += 1; });
      lastArr = nextArr;
      
      return lastArr;
    };
  })(),
  imagesAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.images || null;
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
  albumsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.albums || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  facesAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.faces || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  profilesAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.profiles || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  uploadsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.uploads || null;
      if (ref === lastRef) return lastArr;
      lastRef = ref;
      lastArr = Object.values(ref || {});
      return lastArr;
    };
  })(),
  accessRequestsAll: (() => {
    let lastRef = null;
    let lastArr = [];
    return (state) => {
      const ref = state.entities?.access_requests || null;
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
  uploadImages: (state, uploadId) => {
    const upload = state.entities?.uploads?.[uploadId];
    const ids = Array.from(upload?.images || []);
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

// Convenience hooks with stable outputs so components don't need local useMemo for store data
export function useGroupsList() {
  return useDataStore((state) => selectors.groupsAll(state));
}

export function useGroupById(groupId) {
  return useDataStore((state) => (groupId ? state.entities?.groups?.[groupId] || null : null));
}

export function useImagesList() {
  return useDataStore((state) => selectors.imagesAll(state));
}

export function useImageById(imageId) {
  return useDataStore((state) => (imageId ? state.entities?.images?.[imageId] || null : null));
}

export function useAlbumsList() {
  return useDataStore((state) => selectors.albumsAll(state));
}

export function useAlbumById(albumId) {
  return useDataStore((state) => (albumId ? state.entities?.albums?.[albumId] || null : null));
}

export function useMomentsList() {
  return useDataStore((state) => selectors.momentsAll(state));
}

export function useMomentById(momentId) {
  return useDataStore((state) => (momentId ? state.entities?.moments?.[momentId] || null : null));
}

export function useFacesList() {
  return useDataStore((state) => selectors.facesAll(state));
}

export function useFaceById(faceId) {
  return useDataStore((state) => (faceId ? state.entities?.faces?.[faceId] || null : null));
}

export function useProfilesList() {
  return useDataStore((state) => selectors.profilesAll(state));
}

export function useProfileById(profileId) {
  return useDataStore((state) => (profileId ? state.entities?.profiles?.[profileId] || null : null));
}

export function useUploadsList() {
  return useDataStore((state) => selectors.uploadsAll(state));
}

export function useUploadById(uploadId) {
  return useDataStore((state) => (uploadId ? state.entities?.uploads?.[uploadId] || null : null));
}

export function useRequestsList() {
  return useDataStore((state) => selectors.accessRequestsAll(state));
}

export function useRequestById(requestId) {
  return useDataStore((state) => (requestId ? state.entities?.access_requests?.[requestId] || null : null));
}

 


