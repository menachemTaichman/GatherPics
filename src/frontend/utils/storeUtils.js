// Store utils: read the guide at docs/STORE_USAGE.md for patterns and examples.
import { useMemo, useEffect, useRef, useState } from 'react';
import { useDataStore, STORAGE_KEYS } from './dataManager';
import { sortImages, sortGroups, sortByField, filterImages } from './sorting';
import { resolveEventId } from './eventResolver';

// debug logs removed

// ========================================
// EVENT RESOLUTION
// ========================================

// Hook to resolve eventUrl to eventId (with caching)
// Uses a ref to avoid infinite loops from state updates
export function useEventId(eventUrl) {
  const [eventId, setEventId] = useState(null);
  const lastUrl = useRef(null);
  const lastEventId = useRef(null);
  
  useEffect(() => {
    if (!eventUrl) {
      if (eventId !== null) setEventId(null);
      lastUrl.current = null;
      lastEventId.current = null;
      return;
    }
    
    // If URL hasn't changed and we have the eventId, skip
    if (lastUrl.current === eventUrl && lastEventId.current) {
      if (eventId !== lastEventId.current) {
        setEventId(lastEventId.current);
      }
      return;
    }
    
    lastUrl.current = eventUrl;
    
    // Resolve immediately (async)
    (async () => {
      try {
        const id = await resolveEventId(eventUrl);
        
        // Only set if URL is still current
        if (lastUrl.current === eventUrl) {
          lastEventId.current = id;
          setEventId(id);
        }
      } catch (err) {
        console.error('[useEventId] Resolution failed:', err);
      }
    })();
  }, [eventUrl]);
  
  return eventId;
}

// ========================================
// UNIVERSAL ENTITY ACCESS (mirrors backend API)
// ========================================

// Imperative getters (use outside React components)
export function getEntity(eventId, entityType, entityId) {
  const state = useDataStore.getState();
  return state.entities?.[eventId]?.[entityType]?.[entityId] || null;
}

export function getEntities(eventId, entityType, entityIds) {
  const state = useDataStore.getState();
  const entitiesMap = state.entities?.[eventId]?.[entityType] || {};
  if (entityIds) {
    const result = {};
    entityIds.forEach(id => {
      if (entitiesMap[id]) result[id] = entitiesMap[id];
    });
    return result;
  }
  return entitiesMap;
}

export function getEntityList(eventId, entityType) {
  const entitiesMap = getEntities(eventId, entityType);
  return Object.values(entitiesMap);
}

export function getChilds(eventId, parent, parentId, child, childIds) {
  const state = useDataStore.getState();
  const parentEntity = state.entities?.[eventId]?.[parent]?.[parentId];
  if (!parentEntity) return [];
  
  const childSet = parentEntity[child];
  if (!childSet) return [];
  
  let ids = childSet instanceof Set ? Array.from(childSet) : 
            Array.isArray(childSet) ? childSet : [];
  
  if (childIds) {
    const filterSet = new Set(childIds.map(String));
    ids = ids.filter(id => filterSet.has(String(id)));
  }
  
  const childEntities = state.entities?.[eventId]?.[child] || {};
  return ids.map(id => childEntities[id]).filter(Boolean);
}

export function getParents(eventId, child, childId, parent) {
  // This would require scanning all parent entities - can be implemented if needed
  // For now, return empty array
  return [];
}

// Reactive hooks (use in React components)
export function useEntity(eventId, entityType, entityId) {
  return useDataStore((state) => 
    (entityId ? state.entities?.[eventId]?.[entityType]?.[entityId] || null : null)
  );
}

export function useEntities(eventId, entityType, entityIds) {
  return useDataStore((state) => {
    const entitiesMap = state.entities?.[eventId]?.[entityType] || null;
    if (entityIds && entitiesMap) {
      // For filtered queries, we need to create a new object, but we memoize below
      const result = {};
      entityIds.forEach(id => {
        if (entitiesMap[id]) result[id] = entitiesMap[id];
      });
      return result;
    }
    return entitiesMap;
  });
}

export function useEntityList(eventId, entityType) {
  const entitiesMap = useEntities(eventId, entityType);
  return useMemo(() => entitiesMap ? Object.values(entitiesMap) : [], [entitiesMap]);
}

