import { create } from 'zustand';
import { getStoragePrefix } from '../config/appConfig';

// Centralized storage keys (prefix derived from app name)
const prefix = getStoragePrefix();
export const STORAGE_KEYS = {
  ENTITIES: `${prefix}_entities`,
  CURRENT_PROFILE: `${prefix}_currentProfile`,
  PREFERENCES: `${prefix}_preferences`,
};

export const CHANGE_TYPES = {
  UPSERT: 'UPSERT',
  UPDATE: 'UPDATE',
  INSERT: 'INSERT',
  REMOVE: 'REMOVE',
  RELATION_ADD: 'RELATION_ADD',
  RELATION_REMOVE: 'RELATION_REMOVE',
  RELATION_SET: 'RELATION_SET',
  RELATION_UPSERT: 'RELATION_UPSERT',
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

// Centralized entity structure definition
const ENTITY_STRUCTURE = {
  // Event-scoped entities (per event)
  images: {
    relations: ['albums', 'faces', 'groups'],
  },
  groups: {
    relations: ['images', 'faces'],
  },
  moments: {
    relations: ['images'],
  },
  albums: {
    relations: ['images'],
  },
  faces: {
    relations: [],
  },
  event_profiles: {
    relations: ['images', 'albums', 'groups'],
  },
  uploads: {
    relations: ['images', 'groups', 'moments'],
    relationTypes: {
      groups: 'dict', // Store as dict with relation data (faces_count, upload_faces_count)
      moments: 'dict', // Store as dict with relation data (images_count, upload_images_count)
    },
  },
  access_requests: {
    relations: ['groups'],
    relationTypes: {
      groups: 'dict', // Store as dict with relation data (approved, closed_at, closed_by)
    },
  },
  my_access_requests: {
    relations: ['groups'],
    relationTypes: {
      groups: 'dict', // Store as dict with relation data (approved, closed_at, closed_by)
    },
  },
  // General entities (cross-event)
  profiles: {
    relations: [],
  },
  my_notifications: {
    relations: [],
  },
  feedbacks: {
    relations: [],
  },
  my_feedbacks: {
    relations: [],
  },
  events: {
    relations: [],
  },
};

const ENTITY_TYPES = Object.keys(ENTITY_STRUCTURE);

// Event-scoped entities
const EVENT_ENTITY_TYPES = ['images', 'groups', 'moments', 'albums', 'faces', 'event_profiles', 'uploads', 'access_requests', 'my_access_requests'];

// General entities (not scoped to events)
const GENERAL_ENTITY_TYPES = ['profiles', 'my_notifications', 'feedbacks', 'my_feedbacks', 'events'];

function getEntityType(entity) {
  const normalized = normalizeEntityKey(entity);
  return ENTITY_TYPES.includes(normalized) ? normalized : null;
}

function getRelationType(entityType, relationField) {
  return ENTITY_STRUCTURE[entityType]?.relationTypes?.[relationField] || 'set';
}

function shouldStoreAsDict(entityType, relationField) {
  return getRelationType(entityType, relationField) === 'dict';
}

function normalizeEntityKey(entity, eventId = null) {
  if (!entity) return entity;
  const entityStr = String(entity);
  
  switch (entityStr) {
    case 'image': return 'images';
    case 'group': return 'groups';
    case 'moment': return 'moments';
    case 'album': return 'albums';
    case 'face': return 'faces';
    case 'profile': 
      // 'profile' maps to 'event_profiles' for event-scoped, 'profiles' for general
      // This will be determined by event_id in the change processing
      return eventId && eventId !== 'general' ? 'event_profiles' : 'profiles';
    case 'upload': return 'uploads';
    case 'access_request': return 'access_requests';
    case 'my_access_request': return 'my_access_requests';
    case 'my_notification': return 'my_notifications';
    case 'feedback': return 'feedbacks';
    case 'my_feedback': return 'my_feedbacks';
    case 'event': return 'events';
    case 'events': return 'events';
    case 'local_storage': return 'localStore';
    case 'localStorage': return 'localStore';
    // Already plural forms
    case 'event_profiles': return 'event_profiles';
    case 'profiles': return 'profiles';
    default: return entity;
  }
}

function coerceToSet(val) {
  if (!val) return new Set();
  if (val instanceof Set) return val;
  if (Array.isArray(val)) return new Set(val.map(String));
  return new Set();
}

// Helper to normalize relations based on entity structure
function normalizeRelations(entityType, data) {
  const structure = ENTITY_STRUCTURE[entityType];
  if (!structure) return data;
  
  const relations = structure.relations || [];
  const normalized = { ...data };
  
  relations.forEach((rk) => {
    if (rk in normalized) {
      const isDict = shouldStoreAsDict(entityType, rk);
      if (!isDict) {
        normalized[rk] = coerceToSet(normalized[rk]);
      }
    }
  });
  
  return normalized;
}

// Helper to preserve relation references when contents haven't changed
function preserveRelations(entityType, before, merged) {
  const structure = ENTITY_STRUCTURE[entityType];
  if (!structure) return merged;
  
  const relations = structure.relations || [];
  const result = { ...merged };
  
  relations.forEach((rk) => {
    if (!before || !result[rk]) return;
    
    const isDict = shouldStoreAsDict(entityType, rk);
    const beforeVal = before[rk];
    const mergedVal = result[rk];
    
    if (isDict && beforeVal && mergedVal && 
        typeof beforeVal === 'object' && typeof mergedVal === 'object' &&
        !Array.isArray(beforeVal) && !Array.isArray(mergedVal) &&
        !(beforeVal instanceof Set) && !(mergedVal instanceof Set)) {
      if (shallowEqualPlainObject(beforeVal, mergedVal)) {
        result[rk] = beforeVal;
      }
    } else if (!isDict && beforeVal instanceof Set && mergedVal instanceof Set) {
      if (setsEqual(beforeVal, mergedVal)) {
        result[rk] = beforeVal;
      }
    }
  });
  
  return result;
}

function persistEntitiesSession(entities) {
  try {
    const plain = {};
    
    // Process each event or 'general'
    Object.keys(entities).forEach((eventIdOrGeneral) => {
      plain[eventIdOrGeneral] = {};
      const eventEntities = entities[eventIdOrGeneral] || {};
      
      // Determine which entity types to process
      const entityTypes = eventIdOrGeneral === 'general' ? GENERAL_ENTITY_TYPES : EVENT_ENTITY_TYPES;
      
      entityTypes.forEach((entityType) => {
        const src = eventEntities[entityType] || {};
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
        plain[eventIdOrGeneral][entityType] = out;
      });
    });
    
    sessionStorage.setItem(STORAGE_KEYS.ENTITIES, JSON.stringify(plain));
  } catch {}
}

function hydrateEntitiesSession() {
  try {
    // Clear old session data and on actual reloads so each F5 starts fresh
    const nav = (performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation') : [];
    const isReload = Array.isArray(nav) && nav.length > 0 ? (nav[0]?.type === 'reload') : (performance && performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      // Clean break - remove old structure
      sessionStorage.removeItem('entities');
      sessionStorage.removeItem(STORAGE_KEYS.ENTITIES);
    } else {
      // Always remove old 'entities' key if it exists
      sessionStorage.removeItem('entities');
    }
  } catch {}

  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.ENTITIES);
    
    // Initialize base structure with general
    const base = {
      general: {}
    };
    GENERAL_ENTITY_TYPES.forEach((entityType) => {
      base.general[entityType] = {};
    });
    
    if (!raw) return base;
    
    const parsed = JSON.parse(raw);
    const revived = {};
    
    // Process each event or 'general'
    Object.keys(parsed).forEach((eventIdOrGeneral) => {
      revived[eventIdOrGeneral] = {};
      const eventData = parsed[eventIdOrGeneral] || {};
      
      // Determine which entity types to process
      const entityTypes = eventIdOrGeneral === 'general' ? GENERAL_ENTITY_TYPES : EVENT_ENTITY_TYPES;
      
      entityTypes.forEach((entityType) => {
        const src = eventData[entityType] || {};
        const out = {};
        Object.keys(src).forEach((id) => {
          const e = { ...src[id] };
          Object.keys(e).forEach((fk) => {
            if (Array.isArray(e[fk])) {
              const relationType = getRelationType(entityType, fk);
              if (relationType === 'dict') {
                // Dict relations stay as objects
              } else {
                e[fk] = new Set(e[fk].map(String));
              }
            }
          });
          out[id] = e;
        });
        revived[eventIdOrGeneral][entityType] = out;
      });
    });
    
    // Ensure general exists
    if (!revived.general) {
      revived.general = {};
      GENERAL_ENTITY_TYPES.forEach((entityType) => {
        revived.general[entityType] = {};
      });
    }
    
    return revived;
  } catch {
    // Return empty structure on error
    const empty = {
      general: {}
    };
    GENERAL_ENTITY_TYPES.forEach((entityType) => {
      empty.general[entityType] = {};
    });
    return empty;
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

    // Notifications meta
    notificationsMeta: { unreadCount: 0, totalCount: 0 },
  };

  const applyUpsertsFromEntitiesDict = (childTypeKey, entitiesDict, eventEntities) => {
    if (!entitiesDict || typeof entitiesDict !== 'object') return;
    const prevMap = eventEntities[childTypeKey] || {};
    let map = prevMap;
    const structure = ENTITY_STRUCTURE[childTypeKey];
    const relations = structure?.relations || [];
    
    Object.keys(entitiesDict).forEach((id) => {
      const raw = entitiesDict[id] || {};
      const normalized = { id, ...raw };
      
      // Handle relations based on their types
      relations.forEach((rk) => {
        if (rk in normalized) {
          const isDict = shouldStoreAsDict(childTypeKey, rk);
          if (isDict && typeof normalized[rk] === 'object' && !Array.isArray(normalized[rk])) {
            // Keep as dict
          } else {
            normalized[rk] = coerceToSet(normalized[rk]);
          }
        }
      });
      
      const before = prevMap[id];
      const mergedCandidate = { ...(before || { id }), ...normalized };
      
      // Preserve references when contents didn't change
      relations.forEach((rk) => {
        const isDict = shouldStoreAsDict(childTypeKey, rk);
        if (isDict && before && before[rk] && mergedCandidate[rk] && 
            typeof before[rk] === 'object' && typeof mergedCandidate[rk] === 'object' &&
            !Array.isArray(before[rk]) && !Array.isArray(mergedCandidate[rk]) &&
            !(before[rk] instanceof Set) && !(mergedCandidate[rk] instanceof Set)) {
          if (shallowEqualPlainObject(before[rk], mergedCandidate[rk])) {
            mergedCandidate[rk] = before[rk];
          }
        } else if (!isDict && before && before[rk] instanceof Set && mergedCandidate[rk] instanceof Set) {
          if (setsEqual(before[rk], mergedCandidate[rk])) {
            mergedCandidate[rk] = before[rk];
          }
        }
      });
      
      const nextObj = before && shallowEqualObjects(before, mergedCandidate) ? before : mergedCandidate;
      if (nextObj !== before) {
        if (map === prevMap) map = { ...prevMap };
        map[id] = nextObj;
      }
    });
    if (map !== prevMap) eventEntities[childTypeKey] = map;
  };

  const shouldApplyRelation = (relation, parentId, eventId) => {
    const state = get();
    const single = state.scope || {};
    const scopesMap = state.scopes || {};
    const scopesList = [single, ...Object.values(scopesMap)];
    const [parentType] = String(relation || '').split('.');
    const parentKey = normalizeEntityKey(parentType, eventId);
    for (const sc of scopesList) {
      if (!sc || !sc.entity) continue;
      // Check if scope matches the event
      if (sc.eventId && String(sc.eventId) !== String(eventId)) continue;
      if (sc.entity === parentType && (!sc.id || String(sc.id) === String(parentId))) return true;
      if (sc.entity === 'all' && String(sc.id) === String(parentKey)) return true;
    }
    return false;
  };

  const isEntityInsertAllowedByScopes = (entityKey, eventId) => {
    const state = get();
    const single = state.scope || {};
    const scopesMap = state.scopes || {};
    const scopesList = [single, ...Object.values(scopesMap)];

    // Filter scopes to match the event
    const eventScopes = scopesList.filter((sc) => !sc || !sc.eventId || String(sc.eventId) === String(eventId));

    // Helper: does any scope match exactly this entity set?
    const hasAllScope = eventScopes.some((sc) => sc && sc.entity === 'all' && String(sc.id) === String(entityKey));
    if (hasAllScope) return true;

    // Singular entity type
    const singular = String(entityKey).replace(/s$/, '');
    if (singular === 'event_profile') {
      // event_profiles should match 'profile' scope
      const hasDirect = eventScopes.some((sc) => sc && (sc.entity === singular || sc.entity === 'profile'));
      if (hasDirect) return true;
    } else {
      // Direct entity scope (e.g., group:<id> allows group upserts)
      const hasDirect = eventScopes.some((sc) => sc && sc.entity === singular);
      if (hasDirect) return true;
    }

    // Relationship-derived allowances
    // images are allowed under group/album/moment/image/profile/event_profile scopes
    if (entityKey === 'images') {
      const hasParent = eventScopes.some((sc) => sc && (sc.entity === 'group' || sc.entity === 'album' || sc.entity === 'moment' || sc.entity === 'image' || sc.entity === 'profile' || sc.entity === 'event_profile'));
      if (hasParent) return true;
    }
    // groups/albums/faces are allowed under image scope (e.g., image.groups, image.albums, image.faces)
    if (entityKey === 'groups' || entityKey === 'albums' || entityKey === 'faces') {
      const hasImage = eventScopes.some((sc) => sc && sc.entity === 'image');
      if (hasImage) return true;
    }
    // albums/images/groups are allowed under profile/event_profile scope
    if (entityKey === 'images' || entityKey === 'albums' || entityKey === 'groups') {
      const hasProfile = eventScopes.some((sc) => sc && (sc.entity === 'profile' || sc.entity === 'event_profile'));
      if (hasProfile) return true;
    }
    // images/groups/moments are allowed under upload scope
    if (entityKey === 'images' || entityKey === 'groups' || entityKey === 'moments') {
      const hasUpload = eventScopes.some((sc) => sc && sc.entity === 'upload');
      if (hasUpload) return true;
    }
    // access_requests are allowed under all scopes (anyone can create requests)
    if (entityKey === 'access_requests' || entityKey === 'my_access_requests') {
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
      if ((prev.entity || '') === (scope?.entity || '') && 
          String(prev.id || '') === String(scope?.id || '') &&
          String(prev.eventId || '') === String(scope?.eventId || '')) {
        return {};
      }
      
      const scopes = {};
      if (scope?.entity) {
        const key = `${scope.eventId || 'general'}:${scope.entity}:${scope.id ?? ''}`;
        scopes[key] = { entity: scope.entity, id: scope.id, eventId: scope.eventId };
      }
      return { 
        scope: { entity: scope?.entity, id: scope?.id, eventId: scope?.eventId }, 
        scopes, 
        scopeCounts: scopes && Object.keys(scopes).length ? { [Object.keys(scopes)[0]]: 1 } : {} 
      };
    }),
    addScope: (scope) => set((state) => {
      if (!scope?.entity) return {};
      const key = `${scope.eventId || 'general'}:${scope.entity}:${scope.id ?? ''}`;
      const counts = { ...(state.scopeCounts || {}) };
      const currentCount = counts[key] || 0;
      
      // Always add/update the scope entry and increment the reference count
      const nextScopes = { ...(state.scopes || {}), [key]: { entity: scope.entity, id: scope.id, eventId: scope.eventId } };
      counts[key] = currentCount + 1;
      
      return { scopes: nextScopes, scopeCounts: counts };
    }),
    removeScope: (scope) => set((state) => {
      if (!scope?.entity) return {};
      const key = `${scope.eventId || 'general'}:${scope.entity}:${scope.id ?? ''}`;
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
      const typeCounts = {};
      const relationSummaries = [];
      const nextEntities = { ...get().entities };

    // Broadcast early so receivers can process regardless of this tab's gating
    if (!options.fromBroadcast && Array.isArray(changes) && changes.length > 0) {
      try { broadcast(changes); } catch {}
    }

      // Helper to ensure event container exists
      const ensureEventContainer = (eventId) => {
        if (!nextEntities[eventId]) {
          nextEntities[eventId] = {};
          const entityTypes = eventId === 'general' ? GENERAL_ENTITY_TYPES : EVENT_ENTITY_TYPES;
          entityTypes.forEach((entityType) => {
            nextEntities[eventId][entityType] = {};
          });
        }
        return nextEntities[eventId];
      };

      // Ensure general container always exists
      if (!nextEntities.general) {
        nextEntities.general = {};
        GENERAL_ENTITY_TYPES.forEach((entityType) => {
          nextEntities.general[entityType] = {};
        });
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
          RELATION_UPSERT: { ignoreScope: false, broadcast: true },
          REMOVE: { ignoreScope: false, broadcast: true },
        }[type] || { ignoreScope: false, broadcast: true };
        const callIgnore = Object.prototype.hasOwnProperty.call(options, 'ignoreScope') ? !!options.ignoreScope : undefined;
        const callBroadcast = Object.prototype.hasOwnProperty.call(options, 'broadcast') ? !!options.broadcast : undefined;
        const effIgnore = Object.prototype.hasOwnProperty.call(ch, 'ignoreScope') ? !!ch.ignoreScope : (callIgnore !== undefined ? callIgnore : typeDefaults.ignoreScope);
        const effBroadcast = Object.prototype.hasOwnProperty.call(ch, 'broadcast') ? !!ch.broadcast : (callBroadcast !== undefined ? callBroadcast : typeDefaults.broadcast);
        return { ignoreScope: effIgnore, broadcast: effBroadcast };
      };

      const ensureEntity = (eventEntities, key, id) => {
        const map = eventEntities[key] || {};
        const curr = map[id] || { id };
        eventEntities[key] = map;
        return curr;
      };

      const saveBack = (eventEntities, key, id, obj) => {
        const prevMap = eventEntities[key] || {};
        const prevObj = prevMap[id];
        if (prevObj === obj) return; // No-op; keep map ref stable
        const nextMap = { ...prevMap, [id]: obj };
        eventEntities[key] = nextMap;
        
      };

      const outgoing = [];

      changes.forEach((ch) => {
        if (!ch || !ch.type) return;
        
        // Extract event_id from change (defaults to 'general')
        const eventId = ch.event_id || 'general';
        const entityKey = normalizeEntityKey(ch.entity, eventId);
        const { ignoreScope: effIgnoreScope, broadcast: effBroadcast } = resolveFlags(ch);
        typeCounts[ch.type] = (typeCounts[ch.type] || 0) + 1;

        // Handle localStorage updates (don't broadcast - localStorage is per-origin)
        if (entityKey === 'localStore') {
          if (ch.type === CHANGE_TYPES.REMOVE) {
            // REMOVE uses ids array
            const ids = ch.ids || [];
            ids.forEach((storageKey) => {
              if (!storageKey) return;
              try {
                // Map to frw_ prefixed keys
                const mappedKey = storageKey === 'currentProfile' ? STORAGE_KEYS.CURRENT_PROFILE :
                                  storageKey === 'preferences' ? STORAGE_KEYS.PREFERENCES :
                                  storageKey;
                localStorage.removeItem(String(mappedKey));
              } catch (e) {
                console.warn('Failed to remove from localStorage:', e);
              }
            });
          } else {
            // UPSERT/UPDATE use items
            const items = Array.isArray(ch.items)
              ? ch.items
              : (ch.items && typeof ch.items === 'object')
                ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
                : [];
            
            items.forEach((it) => {
              if (!it || !it.id) return;
              const storageKey = it.id;
              
              // Map to frw_ prefixed keys
              const mappedKey = storageKey === 'currentProfile' ? STORAGE_KEYS.CURRENT_PROFILE :
                                storageKey === 'preferences' ? STORAGE_KEYS.PREFERENCES :
                                storageKey;
              
              if (ch.type === CHANGE_TYPES.UPSERT) {
                // Replace entire value
                try {
                  const value = { ...it };
                  delete value.id;
                  localStorage.setItem(mappedKey, JSON.stringify(value));
                  // Dispatch custom event for same-tab updates
                  if (storageKey === 'currentProfile') {
                    window.dispatchEvent(new Event('localStorage:currentProfile'));
                  }
                } catch (e) {
                  console.warn('Failed to update localStorage:', e);
                }
              } else if (ch.type === CHANGE_TYPES.UPDATE) {
                // Merge into existing value
                try {
                  const existingRaw = localStorage.getItem(mappedKey);
                  const existing = existingRaw ? JSON.parse(existingRaw) : {};
                  const merged = { ...existing, ...it };
                  delete merged.id;
                  localStorage.setItem(mappedKey, JSON.stringify(merged));
                  // Dispatch custom event for same-tab updates
                  if (storageKey === 'currentProfile') {
                    window.dispatchEvent(new Event('localStorage:currentProfile'));
                  }
                } catch (e) {
                  console.warn('Failed to update localStorage:', e);
                }
              }
            });
          }
          // Don't broadcast - localStorage is per-origin, not per-tab
          return;
        }

        if (ch.type === CHANGE_TYPES.UPSERT) {
          const key = entityKey;
          if (!key) return;
          
          // Get or create event container
          const eventEntities = ensureEventContainer(eventId);
          
          const items = Array.isArray(ch.items)
            ? ch.items
            : (ch.items && typeof ch.items === 'object')
              ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
              : [];
          const prevMap = eventEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id || it.profile_id;
            if (!id) return;
            const exists = !!map[id];
            // Gate only inserts unless ignoreScope=true
            if (!exists && !effIgnoreScope && !isEntityInsertAllowedByScopes(key, eventId)) return;
            const prev = prevMap[id] || { id };
            const merged = { ...prev, ...it };
            const normalized = normalizeRelations(key, merged);
            const mergedCandidate = preserveRelations(key, prev, normalized);
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
              
            }
          });
          if (map !== prevMap) eventEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (ch.type === CHANGE_TYPES.UPDATE) {
          const key = entityKey;
          if (!key) return;
          
          // Get or create event container
          const eventEntities = ensureEventContainer(eventId);
          
          const items = Array.isArray(ch.items)
            ? ch.items
            : (ch.items && typeof ch.items === 'object')
              ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
              : [];
          const prevMap = eventEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id || it.profile_id || it.upload_id;
            if (!id) return;
            if (!prevMap[id]) return; // update-only
            const prev = prevMap[id];
            const merged = { ...prev, ...it };
            const normalized = normalizeRelations(key, merged);
            const mergedCandidate = preserveRelations(key, prev, normalized);
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
              
            }
          });
          if (map !== prevMap) eventEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (ch.type === CHANGE_TYPES.INSERT) {
          const key = entityKey;
          if (!key) return;
          
          // Get or create event container
          const eventEntities = ensureEventContainer(eventId);
          
          const items = Array.isArray(ch.items)
            ? ch.items
            : (ch.items && typeof ch.items === 'object')
              ? Object.keys(ch.items).map((id) => ({ id, ...ch.items[id] }))
              : [];
          const prevMap = eventEntities[key] || {};
          let map = prevMap;
          items.forEach((it) => {
            if (!it) return;
            const id = it.id || it.image_id || it.group_id || it.moment_id || it.album_id || it.face_id || it.profile_id || it.upload_id;
            if (!id) return;
            const exists = !!map[id];
            // Gate only inserts unless ignoreScope=true
            if (!exists && !effIgnoreScope && !isEntityInsertAllowedByScopes(key, eventId)) return;
            const prev = prevMap[id] || { id };
            const merged = { ...prev, ...it };
            const normalized = normalizeRelations(key, merged);
            const mergedCandidate = preserveRelations(key, prev, normalized);
            const nextObj = shallowEqualObjects(prev, mergedCandidate) ? prev : mergedCandidate;
            if (nextObj !== prev) {
              if (map === prevMap) map = { ...prevMap };
              map[id] = nextObj;
            }
          });
          if (map !== prevMap) eventEntities[key] = map;
          if (effBroadcast) outgoing.push(ch);
          return;
        }

        if (
          ch.type === CHANGE_TYPES.RELATION_SET ||
          ch.type === CHANGE_TYPES.RELATION_ADD ||
          ch.type === CHANGE_TYPES.RELATION_REMOVE ||
          ch.type === CHANGE_TYPES.RELATION_UPSERT
        ) {
          const [parentType, childType] = String(ch.relation || '').split('.');
          const parentKey = normalizeEntityKey(parentType, eventId);
          if (!parentKey) return;
          const field = normalizeEntityKey(childType, eventId).replace(/s$/, 's');
          const isDictRelation = shouldStoreAsDict(parentKey, field);

          // Get or create event container
          const eventEntities = ensureEventContainer(eventId);

          // Apply child entity upserts when 'entities' dict is provided (local only, ignore scopes)
          if (ch.entities && (ch.type === CHANGE_TYPES.RELATION_SET || ch.type === CHANGE_TYPES.RELATION_ADD)) {
            const childKey = normalizeEntityKey(childType, eventId);
            applyUpsertsFromEntitiesDict(childKey, ch.entities, eventEntities);
          }

          // Gate relation mutations by scope
          const parentId = String(ch.parentId ?? '');
          if (!parentId) return;
          if (!effIgnoreScope) {
            const allowed = shouldApplyRelation(ch.relation, parentId, eventId);
            if (!allowed) return;
          }

          const parent = ensureEntity(eventEntities, parentKey, parentId);
          let beforeSize = 0;
          let beforeValue = null;
          
          if (isDictRelation) {
            beforeValue = parent[field];
            beforeSize = beforeValue && typeof beforeValue === 'object' && !Array.isArray(beforeValue) ? Object.keys(beforeValue).length : 0;
          } else {
            const current = coerceToSet(parent[field]);
            beforeValue = current;
            beforeSize = current.size;
          }

          if (ch.type === CHANGE_TYPES.RELATION_SET) {
            if (isDictRelation && ch.relationData) {
              // Store relationData directly as dict
              parent[field] = ch.relationData;
            } else {
              // Regular Set relation
              const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
              const nextSet = coerceToSet(ids);
              if (!setsEqual(beforeValue instanceof Set ? beforeValue : coerceToSet(beforeValue), nextSet)) {
                parent[field] = nextSet;
              }
            }
          } else if (ch.type === CHANGE_TYPES.RELATION_ADD) {
            if (isDictRelation && ch.relationData) {
              // Merge relationData into existing dict
              const existing = parent[field] && typeof parent[field] === 'object' && !Array.isArray(parent[field]) ? parent[field] : {};
              const merged = { ...existing, ...ch.relationData };
              parent[field] = merged;
            } else {
              // Regular Set addition
              const set = coerceToSet(beforeValue);
              const ids = ch.entities ? Object.keys(ch.entities).map(String) : (ch.ids || []).map(String);
              ids.forEach((id) => set.add(String(id)));
              if (!setsEqual(coerceToSet(beforeValue), set)) parent[field] = set;
            }
          } else if (ch.type === CHANGE_TYPES.RELATION_REMOVE) {
            if (isDictRelation) {
              // Remove keys from dict
              const existing = parent[field] && typeof parent[field] === 'object' && !Array.isArray(parent[field]) ? parent[field] : {};
              const filtered = {};
              Object.keys(existing).forEach((key) => {
                if (!(ch.ids || []).includes(key)) {
                  filtered[key] = existing[key];
                }
              });
              parent[field] = Object.keys(filtered).length > 0 ? filtered : {};
            } else {
              // Regular Set removal
              const set = new Set(beforeValue instanceof Set ? beforeValue : coerceToSet(beforeValue));
              (ch.ids || []).forEach((id) => set.delete(String(id)));
              if (!setsEqual(coerceToSet(beforeValue), set)) parent[field] = set;
            }
          } else if (ch.type === CHANGE_TYPES.RELATION_UPSERT) {
            if (isDictRelation && ch.relationData) {
              // Upsert relationData (add new keys or update existing keys)
              const existing = parent[field] && typeof parent[field] === 'object' && !Array.isArray(parent[field]) ? parent[field] : {};
              const updated = { ...existing };
              let changed = false;
              
              Object.keys(ch.relationData).forEach((key) => {
                const oldEntry = existing[key];
                const newEntry = oldEntry ? { ...oldEntry, ...ch.relationData[key] } : ch.relationData[key];
                
                // Only update if values actually changed
                if (!oldEntry || !shallowEqualPlainObject(oldEntry, newEntry)) {
                  updated[key] = newEntry;
                  changed = true;
                }
              });
              
              if (changed) {
                parent[field] = updated;
              }
            }
            // RELATION_UPSERT only works for dict relations; ignored for Set relations
          }
          
          saveBack(eventEntities, parentKey, parentId, parent);
          if (effBroadcast) {
            outgoing.push(ch);
          }
          return;
        }

        if (ch.type === CHANGE_TYPES.REMOVE) {
          const key = entityKey;
          if (!key) return;
          
          // Get or create event container
          const eventEntities = ensureEventContainer(eventId);
          
          const ids = ch.ids || [];
          const map = { ...(eventEntities[key] || {}) };
          ids.forEach((id) => { delete map[id]; });
          eventEntities[key] = map;
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
              get().addScope({ entity, id, eventId });
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
              get().removeScope({ entity, id, eventId });
            }
          }
          // Don't broadcast scope instructions to other tabs
          return;
        }
      });

      set({ entities: nextEntities });
      
      persistEntitiesSession(nextEntities);
      
      // Receiver-side will have already received the early broadcast
    },

    // Image operations
    setSelectedImages: (selectedImages) => set({ selectedImages }),
    setImageViewer: (imageViewer) => set({ imageViewer }),
    clearData: () => {
      const empty = {
        general: {}
      };
      GENERAL_ENTITY_TYPES.forEach((entityType) => {
        empty.general[entityType] = {};
      });
      persistEntitiesSession(empty);
      set({
        selectedImages: new Set(),
        imageViewer: { show: false, image: null, index: 0 },
        loading: false,
        error: null,
        entities: empty,
        notificationsMeta: { unreadCount: 0, totalCount: 0 }
      });
    },

    // Notifications meta
    setNotificationsMeta: (meta) => set((state) => ({ notificationsMeta: { ...(state.notificationsMeta || {}), ...(meta || {}) } })),
  };
});

