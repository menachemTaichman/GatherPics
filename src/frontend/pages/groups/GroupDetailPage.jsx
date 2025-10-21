import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, 
  ArrowUp,
  ArrowDown,
  Filter, 
  Check, 
  X, 
  AlertTriangle,
  User,
  Image as ImageIcon,
  Plus,
  Minus,
  Square,
  CheckSquare,
  Trash2,
  Key,
} from 'lucide-react';
import { ImageViewer } from '../../components/images';
import { useToast } from '../../contexts/ToastContext';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { MergeConflictModal, TransferFacesModal } from '../../components/groups';
import { ManageAccessModal } from '../../components/profiles';
import { FloatingSelectionControls } from '../../components/layout';
import { sortImages, toggleSortOrder } from '../../utils/sorting';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import { PermissionGate } from '../../components/common';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';

// Simple sessionStorage hook for filtered results only
const useSessionStorage = (key, defaultValue) => {
  const [value, setValue] = useState(() => {
    try {
      const item = sessionStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setStoredValue = (newValue) => {
    try {
      setValue(newValue);
      sessionStorage.setItem(key, JSON.stringify(newValue));
    } catch {
      setValue(newValue);
    }
  };

  return [value, setStoredValue];
};
import useImageSelection from '../../hooks/useImageSelection';
import { useGroupNameConflict } from '../../hooks/useGroupNameConflict';
import { useDataStore, selectors } from '../../utils/dataManager';
import { selectors as storeSelectors, useGroupsList, useGroupById } from '../../utils/dataManager';
import { useApplyScopes, useImagesForParent } from '../../utils/storeUtils';
import { groupsAPI, handleAPIError, optimisticUpdates, API_BASE, albumsAPI } from '../../utils/apiService';
import useImageActions from '../../components/images/ImageActions';
import { clearTransferredImagesFromCache } from '../../utils/selection';
import timelineManager from '../../utils/timeline';
import useBucketStore from '../../utils/bucketStore';
import { SingleImageTile } from '../../components/images';
import { GroupsFilter } from '../../components/groups';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useImageHighlight } from '../../hooks/useImageHighlight';

const EMPTY_ARRAY = Object.freeze([]);

export default function GroupDetail({ groups, onDeleteGroup, onRefreshGroups, urlHelpers: injectedUrlHelpers }) {
  // Render counter to spot potential render loops
  const __renderCountRef = useRef(0);
  __renderCountRef.current += 1;
  
  const __lastUrlRef = useRef('');
  const __initialRestorationComplete = useRef(false);
  const { group_name, eventUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Use injected urlHelpers from App to avoid creating duplicate instances on refresh
  const urlHelpers = injectedUrlHelpers;
  const { showToast } = useToast();
  const [group, setGroup] = useState(null);
  const permissions = usePermissions();
  const { isAuthenticated } = useAuth();
  
  // Use the hook at component level to avoid conditional hook calls
  const groupRepresentativeComponent = useImageComponent(
    group && urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}` : null,
    {
      width: 64,
      height: 64,
      className: 'w-full h-full object-cover',
      alt: group?.label || `Person ${group?.id}`,
      key: group?.id || 'no-representative',
      iconType: 'person'
    }
  );
  useEffect(() => {
    
  }, [urlHelpers, group?.id]);
  const [searchTerm, setSearchTerm] = useState('');
  // Derived list; avoid state to prevent effect loops
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // (moved below after sortedImages is defined)
  
  const sortOrder = usePreference('GroupDetail.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupDetail.sortDir', value);
  // ImageViewer controller is initialized after filteredIds declaration to avoid TDZ issues
  const [loading, setLoading] = useState(false);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [showCrops, setShowCrops] = useState(false);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedFacesForTransfer, setSelectedFacesForTransfer] = useState([]);
  const { addImages, open } = useBucketStore();
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);
  const pendingClassUpdatesRef = useRef({});
  const flushClassesRafRef = useRef(null);

  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [albums, setAlbums] = useState([]);
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  
  // Filter states
  const [filterVisible, setFilterVisible] = useState(false);
  const [relatedGroups, setRelatedGroups] = useState([]);
  // Filter settings are temporary (not stored) - they reset when component unmounts
  const [filterGroups, setFilterGroups] = useState([]);
  const [filterMode, setFilterMode] = useState('and');
  const [onlySelected, setOnlySelected] = useState(false);
  
  // Wrapped callback for when related groups are updated
  const handleRelatedGroupsUpdate = useCallback((groups) => {
    setRelatedGroups(groups);
  }, []);
  
  // Wrapped callback for when filter groups are changed
  const handleFilterGroupsChange = useCallback((groups) => {
    setFilterGroups(groups);
  }, []);
  
  // Store the filtered results (the actual IDs to use instead of relations)
  const [filteredImageIds, setFilteredImageIds] = useSessionStorage('groupDetail_filteredImageIds', null);
  const [filteredFaceIds, setFilteredFaceIds] = useSessionStorage('groupDetail_filteredFaceIds', null);
  
  // Initialize ImageViewer controller after filteredImageIds is defined
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast,
    onTransferComplete: (result) => handleTransferComplete(result),
    onJumpToMoment: null, // Let ImageViewer handle navigation with proper eventUrl
    defaultSortBy: 'date',
    defaultSortOrder: sortOrder,
    urlHelpers,
    filteredIds: filteredImageIds,
  });
  const lastFetchSignatureRef = useRef('');
  const prevGroupIdRef = useRef(null);
  const suppressSpinnerRef = useRef(false);
  const restoreScrollYRef = useRef(null);
  const smoothNextGroupLoad = useRef(false);
  
  // Image highlight hook for navigation
  const { isHighlighted, registerImageRef } = useImageHighlight();
  const skipNextAnimation = useRef(false);

  // Subscribe to normalized groups list
  const currentGroups = useGroupsList();
  const attemptedLookupRef = useRef(false);
  const isRenamingRef = useRef(false);
  const decodedGroupName = useMemo(() => {
    try { return decodeURIComponent(group_name || ''); } catch { return group_name || ''; }
  }, [group_name]);

  useEffect(() => {
    
  }, [eventUrl, group_name, decodedGroupName]);

  // Initialize filter state from URL on first load - only run once
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const mode = searchParams.get('filterMode');
    const only = searchParams.get('only');
    const groupNames = searchParams.get('filterGroups');

    if (mode) {
      setFilterMode(mode);
    }
    
    if (only) {
      setOnlySelected(only === 'true');
    }

    // Store group names for later restoration when currentGroups are loaded
    if (groupNames) {
      const groupNamesArray = groupNames.split(',');
      window.__pendingFilterGroups = groupNamesArray;
    }
    
    // Open filter panel if there are any filter params in URL
    if (groupNames || only || mode) {
      window.__shouldOpenFilterPanel = true;
    } else {
      // No filter params in URL, mark restoration as complete immediately
      __initialRestorationComplete.current = true;
    }
  }, []); // Empty dependency array - only run once on mount

  // Subscribe to store groups count (stable value) to trigger restoration
  const groupsCount = useDataStore(state => Object.keys(state.entities?.groups || {}).length);
  
  // Fetch groups from URL using check-name endpoint
  useEffect(() => {
    if (window.__pendingFilterGroups && !window.__fetchingGroupsForRestore) {
      const groupNames = window.__pendingFilterGroups;
      window.__fetchingGroupsForRestore = true;
      
      // Check each group name - the check-name endpoint returns INSERT changes
      Promise.all(
        groupNames.map(name => groupsAPI.checkName(name, '', eventUrl))
      ).then(results => {
        // Apply changes from all results (check-name returns INSERT type which ignores scopes)
        const store = useDataStore.getState();
        results.forEach(result => {
          if (result.changes) {
            store.applyChanges(result.changes, { broadcast: false });
          }
        });
        
        delete window.__fetchingGroupsForRestore;
      }).catch(err => {
        console.error('[GroupDetail] Failed to check group names:', err);
        delete window.__fetchingGroupsForRestore;
      });
    }
  }, []); // Run once on mount
  
  // Open filter panel early if filter params in URL
  useEffect(() => {
    if (window.__shouldOpenFilterPanel) {
      setFilterVisible(true);
      delete window.__shouldOpenFilterPanel;
    }
  }, []); // Run once on mount
  
  // Manage all:groups scope based on filter panel visibility
  useEffect(() => {
    if (filterVisible) {
      // Add scope when filter panel opens
      try {
        useApplyScopes([{ entity: 'all', id: 'groups' }]);
      } catch (e) {}
    } else {
      // Remove scope when filter panel closes
      const store = useDataStore.getState();
      try {
        store.removeScope({ entity: 'all', id: 'groups' });
      } catch (e) {}
    }
  }, [filterVisible]);
  
  useEffect(() => {
    // Don't wait for perfect conditions - attempt restoration with whatever we have
    if (!window.__pendingFilterGroups) {
      // Nothing to restore, mark complete
      if (!__initialRestorationComplete.current) {
        __initialRestorationComplete.current = true;
      }
      return;
    }
    
    // Handle filter groups restoration
    if (window.__pendingFilterGroups && groupsCount > 0) {
      // If only 1 group in store, wait for our specific fetch to complete
      if (groupsCount === 1 && window.__fetchingGroupsForRestore) {
        return;
      }
      
      // Access store directly to get all groups (unscoped)
      const allGroupsFromStore = Object.values(useDataStore.getState().entities?.groups || {});
      
      const groupNames = window.__pendingFilterGroups;
      const groupIds = groupNames
        .map(name => allGroupsFromStore.find(g => g.label === name)?.id)
        .filter(Boolean); // Filter out any undefineds if a group isn't found
      
      // Set filter groups with whatever we found
      setFilterGroups(groupIds);
      
      // Always clear the pending groups after attempting restoration
      delete window.__pendingFilterGroups;
    }
    
    // Mark restoration as complete after processing
    if (!window.__pendingFilterGroups && !__initialRestorationComplete.current) {
      __initialRestorationComplete.current = true;
    }
  }, [groupsCount]); // Depend on groups count (stable number), not the array

  // Update URL when filter state changes
  useEffect(() => {
    // Skip URL updates until initial restoration is complete
    if (!__initialRestorationComplete.current) {
      return;
    }
    const depSig = {
      filterGroups: Array.isArray(filterGroups) ? `[${filterGroups.join(',')}]` : 'null',
      filterMode,
      onlySelected,
      relatedGroupsLen: relatedGroups.length,
      currentGroupsLen: (currentGroups || []).length,
      path: location.pathname,
      groupLabel: group?.label,
    };
    // Diff against previous deps
    const prevRef = GroupDetail.__prevDepsRef || (GroupDetail.__prevDepsRef = { current: null });
    const prev = prevRef.current;
    if (prev) {
      const changedKeys = Object.keys(depSig).filter(k => depSig[k] !== prev[k]);
      if (changedKeys.length > 0) {
        const diff = {};
        changedKeys.forEach(k => { diff[k] = { from: prev[k], to: depSig[k] }; });
        
      } else {
        
      }
    }
    prevRef.current = depSig;
    
    const searchParams = new URLSearchParams(location.search);
    
    // Update filter mode
    if (filterMode !== 'and') {
      searchParams.set('filterMode', filterMode);
    } else {
      searchParams.delete('filterMode');
    }
    
    // Update filter groups - always update URL when filterGroups changes, regardless of relatedGroups
    if (filterGroups.length > 0) {
      // If we have relatedGroups loaded, use them to get group names
      if (relatedGroups.length > 0) {
        const groupNames = filterGroups
          .map(id => relatedGroups.find(g => g.id === id)?.label)
          .filter(Boolean)
          .join(',');
        if (groupNames) {
          searchParams.set('filterGroups', groupNames);
        }
      } else {
        // If relatedGroups aren't loaded yet, try to get names from currentGroups as fallback
        const groupNames = filterGroups
          .map(id => currentGroups.find(g => g.id === id)?.label)
          .filter(Boolean)
          .filter(name => name !== group?.label) // Exclude the main group
          .join(',');
        if (groupNames) {
          searchParams.set('filterGroups', groupNames);
        }
      }
    } else {
      // Always clear filterGroups from URL when empty
      searchParams.delete('filterGroups');
    }
    
    // Update only selected
    if (onlySelected) {
      searchParams.set('only', 'true');
    } else {
      searchParams.delete('only');
    }
    
    // Update URL without triggering navigation
    const newUrl = `${location.pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    const same = __lastUrlRef.current === newUrl;
    if (same) {
      return;
    }
    window.history.replaceState(null, '', newUrl);
    __lastUrlRef.current = newUrl;
    
  }, [filterGroups, filterMode, onlySelected, relatedGroups, location.pathname, currentGroups, group?.label]);

  // Memoize props for GroupsFilter to prevent infinite re-renders (defined after sortedImages below)
  const memoizedRelatedGroups = useMemo(() => relatedGroups.filter(g => g.id !== group?.id), [relatedGroups, group?.id]);

  // Use the custom hook for conflict handling
  const {
    nameConflict,
    showMergeModal,
    conflictData,
    checkNameConflict,
    handleMergeGroups,
    handleMergeCancel,
    showMergeConflictModal,
    clearConflict,
    setShowMergeModal
  } = useGroupNameConflict(group, onRefreshGroups, eventUrl);


  // Derive images using the universal util; keep scopes in sync
  const includeArchived = usePreference('general.includeArchived', false);
  useApplyScopes(group?.id ? [{ entity: 'group', id: String(group.id) }] : []);
  const relatedImages = useImagesForParent({ entity: 'group', parentId: group?.id, filteredIds: filteredImageIds, includeArchived, sortBy: 'date', sortOrder });

  // Get faces from store
  const entities = useDataStore((state) => state.entities);
  const groupFaces = useMemo(() => {
    if (!showCrops || !group?.id) return [];
    
    const facesMap = entities?.faces || {};
    
    // If we have filtered face IDs, use those instead of the group's faces set
    if (filteredFaceIds && Array.isArray(filteredFaceIds)) {
      return filteredFaceIds
        .map(faceId => facesMap[faceId])
        .filter(Boolean);
    }
    
    // Otherwise use all faces from the group
    const facesSet = entities?.groups?.[group.id]?.faces;
    if (!facesSet || !(facesSet instanceof Set)) return [];
    
    return Array.from(facesSet)
      .map(faceId => facesMap[faceId])
      .filter(Boolean);
  }, [showCrops, group?.id, entities, filteredFaceIds]);

  // Create placeholder images for unauthenticated state
  const placeholderImages = useMemo(() => {
    if (!group?.isPlaceholder) return EMPTY_ARRAY;
    return Array.from({ length: 24 }, (_, i) => ({
      id: `placeholder-${i}`,
      label: '',
      isPlaceholder: true
    }));
  }, [group?.isPlaceholder]);

  const sortedImages = useMemo(() => {
    if (!group?.id) return EMPTY_ARRAY;
    // Use placeholders if group is a placeholder
    if (group.isPlaceholder) return placeholderImages;
    
    // If showCrops, return faces sorted by their image's date_taken
    if (showCrops) {
      const sorted = [...groupFaces].sort((a, b) => {
        const imgA = entities?.images?.[a.image_id];
        const imgB = entities?.images?.[b.image_id];
        const dateA = imgA?.date_taken || '';
        const dateB = imgB?.date_taken || '';
        return sortOrder === 'asc' 
          ? dateA.localeCompare(dateB)
          : dateB.localeCompare(dateA);
      });
      return sorted;
    }
    
    const out = sortImages(relatedImages, 'date', sortOrder);
    
    return out;
  }, [group?.id, group?.isPlaceholder, relatedImages, sortOrder, placeholderImages, showCrops, groupFaces, entities, sortOrder]);

  useEffect(() => {
    
  }, [sortedImages]);

  // Now compute memoizedImageIds after sortedImages exists
  const memoizedImageIds = useMemo(() => {
    if (showCrops) {
      // In faces mode, map to image IDs from faces
      return sortedImages.map(face => face.image_id);
    }
    return sortedImages.map(img => img.id);
  }, [sortedImages, showCrops]);

  // Separate selection states for images mode and faces mode
  const {
    selectedKeys: selectedImagesInImagesMode,
    toggleKey: toggleSelectedInImagesMode,
    clear: clearImagesSelection,
    selectAll: selectAllInImagesMode,
    deselectMany: deselectManyImagesMode,
  } = useImageSelection({
    items: sortedImages,
    getKey: (item) => item?.id,
    enableRange: true,
  });

  const {
    selectedKeys: selectedImagesInFacesMode,
    toggleKey: toggleSelectedInFacesMode,
    clear: clearFacesSelection,
    selectAll: selectAllInFacesMode,
    deselectMany: deselectManyFacesMode,
  } = useImageSelection({
    items: sortedImages,
    getKey: (item) => item?.id,
    enableRange: true,
  });

  // Use the appropriate selection based on current mode
  const selectedImages = showCrops ? selectedImagesInFacesMode : selectedImagesInImagesMode;
  const toggleSelectedImageKey = showCrops ? toggleSelectedInFacesMode : toggleSelectedInImagesMode;
  const clearSelection = showCrops ? clearFacesSelection : clearImagesSelection;
  const selectAllImages = showCrops ? selectAllInFacesMode : selectAllInImagesMode;
  const deselectMany = showCrops ? deselectManyFacesMode : deselectManyImagesMode;

  useEffect(() => {
    if (!eventUrl || !decodedGroupName) return;
    
    // Skip lookup if we're in the middle of a rename
    if (isRenamingRef.current) {
      isRenamingRef.current = false; // Reset the flag
      return;
    }
    
    // If not authenticated, immediately set placeholder and skip all logic
    if (!isAuthenticated) {
      setGroup({
        id: 'placeholder',
        label: decodedGroupName,
        images: new Set(),
        isPlaceholder: true
      });
      return;
    }
    
    const resolveByLabel = async () => {
      try {
        const res = await groupsAPI.checkName(decodedGroupName, '', eventUrl);
        if (res && res.conflict) {
          // Changes are applied by interceptor; pick from store
          const after = storeSelectors.groupsAll(useDataStore.getState()) || [];
          const match = after.find(g => g.id === res.conflicting_group || g.label === decodedGroupName);
          if (match) {
            
            setGroup(match);
            return;
          }
        }
      } catch {}
      // Not found -> redirect back to people list
      navigate(`/${eventUrl}/people`);
    };

    const foundGroup = (currentGroups || []).find(g => g.label === decodedGroupName);
    if (foundGroup) {
      if (!group || group.id !== foundGroup.id || group !== foundGroup) {
        
        setGroup(foundGroup);
      }
      return;
    }
    if (!attemptedLookupRef.current) {
      attemptedLookupRef.current = true;
      resolveByLabel();
    }
    
    // Refetch data after login
    const handleAuthLogin = () => {
      attemptedLookupRef.current = false; // Reset to allow refetch
      resolveByLabel();
    };
    
    // Reset to placeholder on logout
    const handleAuthLogout = () => {
      setGroup({
        id: 'placeholder',
        label: decodedGroupName,
        images: new Set(),
        isPlaceholder: true
      });
    };
    
    window.addEventListener('auth:login', handleAuthLogin);
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => {
      window.removeEventListener('auth:login', handleAuthLogin);
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [decodedGroupName, currentGroups, navigate, eventUrl, isAuthenticated]);

  // Keep local `group` in sync by id when the store object changes (e.g., rename)
  useEffect(() => {
    if (!group?.id) return;
    const byId = (currentGroups || []).find(g => g.id === group.id);
    if (byId && byId !== group) {
      
      setGroup(byId);
    }
  }, [currentGroups, group?.id]);

  // Legacy subscription removed; updates flow from normalized selectors

  useLayoutEffect(() => {
    // This layout effect is for scroll restoration only, running before browser paint
    if (smoothNextGroupLoad.current) {
      if (restoreScrollYRef.current !== null) {
        const y = restoreScrollYRef.current;
        window.scrollTo({ top: y, behavior: 'instant' });
        restoreScrollYRef.current = null;
      }
    }
  }, [group?.id]); // Fire when the group has actually changed

  const fetchGroupData = useCallback(async (currentOffset, resetImages = false) => {
    if (!group?.id || group.isPlaceholder) {
      return;
    }
    
    if (!suppressSpinnerRef.current) {
      setLoading(!isFetchingMore);
    }

    const params = { 
      offset: currentOffset, 
      limit: 50 
    };

    if (onlySelected || filterGroups.length > 0) {
      if (filterGroups.length > 0) {
        params.filter_groups = filterGroups.join(',');
      }
      params.filter_mode = filterMode;
      params.only_selected = onlySelected;
    }

    try {
      const payload = await groupsAPI.getById(group.id, eventUrl, params);
      
      // Handle filtered_image_ids and filtered_face_ids from API response
      // If filter is active, always use filtered IDs (even if empty array for 0 results)
      if (payload?.filter) {
        if (Array.isArray(payload?.filtered_image_ids)) {
          setFilteredImageIds(payload.filtered_image_ids);
        }
        if (Array.isArray(payload?.filtered_face_ids)) {
          setFilteredFaceIds(payload.filtered_face_ids);
        }
      } else {
        setFilteredImageIds(null);
        setFilteredFaceIds(null);
      }
      
      const pageCount = Array.isArray(payload?.images)
        ? payload.images.length
        : (Array.isArray(payload?.filtered_image_ids) ? payload.filtered_image_ids.length : 0);
      setHasMore(pageCount === 50);
      
    } catch (error) {
      console.error('Error fetching group details:', error);
    } finally {
      setLoading(false);
      setIsFetchingMore(false);
      if (restoreScrollYRef.current !== null) {
        const y = restoreScrollYRef.current;
        restoreScrollYRef.current = null;
        try {
          requestAnimationFrame(() => window.scrollTo(0, y));
        } catch {}
      }
    }
  }, [group?.id, eventUrl, filterGroups, filterMode, onlySelected, isFetchingMore]);

  // Centralized effect for fetching all image and group data
  useEffect(() => {
    // Skip for placeholder groups
    if (!group?.id || group.isPlaceholder) return;
    
    // Scope to the specific group for relation updates (both images and faces)
    if (group?.id) {
      try { 
        useDataStore.getState().setScope({ entity: 'group', id: String(group.id) });
      } catch {}
    }

    if (smoothNextGroupLoad.current) {
      smoothNextGroupLoad.current = false;
      // When smoothly navigating between groups, we rely on store data
      // and skip the API fetch. We just need to update refs.
      const sig = `${group.id}|${(filterGroups || []).join(',')}|${filterMode}|${onlySelected ? '1' : '0'}`;
      lastFetchSignatureRef.current = sig;
      prevGroupIdRef.current = group.id;
      
      // The scroll restoration is now handled in useLayoutEffect
      
      return;
    }

    const sig = `${group.id}|${(filterGroups || []).join(',')}|${filterMode}|${onlySelected ? '1' : '0'}`;
    if (sig === lastFetchSignatureRef.current) {
      
      return;
    }
    const isGroupChange = prevGroupIdRef.current !== group.id;
    prevGroupIdRef.current = group.id;
    
    // If this is a group change, clear filtered data
    if (isGroupChange) {
      setFilteredImageIds(null);
      setFilteredFaceIds(null);
      // Also clear from session storage when switching groups
      sessionStorage.removeItem('groupDetail_filteredImageIds');
      sessionStorage.removeItem('groupDetail_filteredFaceIds');
      sessionStorage.removeItem('groupDetail_filteredRelatedGroups');
    }
    
    // If this is only a filter change, do a silent fetch and preserve scroll
    if (!isGroupChange) {
      suppressSpinnerRef.current = true;
      try { restoreScrollYRef.current = window.scrollY; } catch {}
    } else {
      suppressSpinnerRef.current = false;
      // On a normal group change (not a merge), we want to scroll to top.
      // We don't need to explicitly nullify the ref, as it's only set when needed.
    }
    lastFetchSignatureRef.current = sig;
    
    setOffset(0);
    fetchGroupData(0, true);
  }, [group?.id, filterGroups, filterMode, onlySelected]); // Re-run whenever the main group or filters change

  // Related groups are fetched inside GroupsFilter; keep local state updated via callback


  const handleLoadMore = () => {
    if (!isFetchingMore && hasMore) {
      const nextOffset = offset + 50;
      
      setOffset(nextOffset);
      setIsFetchingMore(true);
      fetchGroupData(nextOffset);
    }
  };

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    
    setSortOrder(newOrder);
  };

  const handleFilterVisibilityToggle = () => {
    setFilterVisible(prev => {
      const next = !prev;
      
      return next;
    });
  };

  const arraysEqual = (a = [], b = []) => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  const handleFilterChange = useCallback((newFilterGroups) => {
    if (arraysEqual(filterGroups, newFilterGroups)) return;
    
    setFilterGroups(newFilterGroups);
  }, [filterGroups]);

  const handleFilterModeChange = useCallback((newMode) => {
    
    setFilterMode(newMode);
  }, [filterMode]);

  const handleOnlySelectedChange = useCallback((newOnlySelected) => {
    
    setOnlySelected(newOnlySelected);
  }, [onlySelected]);

  const handleFilterReset = useCallback(() => {
    
    setFilterGroups([]);
    setFilterMode('and');
    setOnlySelected(false);
    setFilteredImageIds(null);
    setFilteredFaceIds(null);
    // Clear all filter-related session storage items
    sessionStorage.removeItem('groupDetail_filteredRelatedGroups');
    sessionStorage.removeItem('groupDetail_filteredImageIds');
    sessionStorage.removeItem('groupDetail_filteredFaceIds');
    
    // Clear URL parameters
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('filterMode');
    searchParams.delete('filterGroups');
    searchParams.delete('only');
    const newUrl = `${location.pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, []);


  // Create ImageActions instance for selected images
  const selectedImageActions = useImageActions({
    imageIds: Array.from(selectedImages),
    eventUrl,
    urlHelpers,
    placeholderDataUrl: null, // Use universal placeholder components
    onImageUpdated: () => {}, // No need to update local state, store handles it
    onAlbumAdded: () => {} // No special handling needed
  });

  useEffect(() => {
    
  }, [selectedImages]);

  const handleImageLoad = (imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    
    // Skip if unchanged to avoid extra renders
    const current = imageClassesRef.current?.[imageId];
    if (current === imageClass) return;

    // Batch updates per frame to coalesce N image onLoad events
    pendingClassUpdatesRef.current[imageId] = imageClass;
    if (!flushClassesRafRef.current) {
      try {
        flushClassesRafRef.current = requestAnimationFrame(() => {
          const updates = pendingClassUpdatesRef.current;
          pendingClassUpdatesRef.current = {};
          flushClassesRafRef.current = null;
          setImageClasses(prev => {
            let changed = false;
            const next = { ...prev };
            for (const id in updates) {
              if (Object.prototype.hasOwnProperty.call(updates, id)) {
                if (prev[id] !== updates[id]) {
                  next[id] = updates[id];
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        });
      } catch {
        // Fallback without RAF
        setImageClasses(prev => {
          let changed = false;
          const next = { ...prev };
          for (const id in pendingClassUpdatesRef.current) {
            if (prev[id] !== pendingClassUpdatesRef.current[id]) {
              next[id] = pendingClassUpdatesRef.current[id];
              changed = true;
            }
          }
          pendingClassUpdatesRef.current = {};
          return changed ? next : prev;
        });
      }
    }
  };

  useEffect(() => {
    const size = imageClasses ? Object.keys(imageClasses).length : 0;
    
  }, [imageClasses]);



  const getSelectedFaces = async () => {
    const selectedFaces = [];
    
    if (showCrops) {
      // In faces mode, selectedImages contains face IDs
      for (const faceId of selectedImages) {
        const face = entities?.faces?.[faceId];
        if (!face) continue;
        selectedFaces.push({
          face_id: faceId,
          image_id: face.image_id,
          group_id: group.id,
          width: face.width || 0,
          height: face.height || 0,
          left: face.left || 0,
          top: face.top || 0,
          group_label: group.label
        });
      }
    } else {
      // In images mode, fetch ALL faces for all selected images in one API call
      const imageIds = Array.from(selectedImages);
      
      try {
        const response = await groupsAPI.getFacesInImages(group.id, imageIds, eventUrl);
        const faceIds = response?.faces || [];
        
        // Add all faces
        for (const faceId of faceIds) {
          const face = entities?.faces?.[faceId];
          if (!face) continue;
          selectedFaces.push({
            face_id: faceId,
            image_id: face.image_id,
            group_id: group.id,
            width: face?.width || 0,
            height: face?.height || 0,
            left: face?.left || 0,
            top: face?.top || 0,
            group_label: group.label
          });
        }
      } catch (error) {
        console.error('Failed to fetch faces for images:', error);
      }
    }
    return selectedFaces;
  };

  const handleTransferFaces = async () => {
    if (selectedImages.size === 0) {
      showToast('Please select photos to transfer', 'error');
      return;
    }
    
    // Fetch all faces for selected images
    const faces = await getSelectedFaces();
    setSelectedFacesForTransfer(faces);
    
    try {
      restoreScrollYRef.current = window.scrollY;
    } catch {}
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    const transferData = { ...(result || {}) };
    
    // Clear selection (UI state management)
    clearSelection();

    // Handle source_deleted case (merge) - navigate to target group
    // The modal already showed the toast, we just need to handle navigation
    if (transferData.source_deleted && transferData.target_group_id) {
      const targetGroup = currentGroups.find(g => g.id === transferData.target_group_id);
      
      if (targetGroup) {
        const link = `/${eventUrl}/people/${encodeURIComponent(targetGroup.label)}`;
        
        // Manually update URL without triggering router navigation, then set group
        window.history.replaceState(null, '', link);
        smoothNextGroupLoad.current = true;
        skipNextAnimation.current = true;
        
        setGroup(targetGroup);

        return;
      }
    }
    
    // For partial transfers, the grid will automatically update via store changes
    // No additional action needed - modal already showed toast
  };

  const toggleImageSelection = (itemId, event) => {
    // itemId can be either image ID or face ID depending on showCrops mode
    toggleSelectedImageKey(itemId, event);
  };

  // selectAllImages and clearSelection provided by useImageSelection

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Ctrl+A or Cmd+A for select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        if (sortedImages.length > 0) {
          selectAllImages();
        }
      }
      // Escape to clear selection
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedImages]);

  const openImageViewer = (itemId, index) => {
    // In faces mode, itemId is a face ID; we need to get the image ID
    let imageIndex = index;
    if (showCrops) {
      const face = entities?.faces?.[itemId];
      if (face) {
        // Find the index of this image in the original images list
        const imageId = face.image_id;
        imageIndex = relatedImages.findIndex(img => img.id === imageId);
        if (imageIndex === -1) imageIndex = index; // Fallback to original index
      }
    }
    openViewer({ index: imageIndex, parent: group.id, entity: 'group', currentGroupId: group.id, sortBy: 'date', sortOrder, filteredIds: filteredImageIds });
  };

  

  const navigateImage = (direction, index) => navigateViewer(direction, index);

  const handleTitleEdit = useCallback(() => {
    setEditingTitle(group?.label || '');
    setIsEditingTitle(true);
    setTimeout(() => {
      // titleInputRef.current?.focus(); // This ref is not defined in the original file
    }, 0);
  }, [group?.label]);

  const handleTitleSave = useCallback(async () => {
    if (!group || !editingTitle.trim()) {
      handleTitleCancel();
      return;
    }

    // Check if name actually changed
    if (editingTitle.trim() === group.label) {
      setIsEditingTitle(false);
      return;
    }

    try {
      // Check for conflicts first
      const conflictResult = await groupsAPI.checkName(editingTitle.trim(), group.id, eventUrl);
      
      if (conflictResult.conflict) {
        // Changes are automatically applied by apiService interceptor
        // Get conflicting group from store
        const store = useDataStore.getState();
        const conflictingGroup = store.entities?.groups?.[conflictResult.conflicting_group];
        
        // Show merge conflict modal
        showMergeConflictModal(editingTitle.trim(), group, conflictingGroup);
        setIsEditingTitle(false);
        return;
      }
      
      // Set flag to prevent the lookup effect from running BEFORE the API call
      // because the response interceptor will update the store during the API call
      isRenamingRef.current = true;
      
      // Also reset attemptedLookupRef to allow the new name to be looked up if needed
      attemptedLookupRef.current = false;
      
      // No conflict, proceed with update
      await groupsAPI.update(group.id, { label: editingTitle.trim() }, eventUrl);
      // Changes are automatically applied by apiService interceptor
      
      // Update local group state immediately to ensure smooth transition
      setGroup(prev => ({ ...prev, label: editingTitle.trim() }));
      
      // Update the URL to reflect the new group name
      const newUrl = `/${eventUrl}/people/${encodeURIComponent(editingTitle.trim())}`;
      navigate(newUrl, { replace: true });
      
      setIsEditingTitle(false);
      showToast('Person name updated', 'success');
    } catch (error) {
      console.error('Error updating group name:', error);
      showToast(formatErrorMessage('update person name', error), 'error');
      setIsEditingTitle(false);
    }
  }, [group, editingTitle, eventUrl, navigate, showToast, showMergeConflictModal]);

  const handleTitleCancel = useCallback(() => {
    
    setIsEditingTitle(false);
    setEditingTitle(group?.label || '');
  }, [group]);

  const handleMergeCancelLocal = useCallback(() => {
    
    setIsEditingTitle(true); // Restore editing mode
  }, []);

  // Snapshot log on key state changes
  useEffect(() => {
    // Useful during development; intentionally empty in production
  }, [group?.id, group?.label, sortedImages, relatedImages, filterGroups, filterMode, onlySelected, hasMore, offset, sortOrder, selectionMode]);



  if (!group) {
    return <div>Loading...</div>;
  }

  return (
    <div className="w-full">
      {/* Pinned Header */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              to={`/${eventUrl}/people`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to all people"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div 
                  className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg"
                >
                  {groupRepresentativeComponent}
                </div>
                {group?.representative_face && (
                  <PermissionGate requires="canEdit">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await groupsAPI.update(group.id, { representative_face: null }, eventUrl);
                          showToast('Representative removed', 'success');
                        } catch (error) {
                          showToast(formatErrorMessage('remove representative', error), 'error');
                        }
                      }}
                      className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                      title="Remove representative"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                  </PermissionGate>
                )}
              </div>
              <div className="flex items-center space-x-3">
                {isEditingTitle ? (
                  <div className="flex items-center space-x-2" onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      handleTitleCancel();
                    }
                  }}>
                    <div className="relative">
                      <input
                        type="text"
                        id="edit-group-title"
                        name="edit-group-title"
                        value={editingTitle}
                        onChange={(e) => {
                          setEditingTitle(e.target.value);
                          checkNameConflict(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleTitleSave();
                          } else if (e.key === 'Escape') {
                            handleTitleCancel();
                          }
                        }}
                        className={`text-3xl font-bold text-gray-900 bg-transparent border-b-2 focus:outline-none w-[200px] ${
                          nameConflict ? 'border-red-500' : 'border-primary-500'
                        }`}
                        autoFocus
                      />
                      {nameConflict && (
                        <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Name already exists</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleTitleSave}
                      className="p-1 hover:bg-green-100 rounded transition-colors"
                    >
                      <Check className="w-4 h-4 text-green-600" />
                    </button>
                    <button
                      onClick={handleTitleCancel}
                      className="p-1 hover:bg-red-100 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-red-600" />
                    </button>

                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <h1 
                      className={`text-3xl font-bold text-gray-900 w-[200px] ${
                        permissions.canEdit ? 'cursor-pointer hover:text-primary-600 transition-colors' : ''
                      }`}
                      onClick={permissions.canEdit ? handleTitleEdit : undefined}
                    >
                      {group.label || `Person ${group.id}`}
                    </h1>
                  </div>
                )}
              </div>
              <div className="relative">
                <p className="text-gray-600">
                  {showCrops ? (
                    `${sortedImages.length} faces`
                  ) : (
                    sortedImages.length === getImageCount(group)
                      ? `${sortedImages.length} photos`
                      : `${sortedImages.length} of ${getImageCount(group)} photos`
                  )}
                </p>
              </div>
            </div>
          </div>


        </div>

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

          <div className="flex items-center divide-x divide-gray-200">
            {/* Group 1: Sort and Filter */}
            <div className="flex items-center space-x-3 px-4">
              {/* Search field - temporarily hidden
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  id="search-images"
                  name="search-images"
                  placeholder="Search images..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
                />
              </div>
              */}

              {/* Sort controls */}
              {/* Sort by field - temporarily hidden
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setSortedImages(prevImages => sortImages(prevImages, e.target.value, sortOrder));
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
              </select>
              */}

              <button
                onClick={handleToggleSortOrder}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
                title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </button>

              {/* Filter Toggle */}
              <button
                onClick={handleFilterVisibilityToggle}
                className={`w-8 h-8 rounded-md transition-colors flex items-center justify-center ${
                  filterVisible ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'
                }`}
                title={filterVisible ? 'Hide people filter' : 'Show people filter'}
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>
            
            {/* Group 2: Zoom, Crops */}
            <div className="flex items-center space-x-3 px-4">
              <button
                onClick={() => {
                  const currentPercent = Math.round(imageSize * 100);
                  const next25 = Math.ceil(currentPercent / 25) * 25;
                  const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                  const subtract25 = currentPercent - 25;
                  const newPercent = Math.max(50, Math.max(subtract25, prev25));
                  setImageSize(newPercent / 100);
                }}
                disabled={imageSize <= 0.5}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title="Decrease size"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="text"
                id="face-detail-image-size"
                name="face-detail-image-size"
                inputMode="numeric"
                pattern="[0-9]*"
                value={imageSizeInputValue !== undefined ? imageSizeInputValue : Math.round(imageSize * 100)}
                onChange={e => setImageSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={e => {
                  let val = parseInt(e.target.value, 10);
                  if (isNaN(val)) val = Math.round(imageSize * 100);
                  val = Math.max(50, Math.min(300, val));
                  setImageSize(val / 100);
                  setImageSizeInputValue(undefined);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.target.blur();
                  } else if (e.key === 'Escape') {
                    setImageSizeInputValue(undefined);
                  }
                }}
                className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                style={{width: '3rem'}}
              />
              <button
                onClick={() => {
                  const currentPercent = Math.round(imageSize * 100);
                  const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                  const add25 = currentPercent + 25;
                  const newPercent = Math.min(300, Math.min(add25, next25));
                  setImageSize(newPercent / 100);
                }}
                disabled={imageSize >= 3}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title="Increase size"
              >
                <Plus className="w-4 h-4" />
              </button>

                              <button
                  onClick={() => setShowCrops(!showCrops)}
                  className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                    showCrops 
                      ? 'bg-primary-100 text-primary-700' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title={showCrops ? 'Show full photos' : 'Show faces'}
                >
                {showCrops ? <ImageIcon className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </button>
            </div>

                        {/* Group 3: Selection Mode Toggle */}
            {sortedImages.length > 0 && (
              <div className="flex items-center space-x-3 px-4">
                <button
                  onClick={() => setSelectionMode(!selectionMode)}
                  className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                    selectionMode 
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title={selectionMode ? 'Cancel selection mode' : 'Show checkboxes'}
                >
                  {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </div>
            )}

            {/* Group 4: Manage Access */}
            <div className="flex items-center space-x-3 px-4">
              <PermissionGate requires="isProfilesManager">
                <button
                  onClick={() => setShowManageAccessModal(true)}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-blue-100 text-blue-600 flex items-center justify-center"
                  title="Manage profile access"
                >
                  <Key className="w-4 h-4" />
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>

        {/* Groups Filter - Now part of the header */}
        <AnimatePresence>
          {filterVisible && (
            <GroupsFilter
              group={group}
              urlHelpers={urlHelpers}
              relatedGroups={memoizedRelatedGroups}
              filterMode={filterMode}
              onlySelected={onlySelected}
              onModeChange={handleFilterModeChange}
              onOnlySelectedChange={handleOnlySelectedChange}
              onReset={handleFilterReset}
              isVisible={filterVisible}
              eventUrl={eventUrl}
              imageIds={memoizedImageIds}
              onRelatedGroupsUpdate={handleRelatedGroupsUpdate}
              currentGroupId={group?.id}
              onSelectedGroupsChange={handleFilterGroupsChange}
              initialSelectedGroups={filterGroups}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Content Area */}
      <div className="px-8 py-8">
        {/* Photos Grid/List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading photos...</p>
          </div>
        ) : sortedImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm ? 'No photos found' : 'No photos in this group'}
            </h3>
            <p className="text-gray-500">
              {searchTerm ? 'Try adjusting your search terms' : 'This face group is empty'}
            </p>
          </motion.div>
        ) : (
          <>
            <motion.div
              className="w-full photo-gallery-grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(100, 266 * imageSize)}px`
              }}
              initial={skipNextAnimation.current ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              onAnimationComplete={() => {
                skipNextAnimation.current = false;
              }}
            >
              {sortedImages.map((item, index) => {
                // In faces mode, item is a face; in images mode, item is an image
                const isFacesMode = showCrops;
                const itemId = item.id;
                const imageId = isFacesMode ? item.image_id : item.id;
                const image = isFacesMode ? entities?.images?.[item.image_id] : item;
                
                // In faces mode, item IS the face; in images mode, we don't need the face for display
                let faceId = null;
                if (isFacesMode) {
                  faceId = item.id;
                } else {
                  // For images mode, find a face for the crop URL (if any)
                  const facesSet = entities?.groups?.[group.id]?.faces;
                  if (facesSet) {
                    const facesMap = entities?.faces || {};
                    const facesInImage = Array.from(facesSet)
                      .map(fId => facesMap[fId])
                      .filter(f => f && f.image_id === imageId)
                      .sort((a, b) => {
                        const sizeA = (a.width || 0) * (a.height || 0);
                        const sizeB = (b.width || 0) * (b.height || 0);
                        return sizeB - sizeA;
                      });
                    faceId = facesInImage[0]?.id || null;
                  }
                }
                const isRep = group?.representative_face === faceId;
                
                return (
                  <motion.div
                    key={itemId || `unknown-${index}`}
                    initial={skipNextAnimation.current ? false : { opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className={`photo-card ${imageClasses[imageId] || 'square'}`}
                  >
                    <SingleImageTile
                      ref={(el) => registerImageRef(itemId, el)}
                      image={image || item}
                      aspectClass={imageClasses[imageId] || 'square'}
                      imageFit={'cover'}
                      thumbSrc={item.isPlaceholder ? null : (isFacesMode && urlHelpers ? urlHelpers.getFaceCropUrl(faceId) : (urlHelpers ? urlHelpers.getThumbnailUrl(imageId) : null))}
                      selectionMode={selectionMode}
                      isSelected={selectedImages.has(itemId)}
                      onToggleSelect={(e) => toggleImageSelection(itemId, e)}
                      onOpen={() => openImageViewer(itemId, index)}
                      onImageLoad={(e) => handleImageLoad(imageId, e)}
                      showCropBadge={false}
                      eventUrl={eventUrl}
                      urlHelpers={urlHelpers}
                      isHighlighted={isHighlighted(itemId)}
                      showFavoriteButton={!isFacesMode}
                      showArchiveButton={!isFacesMode}
                      showRepresentativeButton={isFacesMode}
                      isRepresentative={isRep}
                      onSetRepresentative={isFacesMode ? (async () => {
                        try {
                          await groupsAPI.update(group.id, { representative_face: faceId }, eventUrl);
                          showToast('Representative updated', 'success');
                        } catch (error) {
                          showToast(formatErrorMessage('set representative', error), 'error');
                        }
                      }) : undefined}
                    />
                  </motion.div>
                );
              })}
            </motion.div>
            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetchingMore}
                  className="btn-secondary"
                >
                  {isFetchingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Selection Controls */}
      <FloatingSelectionControls
        selectedCount={selectedImages.size}
        totalCount={sortedImages.length}
        selectedImages={selectedImages}
        onSelectAll={selectAllImages}
        onClearSelection={clearSelection}
        onTransferFaces={handleTransferFaces}
        onSetRepresentative={showCrops ? async (faceId) => {
          try {
            await groupsAPI.update(group.id, { representative_face: faceId }, eventUrl);
            showToast('Representative updated', 'success');
            clearSelection();
          } catch (error) {
            showToast(formatErrorMessage('set representative', error), 'error');
          }
        } : undefined}
        eventUrl={eventUrl}
        urlHelpers={urlHelpers}
        placeholderDataUrl={null}
        showTransferFaces={true}
        showRemoveFromMoment={false}
        showMoveToMoment={false}
        showArchive={!showCrops}
        showFavorites={!showCrops}
        showBucket={!showCrops}
        showAlbum={!showCrops}
        showDelete={!showCrops}
        showManageAccess={!showCrops}
        selectionMode={selectionMode}
        entity="group"
        entityId={group?.id}
        isFacesMode={showCrops}
      />

      {/* Modals */}
      {viewerOpen && (
        <ImageViewer {...viewerProps} />
      )}

      {/* Merge Conflict Modal */}
      {showMergeModal && conflictData && (
        <MergeConflictModal
          isOpen={showMergeModal}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          onClose={() => setShowMergeModal(false)}
          newName={conflictData.newName}
          currentGroup={conflictData.currentGroup}
          conflictingGroup={conflictData.conflictingGroup}
          onMerge={handleMergeGroups}
          onCancel={handleMergeCancelLocal}
          onTransferComplete={handleTransferComplete}
          onNavigateToGroup={(targetGroupId) => {
            // Find the target group and navigate to it
            const targetGroup = currentGroups.find(g => g.id === targetGroupId);
            if (targetGroup) {
              navigate(`/${eventUrl}/people/${encodeURIComponent(targetGroup.label)}`);
            } else {
              navigate(`/${eventUrl}/people`);
            }
          }}
        />
      )}

             {/* Transfer Faces Modal */}
       {showTransferModal && (
         <TransferFacesModal
           isOpen={showTransferModal}
           eventUrl={eventUrl}
           urlHelpers={urlHelpers}
           onClose={() => {
             setShowTransferModal(false);
             setSelectedFacesForTransfer([]);
           }}
           groups={currentGroups}
           currentGroup={group}
           selectedFaces={selectedFacesForTransfer}
           onTransferComplete={handleTransferComplete}
         />
       )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="group"
        entityIds={group?.id ? [group.id] : []}
        eventUrl={eventUrl}
      />
    </div>
  );
}


