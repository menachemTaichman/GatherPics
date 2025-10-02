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
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import ImageViewer from './ImageViewer';
import { useToast } from '../utils/ToastContext';
import useImageViewerController from '../utils/useImageViewerController.js';
import MergeConflictModal from './MergeConflictModal';
import TransferFacesModal from './TransferFacesModal';
import FloatingSelectionControls from './FloatingSelectionControls';
import { sortImages, toggleSortOrder } from '../utils/sorting';
import { usePreference } from '../utils/useSettings';
import { setPreference, getImageCount } from '../utils/settings';

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
import useImageSelection from '../utils/useImageSelection';
import { useGroupNameConflict } from '../utils/useGroupNameConflict';
import { useDataStore, selectors } from '../utils/dataManager';
import { selectors as storeSelectors } from '../utils/dataManager';
import { groupsAPI, handleAPIError, optimisticUpdates, API_BASE, albumsAPI } from '../utils/apiService';
import useImageActions from './ImageActions';
import { useEventUrls } from '../utils/useEventUrls';
import { clearTransferredImagesFromCache } from '../utils/selection';
import timelineManager from '../utils/timeline';
import useBucketStore from '../utils/bucketStore';
import { Plus as PlusIcon, Heart as HeartIcon } from 'lucide-react';
import SingleImageTile from './SingleImageTile';
import GroupsFilter from './GroupsFilter';
import { shallow } from 'zustand/shallow';

const EMPTY_ARRAY = Object.freeze([]);