// Memoization cache for selectors (per eventId)
const selectorCache = {
  groups: new Map(),
  images: new Map(),
  moments: new Map(),
  albums: new Map(),
  faces: new Map(),
  event_profiles: new Map(),
  uploads: new Map(),
  access_requests: new Map(),
  my_access_requests: new Map(),
  profiles_general: null,
  my_notifications_general: null,
  events_general: null,
};

export const selectors = {
  // Event-scoped selectors (require eventId) - with memoization
  // CRITICAL: Use null fallback, NOT {}, to avoid creating new object refs
  groupsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.groups || null;
    const cache = selectorCache.groups.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.groups.set(eventId, { ref, arr });
    return arr;
  },
  imagesAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.images || null;
    const cache = selectorCache.images.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.images.set(eventId, { ref, arr });
    return arr;
  },
  momentsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.moments || null;
    const cache = selectorCache.moments.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.moments.set(eventId, { ref, arr });
    return arr;
  },
  albumsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.albums || null;
    const cache = selectorCache.albums.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.albums.set(eventId, { ref, arr });
    return arr;
  },
  facesAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.faces || null;
    const cache = selectorCache.faces.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.faces.set(eventId, { ref, arr });
    return arr;
  },
  eventProfilesAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.event_profiles || null;
    const cache = selectorCache.event_profiles.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.event_profiles.set(eventId, { ref, arr });
    return arr;
  },
  uploadsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.uploads || null;
    const cache = selectorCache.uploads.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.uploads.set(eventId, { ref, arr });
    return arr;
  },
  accessRequestsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.access_requests || null;
    const cache = selectorCache.access_requests.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.access_requests.set(eventId, { ref, arr });
    return arr;
  },
  myAccessRequestsAll: (state, eventId) => {
    const ref = state.entities?.[eventId]?.my_access_requests || null;
    const cache = selectorCache.my_access_requests.get(eventId);
    if (cache && cache.ref === ref) return cache.arr;
    const arr = ref ? Object.values(ref) : [];
    selectorCache.my_access_requests.set(eventId, { ref, arr });
    return arr;
  },
  // General selectors (no eventId needed) - with memoization
  profilesAll: (state) => {
    const ref = state.entities?.general?.profiles || null;
    if (selectorCache.profiles_general && selectorCache.profiles_general.ref === ref) {
      return selectorCache.profiles_general.arr;
    }
    const arr = ref ? Object.values(ref) : [];
    selectorCache.profiles_general = { ref, arr };
    return arr;
  },
  eventsAll: (state) => {
    const ref = state.entities?.general?.events || null;
    if (selectorCache.events_general && selectorCache.events_general.ref === ref) {
      return selectorCache.events_general.arr;
    }
    const arr = ref ? Object.values(ref) : [];
    selectorCache.events_general = { ref, arr };
    return arr;
  },
  myNotificationsAll: (state) => {
    const ref = state.entities?.general?.my_notifications || null;
    if (selectorCache.my_notifications_general && selectorCache.my_notifications_general.ref === ref) {
      return selectorCache.my_notifications_general.arr;
    }
    const arr = ref ? Object.values(ref) : [];
    selectorCache.my_notifications_general = { ref, arr };
    return arr;
  },
  feedbacksAll: (state) => {
    const ref = state.entities?.general?.feedbacks || null;
    if (selectorCache.feedbacks_general && selectorCache.feedbacks_general.ref === ref) {
      return selectorCache.feedbacks_general.arr;
    }
    const arr = ref ? Object.values(ref) : [];
    selectorCache.feedbacks_general = { ref, arr };
    return arr;
  },
  myFeedbacksAll: (state) => {
    const ref = state.entities?.general?.my_feedbacks || null;
    if (selectorCache.my_feedbacks_general && selectorCache.my_feedbacks_general.ref === ref) {
      return selectorCache.my_feedbacks_general.arr;
    }
    const arr = ref ? Object.values(ref) : [];
    selectorCache.my_feedbacks_general = { ref, arr };
    return arr;
  },
  groupImages: (state, eventId, groupId) => {
    const group = state.entities?.[eventId]?.groups?.[groupId];
    const ids = Array.from(group?.images || []);
    return ids.map((id) => state.entities?.[eventId]?.images?.[id]).filter(Boolean);
  },
  albumImages: (state, eventId, albumId) => {
    const album = state.entities?.[eventId]?.albums?.[albumId];
    const ids = Array.from(album?.images || []);
    return ids.map((id) => state.entities?.[eventId]?.images?.[id]).filter(Boolean);
  },
  momentImages: (state, eventId, momentId) => {
    const moment = state.entities?.[eventId]?.moments?.[momentId];
    const ids = Array.from(moment?.images || []);
    return ids.map((id) => state.entities?.[eventId]?.images?.[id]).filter(Boolean);
  },
  uploadImages: (state, eventId, uploadId) => {
    const upload = state.entities?.[eventId]?.uploads?.[uploadId];
    const ids = Array.from(upload?.images || []);
    return ids.map((id) => state.entities?.[eventId]?.images?.[id]).filter(Boolean);
  },
  imageById: (state, eventId, id) => state.entities?.[eventId]?.images?.[id] || null,
  albumMembershipSets: (state, eventId) => {
    const favId = state.favoritesAlbumId;
    const arcId = state.archiveAlbumId;
    const favSet = (favId && state.entities?.[eventId]?.albums?.[favId]?.images) || new Set();
    const arcSet = (arcId && state.entities?.[eventId]?.albums?.[arcId]?.images) || new Set();
    return { favoritesSet: favSet, archiveSet: arcSet };
  },
  isFavorite: (state, eventId, imageId) => {
    const favId = state.favoritesAlbumId;
    const favSet = favId && state.entities?.[eventId]?.albums?.[favId]?.images;
    if (favSet instanceof Set) return favSet.has(String(imageId));
    const img = state.entities?.[eventId]?.images?.[imageId];
    return !!(img?.is_favorite ?? img?.is_favorites);
  },
  isArchived: (state, eventId, imageId) => {
    const arcId = state.archiveAlbumId;
    const arcSet = arcId && state.entities?.[eventId]?.albums?.[arcId]?.images;
    if (arcSet instanceof Set) return arcSet.has(String(imageId));
    const img = state.entities?.[eventId]?.images?.[imageId];
    return !!img?.is_archived;
  },
  visibleImages: (state, eventId, ids, { includeArchived = true } = {}) => {
    const list = (ids || []).map((id) => state.entities?.[eventId]?.images?.[id]).filter(Boolean);
    if (includeArchived) return list;
    return list.filter((img) => !img?.is_archived);
  },
};

