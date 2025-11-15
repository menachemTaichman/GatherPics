import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useImageSelection
 * Reusable selection manager with optional persistence.
 *
 * @param {Object} options
 * @param {Array} options.items - Items to select from (array of objects or ids)
 * @param {(item:any)=>string} options.getKey - Function that returns unique string key per item
 * @param {string} options.storageKey - LocalStorage key for persistence
 * @param {boolean} [options.persist=true] - Whether to persist selection
 * @param {boolean} [options.enableRange=true] - Whether to support shift+range selection
 */
export function useImageSelection({
  items,
  getKey,
  storageKey,
  persist = true,
  enableRange = true
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const lastSelectedKeyRef = useRef(null);

  // Load persisted selection on mount
  useEffect(() => {
    if (!persist || !storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setSelectedKeys(new Set(arr));
      }
    } catch {}
  }, [persist, storageKey]);

  // Persist on change
  useEffect(() => {
    if (!persist || !storageKey) return;
    try {
      if (selectedKeys.size === 0) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(selectedKeys)));
      }
    } catch {}
  }, [persist, storageKey, selectedKeys]);

  const keys = useMemo(() => (Array.isArray(items) ? items.map(getKey).filter(Boolean) : []), [items, getKey]);

  // Sanitize selection: remove keys that no longer exist in current items
  useEffect(() => {
    if (keys.length === 0 && selectedKeys.size > 0) {
      // If no valid keys, clear selection
      setSelectedKeys(new Set());
      lastSelectedKeyRef.current = null;
      return;
    }
    
    // Check if any selected keys are invalid
    const validKeysSet = new Set(keys);
    let hasInvalidKeys = false;
    for (const key of selectedKeys) {
      if (!validKeysSet.has(key)) {
        hasInvalidKeys = true;
        break;
      }
    }
    
    if (hasInvalidKeys) {
      // Compute sanitized keys first
      const sanitizedKeys = new Set();
      for (const key of selectedKeys) {
        if (validKeysSet.has(key)) {
          sanitizedKeys.add(key);
        }
      }
      
      setSelectedKeys(sanitizedKeys);
      
      // Clear lastSelectedKeyRef if it's invalid
      if (lastSelectedKeyRef.current && !validKeysSet.has(lastSelectedKeyRef.current)) {
        lastSelectedKeyRef.current = sanitizedKeys.size > 0 ? Array.from(sanitizedKeys)[sanitizedKeys.size - 1] : null;
      }
    }
  }, [keys, selectedKeys]);

  const toggleKey = useCallback((key, event) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (enableRange && event?.shiftKey && lastSelectedKeyRef.current && lastSelectedKeyRef.current !== key) {
        const lastIndex = keys.indexOf(lastSelectedKeyRef.current);
        const curIndex = keys.indexOf(key);
        if (lastIndex !== -1 && curIndex !== -1) {
          const start = Math.min(lastIndex, curIndex);
          const end = Math.max(lastIndex, curIndex);
          for (let i = start; i <= end; i++) next.add(keys[i]);
          lastSelectedKeyRef.current = key;
          return next;
        }
      }
      if (next.has(key)) next.delete(key); else next.add(key);
      lastSelectedKeyRef.current = key;
      return next;
    });
  }, [keys, enableRange]);

  const clear = useCallback(() => {
    setSelectedKeys(new Set());
    lastSelectedKeyRef.current = null;
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(keys));
    lastSelectedKeyRef.current = keys.length > 0 ? keys[keys.length - 1] : null;
  }, [keys]);

  const selectMany = useCallback((keysToAdd) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      keysToAdd.forEach(k => next.add(k));
      return next;
    });
  }, []);

  const deselectMany = useCallback((keysToRemove) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      keysToRemove.forEach(k => next.delete(k));
      return next;
    });
  }, []);

  const isAllSelected = keys.length > 0 && keys.every(k => selectedKeys.has(k));

  return {
    selectionMode,
    setSelectionMode,
    selectedKeys,
    setSelectedKeys,
    toggleKey,
    clear,
    selectAll,
    selectMany,
    deselectMany,
    isAllSelected,
    allKeys: keys
  };
}

export default useImageSelection;