export function useChilds(eventId, parent, parentId, child, options = {}) {
  const parentRelationSet = useDataStore((state) => {
    if (!eventId || !parent || !parentId) return null;
    return state.entities?.[eventId]?.[parent]?.[parentId]?.[child] || null;
  });

  const childMapSub = useDataStore((state) => state.entities?.[eventId]?.[child] || null);

  return useMemo(() => {
    if (!parentRelationSet) return [];
    
    let ids = parentRelationSet instanceof Set ? Array.from(parentRelationSet) : 
              Array.isArray(parentRelationSet) ? parentRelationSet : [];
    
    // Apply child filtering if specified
    if (options.childIds) {
      const filterSet = new Set(options.childIds.map(String));
      ids = ids.filter(id => filterSet.has(String(id)));
    }
    
    // Get child entities
    const childEntities = useDataStore.getState().entities?.[eventId]?.[child] || {};
    let list = ids.map(id => childEntities[id]).filter(Boolean);
    
    // Apply additional filters for images
    if (child === 'images') {
      if (!options.includeArchived) {
        list = list.filter(img => !img.is_archived);
      }
      if (options.filterByUploadId !== null && options.filterByUploadId !== undefined) {
        list = list.filter(img => String(img.upload_id) === String(options.filterByUploadId));
      }
      if (options.filteredIds && parent === 'groups') {
        // Use filteredIds instead of relation set for groups
        const filterSet = new Set(options.filteredIds.map(String));
        list = list.filter(img => filterSet.has(String(img.id)));
      }
    }
    
    // Apply sorting
    if (child === 'images' && options.sortBy) {
      list = sortImages(list, options.sortBy, options.sortOrder || 'asc');
    } else if ((child === 'groups' || child === 'albums') && options.sortBy) {
      list = sortGroups(list, options.sortBy, options.sortOrder || 'asc');
    } else if (child === 'moments' && options.sortBy) {
      list = sortByField(list, options.sortBy, options.sortOrder || 'asc');
    } else if (child === 'faces') {
      // Sort faces by group label
      const groupsMap = useDataStore.getState().entities?.[eventId]?.groups || {};
      list = sortByField(list, 'group_label', 'asc', (face) => {
        const gid = face?.groupId || face?.group_id;
        if (!gid) return '';
        return groupsMap[gid]?.label || '';
      });
    }
    
    return list;
  }, [eventId, parent, parentId, child, parentRelationSet, childMapSub, 
      options.childIds?.join(','), options.includeArchived, options.filterByUploadId, 
      options.sortBy, options.sortOrder, options.filteredIds?.join(',')]);
}

// Apply and cleanup scopes against the data store
export function useApplyScopes(scopes = []) {
  const prevKeysRef = useRef(new Set());

  // Normalize scopes and build a stable signature
  const { keysSet: nextKeys, signature, normalized } = useMemo(() => {
    const normalized = Array.isArray(scopes)
      ? scopes
          .filter((s) => s && s.entity && s.id !== undefined && s.id !== null)
          .map((s) => ({ entity: s.entity, id: String(s.id), eventId: s.eventId || 'general' }))
      : [];
    const keyList = Array.from(
      new Set(normalized.map((s) => `${s.eventId}:${s.entity}:${s.id}`))
    ).sort();
    
    return {
      keysSet: new Set(keyList),
      signature: keyList.join('|'),
      normalized,
    };
  }, [scopes]);

  // Apply only the diffs between previous and next scope keys
  useEffect(() => {
    try {
      const ds = useDataStore.getState();
      const prevKeys = prevKeysRef.current;

      // Compute removals (in prev but not in next)
      const toRemove = [];
      prevKeys.forEach((k) => {
        if (!nextKeys.has(k)) toRemove.push(k);
      });

      // Compute additions (in next but not in prev)
      const toAdd = [];
      nextKeys.forEach((k) => {
        if (!prevKeys.has(k)) toAdd.push(k);
      });

      // Apply removals first
      for (const key of toRemove) {
        const [eventId, entity, id] = key.split(':');
        ds.removeScope && ds.removeScope({ entity, id, eventId });
        prevKeys.delete(key);
      }

      // Apply additions
      for (const key of toAdd) {
        const [eventId, entity, id] = key.split(':');
        ds.addScope && ds.addScope({ entity, id, eventId });
        prevKeys.add(key);
      }

      // logging removed
    } catch {}
  }, [signature]);

  // Cleanup on unmount: remove what we still hold
  useEffect(() => {
    return () => {
      try {
        const ds = useDataStore.getState();
        prevKeysRef.current.forEach((key) => {
          const [eventId, entity, id] = key.split(':');
          ds.removeScope && ds.removeScope({ entity, id, eventId });
        });
        prevKeysRef.current.clear();
      } catch {}
    };
  }, []);
}



// Representative URL helper with debug
export function getRepresentativeUrl(urlHelpers, entity, id) {
  const url = urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl(entity, id) : null;
  return url;
}

// Stable pending requests count from frw_currentProfile for a specific event
export function usePendingRequestsCount(eventId) {
  const readCount = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE);
      if (stored) {
        const profile = JSON.parse(stored);
        const eventData = profile.events?.[eventId];
        return Number(eventData?.pending_access_requests_count || 0);
      }
    } catch {}
    return 0;
  };

  const [pendingCount, setPendingCount] = useState(() => readCount());

  useEffect(() => {
    const updateCount = () => {
      const count = readCount();
      setPendingCount((prev) => prev !== count ? count : prev);
    };

    // Listen for storage events (cross-tab)
    const handleStorageChange = (e) => {
      if (e.key === STORAGE_KEYS.CURRENT_PROFILE) {
        updateCount();
      }
    };

    // Listen for custom events (same-tab updates via apiService)
    const handleCustomEvent = () => {
      updateCount();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorage:currentProfile', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorage:currentProfile', handleCustomEvent);
    };
  }, [eventId]);

  return pendingCount;
}