// Stable empty array to avoid creating new instances
const EMPTY_ARRAY = Object.freeze([]);

// Convenience hooks with stable outputs so components don't need local useMemo for store data

// Event-scoped hooks (require eventId)
// Note: We don't use useCallback here - Zustand handles subscription stability internally.
// The selectors have internal memoization to return stable array references.
export function useGroupsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.groupsAll(state, eventId) : EMPTY_ARRAY));
}

export function useGroupById(eventId, groupId) {
  return useDataStore((state) => (eventId && groupId ? state.entities?.[eventId]?.groups?.[groupId] || null : null));
}

export function useImagesList(eventId) {
  return useDataStore((state) => (eventId ? selectors.imagesAll(state, eventId) : EMPTY_ARRAY));
}

export function useImageById(eventId, imageId) {
  return useDataStore((state) => (eventId && imageId ? state.entities?.[eventId]?.images?.[imageId] || null : null));
}

export function useAlbumsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.albumsAll(state, eventId) : EMPTY_ARRAY));
}

export function useAlbumById(eventId, albumId) {
  return useDataStore((state) => (eventId && albumId ? state.entities?.[eventId]?.albums?.[albumId] || null : null));
}

export function useMomentsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.momentsAll(state, eventId) : EMPTY_ARRAY));
}

export function useMomentById(eventId, momentId) {
  return useDataStore((state) => (eventId && momentId ? state.entities?.[eventId]?.moments?.[momentId] || null : null));
}