export default function GroupDetail({ groups, onDeleteGroup, onRefreshGroups }) {
  const { group_name, eventUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { urlHelpers, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
  const { showToast } = useToast();
  const [group, setGroup] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  // Derived list; avoid state to prevent effect loops
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // (moved below after sortedImages is defined)
  
  const sortOrder = usePreference('GroupDetail.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupDetail.sortDir', value);
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast,
    onTransferComplete: (result) => handleTransferComplete(result),
    onJumpToMoment: (momentInfo) => timelineManager.navigateToMoment(momentInfo.label, momentInfo.label),
    defaultSortBy: 'date',
    defaultSortOrder: sortOrder,
  });
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
  const { addImages, open } = useBucketStore();
  const [imageClasses, setImageClasses] = useState({});

  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [albums, setAlbums] = useState([]);
  
  // Filter states
  const [filterVisible, setFilterVisible] = useState(false);
  const [relatedGroups, setRelatedGroups] = useState([]);
  // Filter settings are temporary (not stored) - they reset when component unmounts
  const [filterGroups, setFilterGroups] = useState([]);
  const [filterMode, setFilterMode] = useState('and');
  const [onlySelected, setOnlySelected] = useState(false);
  
  // Only store the filtered results (the actual image IDs to use instead of relations)
  const [filteredIds, setFilteredIds] = useSessionStorage('groupDetail_filteredIds', null);
  const [filteredFacesMapping, setFilteredFacesMapping] = useSessionStorage('groupDetail_filteredFacesMapping', null);
  const lastFetchSignatureRef = useRef('');
  const prevGroupIdRef = useRef(null);
  const suppressSpinnerRef = useRef(false);
  const restoreScrollYRef = useRef(null);
  const smoothNextGroupLoad = useRef(false);
  const skipNextAnimation = useRef(false);

  // Memoize props for GroupsFilter to prevent infinite re-renders (defined after sortedImages below)
  const memoizedRelatedGroups = useMemo(() => relatedGroups.filter(g => g.id !== group?.id), [relatedGroups, group?.id]);
  
  // No complex flag checking needed - the data store handles everything

  // Subscribe to normalized groups list
  const currentGroups = useDataStore(state => storeSelectors.groupsAll(state), shallow);

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

  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  // Derive images from embedded relation Set in group entity or filtered_ids
  const groupFromStore = useDataStore(state => (group?.id ? state.entities?.groups?.[group.id] : null));
  const imagesMap = useDataStore(state => state.entities.images);
  const includeArchived = usePreference('general.includeArchived', false);
  
  const relatedImages = useMemo(() => {
    let ids;
    if (filteredIds) {
      // Use filtered_ids when available
      ids = Array.isArray(filteredIds) ? filteredIds : [];
    } else {
      // Use relation Set from store
      ids = groupFromStore?.images instanceof Set ? Array.from(groupFromStore.images) : [];
    }
    const images = ids.map(id => imagesMap[id]).filter(Boolean);
    
    // Filter out archived images if includeArchived is false
    if (!includeArchived) {
      return images.filter(img => !img.is_archived);
    }
    return images;
  }, [groupFromStore?.images, imagesMap, filteredIds, includeArchived]);

  const facesMapping = filteredFacesMapping || groupFromStore?.faces_mapping || {};

  const sortedImages = useMemo(() => {
    if (!group?.id) return EMPTY_ARRAY;
    return sortImages(relatedImages, 'date', sortOrder);
  }, [group?.id, relatedImages, sortOrder]);

  // Now compute memoizedImageIds after sortedImages exists
  const memoizedImageIds = useMemo(() => sortedImages.map(img => img.id), [sortedImages]);

  const {
    selectedKeys: selectedImages,
    toggleKey: toggleSelectedImageKey,
    clear: clearSelection,
    selectAll: selectAllImages,
    deselectMany,
  } = useImageSelection({
    items: sortedImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });

  useEffect(() => {
    const foundGroup = (currentGroups || []).find(g => g.label === group_name);
    if (foundGroup) {
      if (!group || group.id !== foundGroup.id || group !== foundGroup) setGroup(foundGroup);
    } else if (!group || !group.id) {
      navigate(`/${eventUrl}/persons`);
    }
  }, [group_name, currentGroups, navigate, eventUrl]);

  // Keep local `group` in sync by id when the store object changes (e.g., rename)
  useEffect(() => {
    if (!group?.id) return;
    const byId = (currentGroups || []).find(g => g.id === group.id);
    if (byId && byId !== group) setGroup(byId);
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
    if (!group?.id) {
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
      const changes = Array.isArray(payload?.changes) ? payload.changes : [];
      
      // Handle filtered_ids from API response
      if (payload?.filter && Array.isArray(payload?.filtered_ids)) {
        setFilteredIds(payload.filtered_ids);
      } else {
        setFilteredIds(null);
      }
      
      // Handle faces_mapping from API response (for filtered results)
      if (payload?.faces_mapping) {
        setFilteredFacesMapping(payload.faces_mapping);
      } else {
        setFilteredFacesMapping(null);
      }
      
      const rel = changes.find(ch => (ch.type === 'RELATION_SET' || ch.type === 'RELATION_ADD') && (ch.relation || '') === 'groups.images' && String(ch.parentId) === String(group.id));
      const pageCount = Array.isArray(rel?.ids) ? rel.ids.length : 0;
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
    if (!group?.id) return;

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
    if (sig === lastFetchSignatureRef.current) return;
    const isGroupChange = prevGroupIdRef.current !== group.id;
    prevGroupIdRef.current = group.id;
    
    // If this is a group change, clear filtered data
    if (isGroupChange) {
      setFilteredIds(null);
      setFilteredFacesMapping(null);
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
    setFilterVisible(prev => !prev);
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

  const handleFilterChange = (newFilterGroups) => {
    if (arraysEqual(filterGroups, newFilterGroups)) return;
    setFilterGroups(newFilterGroups);
  };

  const handleFilterModeChange = (newMode) => {
    setFilterMode(newMode);
  };

  const handleOnlySelectedChange = (newOnlySelected) => {
    setOnlySelected(newOnlySelected);
  };

  const handleFilterReset = () => {
    setFilterGroups([]);
    setFilterMode('and');
    setOnlySelected(false);
    setFilteredIds(null);
    setFilteredFacesMapping(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return dateString;
    }
  };


  // Create ImageActions instance for selected images
  const selectedImageActions = useImageActions({
    imageIds: Array.from(selectedImages),
    eventUrl,
    urlHelpers,
    placeholderDataUrl: PLACEHOLDER_DATA_URL,
    onImageUpdated: () => {}, // No need to update local state, store handles it
    onAlbumAdded: () => {} // No special handling needed
  });

  const handleImageLoad = (imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    setImageClasses(prev => ({
      ...prev,
      [imageId]: imageClass
    }));
  };



  const getSelectedFaces = () => {
    const selectedFaces = [];
    for (const imageId of selectedImages) {
      const faceId = facesMapping?.[imageId];
      if (!faceId) continue;
      selectedFaces.push({
        face_id: faceId,
        image_id: imageId,
        group_id: group.id,
        width: 0,
        height: 0,
        left: 0,
        top: 0,
        group_label: group.label
      });
    }
    return selectedFaces;
  };

  const handleTransferFaces = () => {
    if (selectedImages.size === 0) {
      showToast('Please select photos to transfer', 'error');
      return;
    }
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
        const link = `/${eventUrl}/persons/${encodeURIComponent(targetGroup.label)}`;
        
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

  const toggleImageSelection = (imageId, event) => {
    toggleSelectedImageKey(imageId, event);
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

  const openImageViewer = (imageId, index) => {
    openViewer({ index, parent: group.id, entity: 'group', currentGroupId: group.id, sortBy: 'date', sortOrder, filteredIds });
  };

  

  const navigateImage = (direction, index) => navigateViewer(direction, index);

  const handleTitleEdit = () => {
    setEditingTitle(group.label || `Person ${group.id}`);
    setIsEditingTitle(true);
    clearConflict(); // Clear any previous conflict
  };

  const handleTitleSave = async () => {
    // Check if the current group still exists in the store
  const currentGroups = storeSelectors.groupsAll(useDataStore.getState());
    const groupExists = currentGroups.some(g => g.id === group?.id);
    
    if (!groupExists) {
      setIsEditingTitle(false);
      clearConflict();
      return;
    }
    
    // Validate editingTitle
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) {
      alert('Group name cannot be empty');
      setIsEditingTitle(false);
      clearConflict();
      return;
    }
    
    if (trimmedTitle === group.label) {
      // No change needed
      setIsEditingTitle(false);
      clearConflict();
      return;
    }
    
    try {
      // Check for conflicts first - call the API directly to avoid state timing issues
      const conflictResult = await groupsAPI.checkName(trimmedTitle, group.id, eventUrl);
      
      if (conflictResult.conflict) {
        // Changes are automatically applied by apiService interceptor
        
        // Get conflicting group from store or use the id from response
        let conflictingGroup = conflictResult.conflicting_group;
        if (conflictResult.id && !conflictingGroup) {
          const store = useDataStore.getState();
          conflictingGroup = store.entities?.groups?.[conflictResult.id];
        }
        
        // Show merge conflict modal with the conflicting group
        try {
          restoreScrollYRef.current = window.scrollY;
        } catch {}
        showMergeConflictModal(trimmedTitle, group, conflictingGroup);
        setIsEditingTitle(false);
        return;
      }
      
      // No conflict, proceed with update
      await optimisticUpdates.updateGroup(group.id, { label: trimmedTitle }, null, eventUrl);
      
      // Update the URL to reflect the new group name
      const newUrl = `/${eventUrl}/persons/${encodeURIComponent(trimmedTitle)}`;
      navigate(newUrl, { replace: true });
      
      setIsEditingTitle(false);
      clearConflict();
    } catch (error) {
      // Show user-friendly error message
      if (error.response?.status === 400 && error.response?.data?.error) {
        // Backend returned a specific error message
        alert(`Failed to update group name: ${error.response.data.error}`);
      } else {
        alert('Failed to update group name. Please try again.');
      }
      
      setIsEditingTitle(false);
      clearConflict();
    }
  };

  const handleTitleCancel = () => {
    setIsEditingTitle(false);
    clearConflict(); // Clear conflict on cancel
  };

  const handleMergeCancelLocal = () => {
    handleMergeCancel(); // Use the hook's function
    setIsEditingTitle(true); // Restore editing mode
  };



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
              to={`/${eventUrl}/persons`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to all persons"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div 
                className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
                onClick={() => setShowEditModal(true)}
                title="Edit group details"
              >
                <img
                  key={group.id || 'no-representative'}
                  src={urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl('groups', group.id) : PLACEHOLDER_DATA_URL}
                  alt={group.label || `Person ${group.id}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
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
                      className="text-3xl font-bold text-gray-900 cursor-pointer hover:text-primary-600 transition-colors w-[200px]"
                      onClick={handleTitleEdit}
                    >
                      {group.label || `Person ${group.id}`}
                    </h1>
                  </div>
                )}
              </div>
              <div className="relative">
                <p className="text-gray-600">
                  {sortedImages.length} of {getImageCount(group)} images
                  {showCrops && (
                    <span className="ml-2 text-primary-600 font-medium">
                      • Showing face crops
                    </span>
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
                title={filterVisible ? 'Hide group filter' : 'Show group filter'}
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
                  title={showCrops ? 'Show full images' : 'Show face crops'}
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
          </div>
        </div>

        {/* Groups Filter - Now part of the header */}
        <AnimatePresence>
          {filterVisible && (
            <GroupsFilter
              group={group}
              relatedGroups={memoizedRelatedGroups}
              filterMode={filterMode}
              onlySelected={onlySelected}
              onModeChange={handleFilterModeChange}
              onOnlySelectedChange={handleOnlySelectedChange}
              onReset={handleFilterReset}
              isVisible={filterVisible}
              eventUrl={eventUrl}
              imageIds={memoizedImageIds}
              onRelatedGroupsUpdate={setRelatedGroups}
              currentGroupId={group?.id}
              onSelectedGroupsChange={setFilterGroups}
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
              {sortedImages.map((image, index) => (
                <motion.div
                  key={image.id || `unknown-${index}`}
                  initial={skipNextAnimation.current ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className={`photo-card ${imageClasses[image.id] || 'square'}`}
                >
                  <SingleImageTile
                    image={image}
                    aspectClass={imageClasses[image.id] || 'square'}
                    imageFit={'cover'}
                    thumbSrc={showCrops && facesMapping?.[image.id] && urlHelpers ? urlHelpers.getFaceCropUrl(facesMapping[image.id]) : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                    selectionMode={selectionMode}
                    isSelected={selectedImages.has(image.id)}
                    onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                      onOpen={() => openImageViewer(image.id, index)}
                      onImageLoad={(e) => handleImageLoad(image.id, e)}
                      dateLabel={formatDate(image.date_taken)}
                      showDate={!!image.date_taken}
                      showCropBadge={showCrops && !!facesMapping?.[image.id]}
                      eventUrl={eventUrl}
                      urlHelpers={urlHelpers}
                    />
                </motion.div>
              ))}
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
        eventUrl={eventUrl}
        urlHelpers={urlHelpers}
        placeholderDataUrl={PLACEHOLDER_DATA_URL}
        showTransferFaces={true}
        showRemoveFromMoment={false}
        showMoveToMoment={false}
        showArchive={true}
        showFavorites={true}
        showBucket={true}
        showAlbum={true}
        selectionMode={selectionMode}
      />

      {/* Modals */}
      {showEditModal && (
        <EditGroupModal
          group={group}
          eventUrl={eventUrl}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            const result = await optimisticUpdates.updateGroup(group.id, updates, null, eventUrl);
            
            // Update the URL if the group name changed
            if (updates.label && updates.label !== group.label) {
              const newUrl = `/${eventUrl}/persons/${encodeURIComponent(updates.label)}`;
              navigate(newUrl, { replace: true });
            }
            
            setShowEditModal(false);
            return result;
          }}
          onRefreshGroups={onRefreshGroups}
          onNameConflict={(newName, conflictingGroup) => {
            // The modal detected a conflict, so we use the parent's handler
            // to show the merge modal, ensuring consistent behavior.
            showMergeConflictModal(newName, group, conflictingGroup);
          }}
        />
      )}

      {viewerOpen && (
        <ImageViewer {...viewerProps} />
      )}

      {/* Merge Conflict Modal */}
      {showMergeModal && conflictData && (
        <MergeConflictModal
          isOpen={showMergeModal}
          eventUrl={eventUrl}
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
              navigate(`/${eventUrl}/persons/${encodeURIComponent(targetGroup.label)}`);
            } else {
              navigate(`/${eventUrl}/persons`);
            }
          }}
        />
      )}

             {/* Transfer Faces Modal */}
       {showTransferModal && (
         <TransferFacesModal
           isOpen={showTransferModal}
           eventUrl={eventUrl}
           onClose={() => setShowTransferModal(false)}
           groups={currentGroups}
           currentGroup={group}
           selectedFaces={getSelectedFaces()}
           onTransferComplete={handleTransferComplete}
         />
       )}
    </div>
  );
}