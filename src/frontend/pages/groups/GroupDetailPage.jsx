import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, 
  ArrowRight,
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
import { sortImages, toggleSortOrder, filterImages } from '../../utils/sorting';
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
import { shallow } from 'zustand/shallow';
import { selectors as storeSelectors, useGroupsList, useGroupById, useEventGeneralById } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { groupsAPI, handleAPIError, optimisticUpdates, API_BASE, albumsAPI, eventsAPI } from '../../utils/apiService';
import useImageActions from '../../components/images/ImageActions';
import { clearTransferredImagesFromCache } from '../../utils/selection';
import timelineManager from '../../utils/timeline';
import useBucketStore from '../../utils/bucketStore';
import { SingleImageTile } from '../../components/images';
import { GroupsFilter } from '../../components/groups';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useImageHighlight } from '../../hooks/useImageHighlight';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import usePinchToZoom from '../../hooks/usePinchToZoom';
import i18n from '../../i18n';
import { APP_CONFIG } from '../../config/appConfig';

const EMPTY_ARRAY = Object.freeze([]);

export default function GroupDetail({ groups, onDeleteGroup, onRefreshGroups, urlHelpers: injectedUrlHelpers }) {
  const renderCount = (window.__groupDetailRenderCount = (window.__groupDetailRenderCount || 0) + 1);
  
  // Track what's changing between renders
  const prevPropsRef = useRef(null);
  const propsChanged = !prevPropsRef.current || 
    JSON.stringify(prevPropsRef.current) !== JSON.stringify({
      groupsLength: groups?.length,
      onDeleteGroup: !!onDeleteGroup,
      onRefreshGroups: !!onRefreshGroups,
      urlHelpers: !!injectedUrlHelpers
    });
  
  // Update ref with current props
  prevPropsRef.current = {
    groupsLength: groups?.length,
    onDeleteGroup: !!onDeleteGroup,
    onRefreshGroups: !!onRefreshGroups,
    urlHelpers: !!injectedUrlHelpers
  };
  // Render counter to spot potential render loops
  const __renderCountRef = useRef(0);
  __renderCountRef.current += 1;
  
  const __lastUrlRef = useRef('');
  const __initialRestorationComplete = useRef(false);
  const { group_name, eventUrl } = useParams();
  const eventId = useEventId(eventUrl);
  const navigate = useNavigate();
  const location = useLocation();
  // Use injected urlHelpers from App to avoid creating duplicate instances on refresh
  const urlHelpers = injectedUrlHelpers;
  const { showToast } = useToast();
  const [group, setGroup] = useState(null);
  const permissions = usePermissions();
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass, ms, me } = useRTL();
  
  // Get event data to check for unassociated group
  const eventData = useEventGeneralById(eventId);
  
  // Fetch event data if not already loaded (to get unassociated_group_id)
  useEffect(() => {
    if (!eventUrl || !eventId) return;
    if (eventData && eventData.unassociated_group_id) return;
    
    eventsAPI.getById(eventUrl).catch(() => {
      // Silently fail - event data will be loaded eventually
    });
  }, [eventUrl, eventId, eventData]);
  
  // Check if current group is the unassociated group
  const unassociatedGroupId = eventData?.unassociated_group_id ? String(eventData.unassociated_group_id) : null;
  const groupIdentifier = group?.id || group?.group_id || null;
  const isUnassociatedGroup = useMemo(() => {
    if (!unassociatedGroupId || !groupIdentifier) return false;
    return String(groupIdentifier) === unassociatedGroupId;
  }, [unassociatedGroupId, groupIdentifier]);
  
  // Use the hook at component level to avoid conditional hook calls
  const groupRepresentativeComponent = useImageComponent(
    group && urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}` : null,
    {
      width: 64,
      height: 64,
      className: 'w-full h-full object-cover',
      alt: group?.label || `${t('groupDetail.person')} ${group?.id}`,
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
  
  const sortBy = usePreference('GroupDetail.sortBy', 'date');
  const sortOrder = usePreference('GroupDetail.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupDetail.sortDir', value);
  // ImageViewer controller is initialized
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

  // Pinch-to-zoom for mobile
  const setGridContainerRef = usePinchToZoom(imageSize, setImageSize);

  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [albums, setAlbums] = useState([]);
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  
  // Filter states
  const [filterVisible, setFilterVisible] = useState(false);
  // Filter settings are temporary (not stored) - they reset when component unmounts
  const [filterGroups, setFilterGroups] = useState([]);
  const [filterMode, setFilterMode] = useState('and');
  const [onlySelected, setOnlySelected] = useState(false);
  const filterGroupsSig = useMemo(() => {
    return Array.isArray(filterGroups) ? filterGroups.map((g) => String(g)).sort().join(',') : '';
  }, [filterGroups]);
  
  // Apply scopes at top-level to avoid conditional hook usage
  const scopes = useMemo(() => {
    const scopesList = [];
    if (group?.id) {
      scopesList.push({ entity: 'group', id: String(group.id) });
      if (Array.isArray(filterGroups) && filterGroups.length > 0) {
        const uniqueGroupIds = new Set(filterGroups.map((g) => String(g)));
        uniqueGroupIds.delete(String(group.id));
        uniqueGroupIds.forEach((gid) => scopesList.push({ entity: 'group', id: gid }));
      }
    }
    if (filterVisible) {
      scopesList.push({ entity: 'all', id: 'groups' });
    }
    // Sort for stable identity
    return scopesList
      .map((s) => ({ entity: s.entity, id: String(s.id), eventId }))
      .sort((a, b) => (a.entity === b.entity ? a.id.localeCompare(b.id) : a.entity.localeCompare(b.entity)));
  }, [group?.id, showCrops, filterGroups.join(','), filterVisible, eventId]);

  useApplyScopes(scopes);

  useEffect(() => {
    try {
      
    } catch {}
  }, [scopes, showCrops, group?.id, filterGroups, filterVisible]);

  // Debug log after all variables are declared
  
  /* debug removed */
  
  /*console.log('[DEBUG] GroupDetail component render:', {
    timestamp: Date.now(),
    renderCount,
    groupsLength: groups?.length,
    onDeleteGroup: !!onDeleteGroup,
    onRefreshGroups: !!onRefreshGroups,
    urlHelpers: !!injectedUrlHelpers,
    propsChanged,
    prevProps: prevPropsRef.current,
    showCrops,
    groupId: group?.id,
    filterGroupsLength: filterGroups.length
  });*/
  
  
  
  // Initialize ImageViewer controller
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast,
    onTransferComplete: (result) => handleTransferComplete(result),
    onJumpToMoment: null, // Let ImageViewer handle navigation with proper eventUrl
    defaultSortBy: 'date',
    defaultSortOrder: sortOrder,
    urlHelpers,
    // Pass filter settings for ImageViewer
    filterGroups: filterGroups,
    filterMode: filterMode,
    onlySelected: onlySelected,
  });
  const lastFetchSignatureRef = useRef('');
  const prevGroupIdRef = useRef(null);
  const suppressSpinnerRef = useRef(false);
  const restoreScrollYRef = useRef(null);
  const smoothNextGroupLoad = useRef(false);
  
  // Image highlight hook for navigation
  const { isHighlighted, registerImageRef } = useImageHighlight();
  const skipNextAnimation = useRef(false);
  
  // Refs for arrow key navigation
  const imageTileRefs = useRef([]);

  // Subscribe to normalized groups list
  const currentGroups = useGroupsList(eventId);
  const attemptedLookupRef = useRef(false);
  const isRenamingRef = useRef(false);
  
  // Trigger restoration when currentGroups loads (for filter restoration)
  const prevCurrentGroupsLenRef = useRef(0);
  useEffect(() => {
    const currentLen = (currentGroups || []).length;
    if (currentLen > 0 && prevCurrentGroupsLenRef.current === 0 && window.__pendingFilterGroups) {
      setRestorationTrigger(prev => prev + 1);
    }
    prevCurrentGroupsLenRef.current = currentLen;
  }, [currentGroups?.length]);
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

  // State to trigger restoration after async fetch completes
  const [restorationTrigger, setRestorationTrigger] = useState(0);
  
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
        // Trigger restoration effect to run now that groups are loaded
        setRestorationTrigger(prev => prev + 1);
      }).catch(err => {
        console.error('[GroupDetail] Failed to check group names:', err);
        delete window.__fetchingGroupsForRestore;
        // Still trigger restoration even on error
        setRestorationTrigger(prev => prev + 1);
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
  
  // all:groups scope is now managed via top-level useApplyScopes(scopes)

  
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
    if (window.__pendingFilterGroups) {
      // If fetch is still in progress, wait for it
      if (window.__fetchingGroupsForRestore) {
        return;
      }
      
      // Use currentGroups instead of accessing store directly - it's already normalized and scoped
      const allGroupsFromStore = currentGroups || [];
      
      // If no groups available yet, wait for them to load
      if (allGroupsFromStore.length === 0) {
        return;
      }
      
      const groupNames = window.__pendingFilterGroups;
      const groupIds = groupNames
        .map(name => {
          const found = allGroupsFromStore.find(g => g.label === name);
          return found?.id;
        })
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
  }, [restorationTrigger, currentGroups?.length]); // Depend on restoration trigger AND currentGroups length

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
        return;
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
    
    // Update filter groups - always update URL when filterGroups changes
    if (filterGroups.length > 0) {
      // Always use currentGroups (store data) as the authoritative source for group names
      const groupNames = filterGroups
        .map(id => {
          const group = currentGroups.find(g => g.id === id);
          return group?.label;
        })
        .filter(Boolean)
        .filter(name => {
          const excludeMain = name !== group?.label;
          return excludeMain;
        })
        .join(',');
      if (groupNames) {
        searchParams.set('filterGroups', groupNames);
      } else {
        searchParams.delete('filterGroups');
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
    
  }, [filterGroups, filterMode, onlySelected, location.pathname, currentGroups, group?.label]);


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
  
  // Scopes for group/filter are now managed via top-level useApplyScopes(scopes)
  
  const relatedImages = useChilds(eventId, 'groups', group?.id, 'images', { includeArchived, sortBy, sortOrder });
  
  // Use stable hooks to avoid subscribing to entire maps (per STORE_USAGE.md)
  const allGroups = [group?.id, ...filterGroups].filter(Boolean);

  // Faces filtered by images matching the selected groups and mode
  const filteredFaces = useMemo(() => {
    if (allGroups.length === 0) return [];
    
    const state = useDataStore.getState();
    const groupsMap = state.entities?.[eventId]?.groups || {};
    const facesMap = state.entities?.[eventId]?.faces || {};
    const imagesMap = state.entities?.[eventId]?.images || {};
    
    // Get base image IDs from all groups
    const baseIdSet = new Set();
    allGroups.forEach((gid) => {
      const rel = groupsMap[gid]?.images;
      if (rel instanceof Set) rel.forEach((iid) => baseIdSet.add(String(iid)));
      else if (Array.isArray(rel)) rel.forEach((iid) => baseIdSet.add(String(iid)));
    });
    
    const baseImages = Array.from(baseIdSet)
      .map((id) => imagesMap[String(id)])
      .filter(Boolean)
      .filter((img) => includeArchived || !img.is_archived);
    
    const utilFiltered = (!onlySelected && allGroups.length === 1)
      ? baseImages
      : filterImages(baseImages, allGroups, filterMode, onlySelected);
    
    const filteredImageIds = new Set(utilFiltered.map(img => String(img.id)));
    
    // Collect faces whose images are in the filtered set
    const out = [];
    allGroups.forEach((gid) => {
      const setOrArray = groupsMap[gid]?.faces;
      const faces = setOrArray instanceof Set ? Array.from(setOrArray) : 
                   Array.isArray(setOrArray) ? setOrArray : [];
      faces.forEach((faceId) => {
        const face = facesMap[faceId];
        const imgId = face ? String(face.image_id) : null;
        if (face && filteredImageIds.has(imgId)) {
          out.push(face);
        }
      });
    });
    
    return out;
  }, [allGroups, filterMode, onlySelected, includeArchived, eventId]);

  const groupFaces = useMemo(() => {
    if (!showCrops || !group?.id) return [];
    // Stable signature for debug
    const sig = {
      showCrops,
      groupId: group?.id,
      filterGroups: filterGroupsSig,
      filterMode,
      onlySelected,
      facesCount: filteredFaces.length
    };
    // debug removed
    return filteredFaces;
  }, [showCrops, group?.id, filteredFaces, filterGroupsSig, filterMode, onlySelected]);

  // Ensure selected filter groups have data loaded (faces/images) to support faces mode filtering
  const fetchedGroupsRef = useRef(new Set());
  useEffect(() => {
    if (!showCrops || !eventUrl) return;
    const store = useDataStore.getState();
    const ensureIds = [group?.id, ...filterGroups].filter(Boolean).map(String);
    const toFetch = [];
    ensureIds.forEach((gid) => {
      const g = store.entities?.[eventId]?.groups?.[gid];
      const hasImages = (g?.images instanceof Set) || Array.isArray(g?.images);
      const hasFaces = (g?.faces instanceof Set) || Array.isArray(g?.faces);
      if ((!hasImages || !hasFaces) && !fetchedGroupsRef.current.has(gid)) {
        toFetch.push(gid);
      }
    });
    if (toFetch.length === 0) return;
    toFetch.forEach((gid) => fetchedGroupsRef.current.add(gid));
    Promise.all(
      toFetch.map((gid) => groupsAPI.getById(gid, eventUrl, { filter: true }))
    ).catch(() => {});
  }, [showCrops, group?.id, filterGroupsSig, eventUrl]);

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
    
    // If showCrops, return faces sorted by their image's properties based on sortBy
    if (showCrops) {
      const store = useDataStore.getState();
      const storeImages = store.entities?.[eventId]?.images || {};
      
      const sorted = [...groupFaces].sort((a, b) => {
        const imgA = storeImages[a.image_id];
        const imgB = storeImages[b.image_id];
        
        let comparison = 0;
        
        if (sortBy === 'date') {
          const dateA = imgA?.date_taken ? new Date(imgA.date_taken).getTime() : 0;
          const dateB = imgB?.date_taken ? new Date(imgB.date_taken).getTime() : 0;
          comparison = dateA - dateB;
        } else if (sortBy === 'name') {
          comparison = (imgA?.id || imgA?.label || '').localeCompare(imgB?.id || imgB?.label || '');
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
      
      return sorted;
    }
    
    // For images mode, apply frontend filtering
    let images = relatedImages;
    if (filterGroups.length > 0 || onlySelected) {
      // Include current group in filtering
      const allGroups = [group?.id, ...filterGroups].filter(Boolean);
      
      // Get all images from all groups (current + filter groups)
      const store = useDataStore.getState();
      const storeGroups = store.entities?.[eventId]?.groups || {};
      const storeImages = store.entities?.[eventId]?.images || {};
      
      const allImageIds = new Set();
      allGroups.forEach(groupId => {
        const groupImages = storeGroups[groupId]?.images;
        if (groupImages instanceof Set) {
          groupImages.forEach(imageId => allImageIds.add(imageId));
        }
      });
      
      // Convert to image objects and filter by includeArchived
      const allImages = Array.from(allImageIds)
        .map(imageId => storeImages[imageId])
        .filter(Boolean)
        .filter((img) => includeArchived || !img.is_archived);
      
      images = filterImages(allImages, allGroups, filterMode, onlySelected);
    }
    
    const out = sortImages(images, sortBy, sortOrder);
    
    return out;
  }, [group?.id, group?.isPlaceholder, relatedImages, sortBy, sortOrder, placeholderImages, showCrops, groupFaces, filterImages, filterGroups, filterMode, onlySelected, includeArchived]);

  // Update refs array when sortedImages changes
  useEffect(() => {
    imageTileRefs.current = imageTileRefs.current.slice(0, sortedImages.length);
  }, [sortedImages.length]);


  // Memoize filtered imageIds to prevent infinite re-renders in GroupsFilter
  // Use the already filtered images from sortedImages instead of all images from main group
  const memoizedImageIds = useMemo(() => {
    if (!group?.id) return [];
    
    // Use the already filtered images from sortedImages
    // In faces mode, sortedImages contains faces, so extract image_id
    // In images mode, sortedImages contains images, so extract id
    const filteredImageIds = sortedImages.map(item => 
      showCrops ? item.image_id : item.id
    );
    
    // Remove duplicates (important in faces mode where multiple faces can belong to same image)
    const uniqueImageIds = [...new Set(filteredImageIds)];
    
    return uniqueImageIds;
  }, [sortedImages, group?.id, filterGroups, filterMode, onlySelected, showCrops]);

  // Wrapped callback for when filter groups are changed
  const handleFilterGroupsChange = useCallback((groups) => {
    const next = Array.isArray(groups)
      ? Array.from(new Set(groups.map((g) => String(g)))).sort()
      : [];
    setFilterGroups((prev) => {
      const prevSig = (prev || []).join(',');
      const nextSig = next.join(',');
      return prevSig === nextSig ? prev : next;
    });
  }, []);

  // Call fetch_related when memoizedImageIds actually changes (not just reference)
  const lastImageIdsSignatureRef = useRef(null);
  useEffect(() => {
    if (fetchRelatedRef.current && memoizedImageIds.length > 0) {
      // Create signature to prevent calling with same IDs repeatedly
      const signature = memoizedImageIds.join(',');
      if (lastImageIdsSignatureRef.current === signature) {
        return; // Same IDs, skip
      }
      lastImageIdsSignatureRef.current = signature;
      fetchRelatedRef.current(memoizedImageIds);
    }
  }, [memoizedImageIds]);


  useEffect(() => {
    
  }, [sortedImages]);


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
    
    // Wait for eventId to resolve before attempting group lookup
    if (!eventId) {
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
          const after = storeSelectors.groupsAll(useDataStore.getState(), eventId) || [];
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
  }, [decodedGroupName, currentGroups, navigate, eventUrl, isAuthenticated, eventId]);

  // Keep local `group` in sync by id when the store object changes (e.g., rename)
  useEffect(() => {
    if (!group?.id) return;
    const byId = (currentGroups || []).find(g => g.id === group.id);
    if (byId && byId !== group) {
      
      setGroup(byId);
    }
  }, [currentGroups, group?.id]);

  // Set document title
  useEffect(() => {
    if (group?.label) {
      document.title = `${group.label} - ${t('groupDetail.person')} | ${APP_CONFIG.name}`;
    } else {
      document.title = `${t('groupDetail.person')} | ${APP_CONFIG.name}`;
    }
  }, [group?.label, i18n.language]);

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

    // Add filter parameter when filtering is active
    if (filterGroups.length > 0 || filterVisible) {
      params.filter = true;
    }

    try {
      const payload = await groupsAPI.getById(group.id, eventUrl, params);
      
      const pageCount = Array.isArray(payload?.images)
        ? payload.images.length
        : 0;
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
  }, [group?.id, eventUrl, isFetchingMore, filterGroups, filterVisible]);

  // Centralized effect for fetching all image and group data
  useEffect(() => {
    // Skip for placeholder groups
    if (!group?.id || group.isPlaceholder) return;
    

    if (smoothNextGroupLoad.current) {
      smoothNextGroupLoad.current = false;
      // When smoothly navigating between groups, we rely on store data
      // and skip the API fetch. We just need to update refs.
      const sig = `${group.id}|${filterGroups.length > 0 || filterVisible ? 'filter' : 'nofilter'}`;
      lastFetchSignatureRef.current = sig;
      prevGroupIdRef.current = group.id;
      
      // The scroll restoration is now handled in useLayoutEffect
      
      return;
    }

    const sig = `${group.id}|${filterGroups.length > 0 || filterVisible ? 'filter' : 'nofilter'}`;
    if (sig === lastFetchSignatureRef.current) {
      
      return;
    }
    const isGroupChange = prevGroupIdRef.current !== group.id;
    prevGroupIdRef.current = group.id;
    
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
  }, [group?.id, filterGroupsSig, filterVisible]); // Re-run when group or filter state changes

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
      
      // If opening the panel, notify GroupsFilter that it was opened by user
      if (next && !prev) {
        handlePanelOpenedByUser();
      }
      
      return next;
    });
  };
  
  // Callback to notify GroupsFilter when panel is opened by user
  const handlePanelOpenedByUser = useCallback(() => {
    // This will be called by GroupsFilter when panel is opened by user action
  }, []);

  // Store the fetch_related function from GroupsFilter
  const fetchRelatedRef = useRef(null);
  
  const handleFetchRelated = useCallback((fetchRelatedFn) => {
    fetchRelatedRef.current = fetchRelatedFn;
  }, []);

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
    const store = useDataStore.getState();
    const storeFaces = store.entities?.[eventId]?.faces || {};
    
    if (showCrops) {
      // In faces mode, selectedImages contains face IDs
      for (const faceId of selectedImages) {
        const face = storeFaces[faceId];
        if (!face) continue;
        selectedFaces.push({
          face_id: faceId,
          image_id: face.image_id,
          group_id: face.group_id,
          face_width: face.face_width || 0,
          face_height: face.face_height || 0,
          face_left: face.face_left || 0,
          face_top: face.face_top || 0,
          group_label: face.group_id ? store.entities?.[eventId]?.groups?.[face.group_id]?.label : group.label
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
          const face = storeFaces[faceId];
          if (!face) continue;
          selectedFaces.push({
            face_id: faceId,
            image_id: face.image_id,
            group_id: face.group_id,
            face_width: face?.face_width || 0,
            face_height: face?.face_height || 0,
            face_left: face?.face_left || 0,
            face_top: face?.face_top || 0,
            group_label: face.group_id ? store.entities?.[eventId]?.groups?.[face.group_id]?.label : group.label
          });
        }
      } catch (error) {
        console.error('Failed to fetch faces for images:', error);
      }
    }
    return { faces: selectedFaces, hasFaces: selectedFaces.length > 0 };
  };

  const handleTransferFaces = async () => {
    if (selectedImages.size === 0) {
      showToast(t('groupDetail.pleaseSelectPhotosToTransfer'), 'error');
      return;
    }
    
    // Fetch all faces for selected images
    const result = await getSelectedFaces();
    const faces = result.faces;
    const hasFaces = result.hasFaces;
    
    // Show toast and don't open modal if no faces found
    if (!hasFaces) {
      showToast(t('groupDetail.noFacesFoundInSelectedPhotos'), 'error');
      return;
    }
    
    setSelectedFacesForTransfer(faces);
    
    try {
      restoreScrollYRef.current = window.scrollY;
    } catch {}
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result, imageIds = null) => {
    const transferData = { ...(result || {}) };
    
    // Clear selection (UI state management)
    clearSelection();

    // Handle deleted groups - if current group was deleted, start merge process
    const deletedGroupIds = transferData.deleted_group_ids || [];
    if (deletedGroupIds.includes(group?.id)) {
      // Current group was deleted, navigate to target group
      const targetGroupId = transferData.target_group_id;
      if (targetGroupId) {
        const targetGroup = currentGroups.find(g => g.id === targetGroupId);
        
        if (targetGroup) {
          const link = `/${eventUrl}/people/${encodeURIComponent(targetGroup.label)}`;
          
          // Use provided IDs or fallback to current group data
          const fallbackIds = showCrops 
            ? (group?.faces ? Array.from(group.faces) : [])
            : (group?.images ? Array.from(group.images) : []);
          const idsToHighlight = imageIds || fallbackIds;
          
          // Pass appropriate highlighting state based on mode
          const highlightState = showCrops 
            ? { highlightFaces: idsToHighlight.slice(0, 10) }
            : { highlightImages: idsToHighlight.slice(0, 10) };
          
          // Use React Router navigation to properly update URL and state
          navigate(link, { 
            replace: true,
            state: highlightState
          });
          return;
        }
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

  // Handle keyboard shortcuts and arrow key navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Arrow key navigation for images
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const currentElement = document.activeElement;
        const currentIndex = imageTileRefs.current.findIndex(ref => ref === currentElement);
        
        if (currentIndex === -1) return;
        
        // Calculate grid dimensions (approximate based on viewport)
        const gridContainer = currentElement.closest('.photo-gallery-grid');
        if (!gridContainer) return;
        
        const containerRect = gridContainer.getBoundingClientRect();
        const itemRect = currentElement.getBoundingClientRect();
        
        // Estimate columns based on container width and item width
        const itemWidth = itemRect.width;
        const containerWidth = containerRect.width;
        const estimatedCols = Math.floor(containerWidth / itemWidth) || 1;
        
        let nextIndex = currentIndex;
        
        switch (event.key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, sortedImages.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + estimatedCols, sortedImages.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - estimatedCols, 0);
            break;
        }
        
        if (nextIndex !== currentIndex && imageTileRefs.current[nextIndex]) {
          event.preventDefault();
          imageTileRefs.current[nextIndex].focus();
        }
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
  }, [sortedImages, selectAllImages, clearSelection]);

  const openImageViewer = (itemId, index) => {
    let imageIndex = index;
    const store = useDataStore.getState();
    const face = showCrops ? (store.entities?.[eventId]?.faces || {})[itemId] : null;
    const targetImageId = showCrops && face ? face.image_id : (sortedImages[index]?.id || null);
    if (targetImageId) {
      // Build viewer image list with same semantics as ImageViewer
      const allGroupsLocal = [group.id, ...filterGroups].filter(Boolean);
      let viewerImages;
      if (allGroupsLocal.length === 1 && !onlySelected && (!filterGroups || filterGroups.length === 0)) {
        viewerImages = relatedImages;
      } else {
        const allImageIdsSet = new Set();
        allGroupsLocal.forEach((gid) => {
          const rel = store.entities?.[eventId]?.groups?.[gid]?.images;
          if (rel instanceof Set) rel.forEach((iid) => allImageIdsSet.add(iid));
          else if (Array.isArray(rel)) rel.forEach((iid) => allImageIdsSet.add(iid));
        });
        const allImages = Array.from(allImageIdsSet)
          .map((iid) => store.entities?.[eventId]?.images?.[iid])
          .filter((img) => !!img && (includeArchived || !img.is_archived));
        viewerImages = filterImages(allImages, allGroupsLocal, filterMode, onlySelected);
        viewerImages = sortImages(viewerImages, sortBy, sortOrder);
      }
      const ids = viewerImages.map((img) => img.id);
      const idx = ids.indexOf(targetImageId);
      if (idx >= 0) imageIndex = idx;
    }
    openViewer({
      index: imageIndex,
      parent: group.id,
      entity: 'group',
      currentGroupId: group.id,
      sortBy,
      sortOrder,
      filterGroups,
      filterMode,
      onlySelected,
    });
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
        const conflictingGroup = store.entities?.[eventId]?.groups?.[conflictResult.conflicting_group];
        
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
      showToast(t('groupDetail.personNameUpdated'), 'success');
    } catch (error) {
      console.error('Error updating group name:', error);
      showToast(formatErrorMessage(t('groupDetail.updatePersonName'), error), 'error');
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
    return <div>{t('groupDetail.loading')}</div>;
  }

  return (
    <div className="w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="h-[4rem]"></div>
      {/* Pinned Header */}
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200/50 px-4 sm:px-8 py-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              to={`/${eventUrl}/people`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title={t('groupDetail.backToAllPeople')}
              aria-label={t('groupDetail.backToAllPeople')}
            >
              {isRTL ? (
                <ArrowRight className="w-5 h-5 text-gray-600" />
              ) : (
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              )}
            </Link>
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div 
                  className="w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg"
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
                          showToast(t('groupDetail.representativeRemoved'), 'success');
                        } catch (error) {
                          showToast(formatErrorMessage(t('groupDetail.removeRepresentativeAction'), error), 'error');
                        }
                      }}
                      className={`absolute -bottom-1 ${endClass('1')} w-4 h-4 sm:w-5 sm:h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors`}
                      title={t('groupDetail.removeRepresentative')}
                      aria-label={t('groupDetail.removeRepresentative')}
                    >
                      <Minus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    </button>
                  </PermissionGate>
                )}
              </div>
              <div className="flex flex-col items-start gap-1 sm:gap-3 flex-1 min-w-0">
                {isEditingTitle ? (
                  <div className="flex flex-col gap-1 flex-1 min-w-0" onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      handleTitleCancel();
                    }
                  }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative flex-1 min-w-0">
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
                          dir={isRTL ? 'rtl' : 'ltr'}
                          className={`text-xl sm:text-3xl font-bold text-gray-900 bg-transparent border-b-2 focus:outline-none w-full max-w-[200px] ${
                            nameConflict ? 'border-red-500' : 'border-primary-500'
                          }`}
                          autoFocus
                        />
                        {nameConflict && (
                          <div className={`absolute top-full ${startClass('0')} mt-1 flex items-center gap-1 text-red-500 text-xs`}>
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t('groupDetail.nameAlreadyExists')}</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleTitleSave}
                        className="p-1 hover:bg-green-100 rounded transition-colors flex-shrink-0"
                        title={t('groupDetail.save')}
                        aria-label={t('groupDetail.save')}
                      >
                        <Check className="w-4 h-4 text-green-600" />
                      </button>
                      <button
                        onClick={handleTitleCancel}
                        className="p-1 hover:bg-red-100 rounded transition-colors flex-shrink-0"
                        title={t('groupDetail.cancel')}
                        aria-label={t('groupDetail.cancel')}
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                    <div className="relative">
                      <p className="text-sm sm:text-base text-gray-600 whitespace-nowrap">
                        {showCrops ? (
                          `${sortedImages.length} ${t('groupDetail.faces')}`
                        ) : (
                          sortedImages.length === getImageCount(group)
                            ? `${sortedImages.length} ${t('groupDetail.photos')}`
                            : `${sortedImages.length} ${t('groupDetail.of')} ${getImageCount(group)} ${t('groupDetail.photos')}`
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 min-w-0">
                    <h1 
                      className={`text-xl sm:text-3xl font-bold text-gray-900 truncate ${
                        (isUnassociatedGroup || !permissions.canEdit) ? '' : 'cursor-pointer hover:text-primary-600 transition-colors'
                      }`}
                      onClick={(isUnassociatedGroup || !permissions.canEdit) ? undefined : handleTitleEdit}
                    >
                      {group.label || `${t('groupDetail.person')} ${group.id}`}
                    </h1>
                    <div className="relative">
                      <p className="text-sm sm:text-base text-gray-600 whitespace-nowrap">
                        {showCrops ? (
                          `${sortedImages.length} ${t('groupDetail.faces')}`
                        ) : (
                          sortedImages.length === getImageCount(group)
                            ? `${sortedImages.length} ${t('groupDetail.photos')}`
                            : `${sortedImages.length} ${t('groupDetail.of')} ${getImageCount(group)} ${t('groupDetail.photos')}`
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* Group 1: Sort and Filter */}
            <div className="flex items-center gap-2 sm:gap-4">
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
                title={sortOrder === 'asc' ? t('groupDetail.sortAscending') : t('groupDetail.sortDescending')}
                aria-label={sortOrder === 'asc' ? t('groupDetail.sortAscending') : t('groupDetail.sortDescending')}
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
                title={filterVisible ? t('groupDetail.hidePeopleFilter') : t('groupDetail.showPeopleFilter')}
                aria-label={filterVisible ? t('groupDetail.hidePeopleFilter') : t('groupDetail.showPeopleFilter')}
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>
            
            {/* Group 2: Zoom, Crops */}
            <div className="flex items-center gap-2 sm:gap-4">
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
                title={t('groupDetail.decreaseSize')}
                aria-label={t('groupDetail.decreaseSize')}
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
                className="text-sm font-medium text-gray-700 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
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
                title={t('groupDetail.increaseSize')}
                aria-label={t('groupDetail.increaseSize')}
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
                title={showCrops ? t('groupDetail.showFullPhotos') : t('groupDetail.showFaces')}
                aria-label={showCrops ? t('groupDetail.showFullPhotos') : t('groupDetail.showFaces')}
              >
                {showCrops ? <ImageIcon className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </button>
            </div>

            {/* Group 3: Selection Mode Toggle */}
            {sortedImages.length > 0 && (
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={() => setSelectionMode(!selectionMode)}
                  className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                    selectionMode 
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title={selectionMode ? t('groupDetail.cancelSelectionMode') : t('groupDetail.showCheckboxes')}
                  aria-label={selectionMode ? t('groupDetail.cancelSelectionMode') : t('groupDetail.showCheckboxes')}
                >
                  {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </div>
            )}

            {/* Group 4: Manage Access */}
            {!isUnassociatedGroup && (
              <div className="flex items-center gap-2 sm:gap-4">
                <PermissionGate requires="isProfilesManager">
                  <button
                    onClick={() => setShowManageAccessModal(true)}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-blue-100 text-blue-600 flex items-center justify-center"
                    title={t('groupDetail.manageProfileAccess')}
                    aria-label={t('groupDetail.manageProfileAccess')}
                  >
                    <Key className="w-4 h-4" />
                  </button>
                </PermissionGate>
              </div>
            )}
          </div>
        </div>

        {/* Groups Filter - Now part of the header */}
        <AnimatePresence>
          {filterVisible && (
            <GroupsFilter
              group={group}
              urlHelpers={urlHelpers}
              filterMode={filterMode}
              onlySelected={onlySelected}
              onModeChange={handleFilterModeChange}
              onOnlySelectedChange={handleOnlySelectedChange}
              onReset={handleFilterReset}
              isVisible={filterVisible}
              eventUrl={eventUrl}
              imageIds={memoizedImageIds}
              currentGroupId={group?.id}
              onSelectedGroupsChange={handleFilterGroupsChange}
              initialSelectedGroups={filterGroups}
              onPanelOpenedByUser={handlePanelOpenedByUser}
              onFetchRelated={handleFetchRelated}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Content Area */}
      <div className="px-4 sm:px-8 py-4 sm:py-8">
        {/* Photos Grid/List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">{t('groupDetail.loadingPhotos')}</p>
          </div>
        ) : sortedImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm ? t('groupDetail.noPhotosFound') : t('groupDetail.noPhotosInThisGroup')}
            </h3>
            <p className="text-gray-500">
              {searchTerm ? t('groupDetail.tryAdjustingYourSearchTerms') : t('groupDetail.thisFaceGroupIsEmpty')}
            </p>
          </motion.div>
        ) : (
          <>
            <div ref={setGridContainerRef} className="w-full">
            <motion.div
              className="w-full photo-gallery-grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(120, 266 * imageSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(120, 266 * imageSize)}px`
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
                const image = isFacesMode ? (() => {
                  const store = useDataStore.getState();
                  return store.entities?.[eventId]?.images?.[item.image_id];
                })() : item;
                
                // In faces mode, item IS the face; in images mode, we don't need the face for display
                let faceId = null;
                if (isFacesMode) {
                  faceId = item.id;
                } else {
                  // For images mode, find a face for the crop URL (if any)
                  const store = useDataStore.getState();
                  const facesSet = store.entities?.[eventId]?.groups?.[group.id]?.faces;
                  if (facesSet) {
                    const facesMap = store.entities?.[eventId]?.faces || {};
                    const facesInImage = Array.from(facesSet)
                      .map(fId => facesMap[fId])
                      .filter(f => f && f.image_id === imageId)
                      .sort((a, b) => {
                        const sizeA = (a.face_width || 0) * (a.face_height || 0);
                        const sizeB = (b.face_width || 0) * (b.face_height || 0);
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
                    className={`photo-card ${(showCrops ? 'square' : (imageClasses[imageId] || 'square'))} relative`}
                  >
                    <SingleImageTile
                      ref={(el) => {
                        registerImageRef(itemId, el);
                        // Store ref for arrow key navigation
                        if (el && imageTileRefs.current[index] !== el) {
                          imageTileRefs.current[index] = el;
                        }
                      }}
                      image={image || item}
                      aspectClass={showCrops ? 'square' : (imageClasses[imageId] || 'square')}
                      imageFit={'cover'}
                      thumbSrc={item.isPlaceholder ? null : (isFacesMode && urlHelpers ? urlHelpers.getFaceCropUrl(faceId) : (urlHelpers ? urlHelpers.getThumbnailUrl(imageId) : null))}
                      selectionMode={selectionMode}
                      isSelected={selectedImages.has(itemId)}
                      onToggleSelect={(e) => toggleImageSelection(itemId, e)}
                      onOpen={() => openImageViewer(itemId, index)}
                      onImageLoad={showCrops ? undefined : ((e) => handleImageLoad(imageId, e))}
                      showCropBadge={false}
                      eventUrl={eventUrl}
                      urlHelpers={urlHelpers}
                      isHighlighted={isHighlighted(itemId)}
                      showFavoriteButton={!isFacesMode}
                      showArchiveButton={!isFacesMode}
                      showRepresentativeButton={isFacesMode}
                      isRepresentative={isRep}
                      photoIndex={index}
                      contextType="Person"
                      contextLabel={group?.label}
                      onSetRepresentative={isFacesMode ? (async () => {
                        try {
                          await groupsAPI.update(group.id, { representative_face: faceId }, eventUrl);
                          showToast(t('groupDetail.representativeUpdated'), 'success');
                        } catch (error) {
                          showToast(formatErrorMessage(t('groupDetail.setRepresentative'), error), 'error');
                        }
                      }) : undefined}
                    />
                    {/* Group label overlay for faces mode when filtering with at least one group */}
                    {isFacesMode && filterGroups.length > 1 && (
                      <div className={`absolute top-2 ${endClass('2')} bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded-md font-medium`}>
                        {(() => {
                          const store = useDataStore.getState();
                          return store.entities?.[eventId]?.groups?.[item.group_id]?.label || `${t('groupDetail.person')} ${item.group_id}`;
                        })()}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
            </div>
            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetchingMore}
                  className="btn-secondary"
                >
                  {isFetchingMore ? t('groupDetail.loading') : t('groupDetail.loadMore')}
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
            showToast(t('groupDetail.representativeUpdated'), 'success');
            clearSelection();
          } catch (error) {
            showToast(formatErrorMessage(t('groupDetail.setRepresentative'), error), 'error');
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
        isUnassociatedGroup={isUnassociatedGroup}
      />

      {/* Modals */}
      {viewerOpen && (
        <ImageViewer {...viewerProps} isUnassociatedGroup={isUnassociatedGroup} />
      )}

      {/* Merge Conflict Modal */}
      {showMergeModal && conflictData && (
        <MergeConflictModal
          isOpen={showMergeModal}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          showCrops={showCrops}
          onClose={() => setShowMergeModal(false)}
          newName={conflictData.newName}
          currentGroup={conflictData.currentGroup}
          conflictingGroup={conflictData.conflictingGroup}
          onMerge={handleMergeGroups}
          onCancel={handleMergeCancelLocal}
          onTransferComplete={handleTransferComplete}
          onNavigateToGroup={(targetGroupId, idsToHighlight = null) => {
            // Find the target group and navigate to it
            const targetGroup = currentGroups.find(g => g.id === targetGroupId);
            if (targetGroup) {
              // Use provided IDs or fallback to current group data
              const fallbackIds = showCrops 
                ? (group?.faces ? Array.from(group.faces) : [])
                : (group?.images ? Array.from(group.images) : []);
              const idsForHighlighting = idsToHighlight || fallbackIds;
              
              // Pass appropriate highlighting state based on mode
              const highlightState = showCrops 
                ? { highlightFaces: idsForHighlighting.slice(0, 10) }
                : { highlightImages: idsForHighlighting.slice(0, 10) };
              
              navigate(`/${eventUrl}/people/${encodeURIComponent(targetGroup.label)}`, {
                state: highlightState
              });
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
           showCrops={showCrops}
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