export function useFacesList(eventId) {
  return useDataStore((state) => (eventId ? selectors.facesAll(state, eventId) : EMPTY_ARRAY));
}

export function useFaceById(eventId, faceId) {
  return useDataStore((state) => (eventId && faceId ? state.entities?.[eventId]?.faces?.[faceId] || null : null));
}

export function useEventProfilesList(eventId) {
  return useDataStore((state) => (eventId ? selectors.eventProfilesAll(state, eventId) : EMPTY_ARRAY));
}

export function useEventProfileById(eventId, profileId) {
  return useDataStore((state) => (eventId && profileId ? state.entities?.[eventId]?.event_profiles?.[profileId] || null : null));
}

export function useUploadsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.uploadsAll(state, eventId) : EMPTY_ARRAY));
}

export function useUploadById(eventId, uploadId) {
  return useDataStore((state) => (eventId && uploadId ? state.entities?.[eventId]?.uploads?.[uploadId] || null : null));
}

export function useRequestsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.accessRequestsAll(state, eventId) : EMPTY_ARRAY));
}

export function useRequestById(eventId, requestId) {
  return useDataStore((state) => (eventId && requestId ? state.entities?.[eventId]?.access_requests?.[requestId] || null : null));
}

export function useMyRequestsList(eventId) {
  return useDataStore((state) => (eventId ? selectors.myAccessRequestsAll(state, eventId) : EMPTY_ARRAY));
}

export function useMyRequestById(eventId, requestId) {
  return useDataStore((state) => (eventId && requestId ? state.entities?.[eventId]?.my_access_requests?.[requestId] || null : null));
}

// General hooks (no eventId needed)
export function useProfilesList() {
  return useDataStore((state) => selectors.profilesAll(state));
}

export function useProfileById(profileId) {
  return useDataStore((state) => (profileId ? state.entities?.general?.profiles?.[profileId] || null : null));
}

export function useEventsGeneralList() {
  return useDataStore((state) => selectors.eventsAll(state));
}

export function useEventGeneralById(eventId) {
  return useDataStore((state) => (eventId ? state.entities?.general?.events?.[eventId] || null : null));
}

export function useMyNotificationsList() {
  return useDataStore((state) => selectors.myNotificationsAll(state));
}

export function useMyNotificationById(notificationId) {
  return useDataStore((state) => (notificationId ? state.entities?.general?.my_notifications?.[notificationId] || null : null));
}

export function useFeedbacksList() {
  return useDataStore((state) => selectors.feedbacksAll(state));
}

export function useFeedbackById(feedbackId) {
  return useDataStore((state) => (feedbackId ? state.entities?.general?.feedbacks?.[feedbackId] || null : null));
}

export function useMyFeedbacksList() {
  return useDataStore((state) => selectors.myFeedbacksAll(state));
}

export function useMyFeedbackById(feedbackId) {
  return useDataStore((state) => (feedbackId ? state.entities?.general?.my_feedbacks?.[feedbackId] || null : null));
}

 


