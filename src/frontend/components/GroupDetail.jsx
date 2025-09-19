import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Grid,
  List,
  Plus,
  Minus,
  Square,
  CheckSquare,
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import { useImageViewer } from './ImageViewerProvider';
import MergeConflictModal from './MergeConflictModal';
import TransferFacesModal from './TransferFacesModal';
import FloatingSelectionControls from './FloatingSelectionControls';
import { sortImages, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import useImageSelection from '../utils/useImageSelection';
import { getSetting, setSetting } from '../utils/settings';
import { useGroupNameConflict } from '../utils/useGroupNameConflict';
import { useDataStore } from '../utils/dataManager';
import { selectors as storeSelectors } from '../utils/dataManager';
import { groupsAPI, handleAPIError, optimisticUpdates, API_BASE, albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { clearTransferredImagesFromCache } from '../utils/selection';
import timelineManager from '../utils/timeline';
import useBucketStore from '../utils/bucketStore';
import { Plus as PlusIcon, Heart as HeartIcon } from 'lucide-react';
import SingleImageTile from './SingleImageTile';
import SingleImageRow from './SingleImageRow';
import GroupsFilter from './GroupsFilter';
import { shallow } from 'zustand/shallow';

const EMPTY_ARRAY = Object.freeze([]);

export default function GroupDetail({ groups, onDeleteGroup, showToast, onRefreshGroups }) {
  const { group_name, eventUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { urlHelpers, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
  const [group, setGroup] = useState(null);
  const [viewMode, setViewMode] = useSetting('groupDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  // Derived list; avoid state to prevent effect loops
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // (moved below after sortedImages is defined)
  
  const { 
    open: openGlobalViewer, 
    navigate: navigateGlobalViewer,
    close: closeGlobalViewer,
    updateSession: updateViewerSession,
    isOpen: isViewerOpen,
    currentImageId,
    currentIndex: viewerIndex
  } = useImageViewer();
  const [sortBy, setSortBy] = useSetting('groupDetail_sortBy', 'date');
  const [sortOrder, setSortOrder] = useSetting('groupDetail_sortOrder', 'asc');
  const [loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useSetting('groupDetail_imageSize', 1.0);
  const [showCrops, setShowCrops] = useState(false);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [selectionMode, setSelectionMode] = useSetting('selectionMode', false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const { addImages, open } = useBucketStore();
  const [imageClasses, setImageClasses] = useState({});

  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [albums, setAlbums] = useState([]);
  
  // Filter states
  const [filterVisible, setFilterVisible] = useState(false);
  const [relatedGroups, setRelatedGroups] = useState([]);
  // Selection now lives in GroupsFilter; keep a derived copy here for fetching images
  const [filterGroups, setFilterGroups] = useSetting('groupDetail_filterGroups', []);
  const [filterMode, setFilterMode] = useSetting('groupDetail_filterMode', 'and');
  const [onlySelected, setOnlySelected] = useSetting('groupDetail_onlySelected', false);
  const lastFetchSignatureRef = useRef('');
  const prevGroupIdRef = useRef(null);
  const suppressSpinnerRef = useRef(false);
  const restoreScrollYRef = useRef(null);

  // Memoize props for GroupsFilter to prevent infinite re-renders (defined after sortedImages below)
  let memoizedImageIds = EMPTY_ARRAY;
  const memoizedRelatedGroups = useMemo(() => relatedGroups.filter(g => g.groupID !== group?.groupID), [relatedGroups, group?.groupID]);
  
  // No complex flag checking needed - the data store handles everything

  // Subscribe only to groups to avoid re-renders on unrelated store changes
  const storeGroups = useDataStore(state => state.groups, shallow);

  // Use groups from store if available, otherwise fall back to props
  const currentGroups = storeGroups.length > 0 ? storeGroups : groups;

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

  // Derive images from normalized store relations (ids with shallow equality) for smooth updates
  const relatedImageIds = useDataStore(
    state => (group?.groupID ? (state.relations?.groupImages?.[group.groupID] || EMPTY_ARRAY) : EMPTY_ARRAY),
    shallow
  );
  const imagesById = useDataStore(state => state.entities.imagesById);
  const relatedImages = useMemo(() => (relatedImageIds || []).map(id => imagesById[id]).filter(Boolean), [relatedImageIds, imagesById]);

  // Subscribe to album ids arrays (stable references) and derive Sets locally
  const favoriteIds = useDataStore((state) => {
    const favId = state.favoritesAlbumId;
    return (favId && state.relations?.albumImages?.[favId]) || EMPTY_ARRAY;
  }, shallow);
  const archiveIds = useDataStore((state) => {
    const arcId = state.archiveAlbumId;
    return (arcId && state.relations?.albumImages?.[arcId]) || EMPTY_ARRAY;
  }, shallow);
  const favoritesSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const archiveSet = useMemo(() => new Set(archiveIds), [archiveIds]);

  const sortedImages = useMemo(() => {
    if (!group?.groupID) return EMPTY_ARRAY;
    const includeArchived = getSetting('include_archived_images', false);
    const visible = (relatedImages || []).filter(img => includeArchived || !img?.is_archived);
    return sortImages(visible, sortBy, sortOrder);
  }, [group?.groupID, relatedImages, sortBy, sortOrder]);

  // Now compute memoizedImageIds after sortedImages exists
  memoizedImageIds = useMemo(() => sortedImages.map(img => img.id), [sortedImages]);

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
    const groupsArray = currentGroups?.groups || currentGroups;
    const foundGroup = groupsArray.find(g => g.label === group_name);
    if (foundGroup) {
      if (!group || group.groupID !== foundGroup.groupID) setGroup(foundGroup);
    } else if (group && group.groupID) {
      return;
    } else {
      navigate(`/${eventUrl}/persons`);
    }
  }, [group_name, currentGroups, navigate]);

  // Legacy subscription removed; updates flow from normalized selectors

  const fetchGroupData = useCallback(async (currentOffset, resetImages = false) => {
    if (!group?.groupID) {
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
      const response = await groupsAPI.getById(group.groupID, eventUrl, params);
      
      setGroup(prev => {
        const next = { ...(prev || {}), ...(response.group || {}) };
        if (prev && prev.groupID === next.groupID && prev.label === next.label && prev.representative_face === next.representative_face && prev.count === next.count) {
          return prev;
        }
        return next;
      });
      // Populate normalized store entities and relations for smooth updates
      try {
        const store = useDataStore.getState();
        const imageIds = (response.images || []).map(img => img?.id).filter(Boolean);
        const changes = [];
        if (response.group) {
          changes.push({ type: 'UPSERT', entity: 'group', items: [response.group] });
        }
        if (Array.isArray(response.images)) {
          changes.push({ type: 'UPSERT', entity: 'image', items: response.images });
        }
        if (resetImages || currentOffset === 0) {
          changes.push({ type: 'RELATION_SET', relation: 'group.images', parentId: group.groupID, ids: imageIds });
        } else if (imageIds.length > 0) {
          changes.push({ type: 'RELATION_ADD', relation: 'group.images', parentId: group.groupID, ids: imageIds });
        }
        if (changes.length > 0) {
          store.applyChanges(changes);
        }
      } catch (e) {
        // no-op if store unavailable
      }
      setHasMore((response.images || []).length === 50);
      
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
  }, [group?.groupID, eventUrl, filterGroups, filterMode, onlySelected, isFetchingMore]);

  // Centralized effect for fetching all image and group data
  useEffect(() => {
    if (!group?.groupID) return;
    const sig = `${group.groupID}|${(filterGroups || []).join(',')}|${filterMode}|${onlySelected ? '1' : '0'}`;
    if (sig === lastFetchSignatureRef.current) return;
    const isGroupChange = prevGroupIdRef.current !== group.groupID;
    prevGroupIdRef.current = group.groupID;
    // If this is only a filter change, do a silent fetch and preserve scroll
    if (!isGroupChange) {
      suppressSpinnerRef.current = true;
      try { restoreScrollYRef.current = window.scrollY; } catch {}
    } else {
      suppressSpinnerRef.current = false;
      restoreScrollYRef.current = null;
    }
    lastFetchSignatureRef.current = sig;
    setOffset(0);
    fetchGroupData(0, true);
  }, [group?.groupID, filterGroups, filterMode, onlySelected]); // Re-run whenever the main group or filters change

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


  // Determine if an image is in Favorites, with a fallback to album labels
  const isImageFavorite = (img) => favoritesSet.has(img?.id);

  // Unified favorites toggle for single or multiple images
  const toggleFavoritesForIds = async (imageIds) => {
    if (!Array.isArray(imageIds) || imageIds.length === 0) return;
    const selectedImageObjects = sortedImages.filter(img => imageIds.includes(img.id));
    const allAreFavorites = selectedImageObjects.length > 0 && selectedImageObjects.every(isImageFavorite);

    try {
      if (allAreFavorites) {
        const res = await albumsAPI.toggleFavorite(imageIds, true, eventUrl);
        const removed = Array.isArray(res.removed_ids) ? res.removed_ids.length : (res.removed || 0);
        showToast(
          <span>
            {removed} removed from <Link to={`/${eventUrl}/albums/${encodeURIComponent('Favorites')}`} className="underline hover:text-gray-100">Favorites</Link>
          </span>,
          'success'
        );
      } else {
        const res = await albumsAPI.toggleFavorite(imageIds, false, eventUrl);
        const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
        showToast(
          <span>
            {added} added to <Link to={`/${eventUrl}/albums/${encodeURIComponent('Favorites')}`} className="underline hover:text-gray-100">Favorites</Link>
          </span>,
          'success'
        );
      }
    } catch (e) { showToast('Failed to update favorites', 'error'); }
  };

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

  const handleAddSelectedToBucket = async () => {
    if (selectedImages.size === 0) return;
    const added = addImages(Array.from(selectedImages));
    if (added > 0) {
      showToast(<span>{added} added to <Link to={`/${eventUrl}/albums/${encodeURIComponent('bucket')}`} className="underline hover:text-gray-100">bucket</Link></span>, 'success');
    } else {
      showToast('No new items added', 'success');
    }
    open();
  };

  // Add to album quick action
  const handleAddSelectedToAlbum = async (album) => {
    if (selectedImages.size === 0) return;
    try {
      const res = await albumsAPI.addImages(album.albumID, Array.from(selectedImages), eventUrl);
      const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
      showToast(
        <span>
          {added} added to{' '}
          <Link to={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="underline hover:text-gray-100">{album.label}</Link>
        </span>,
        'success'
      );
    } catch (e) {
      showToast('Failed to add to album', 'error');
    }
  };

  const getSelectedFaceIds = () => {
    const selectedFaceIds = new Set();
    for (const imageId of selectedImages) {
      const image = sortedImages.find(p => p.id === imageId);
      if (image && image.faces) {
        image.faces.forEach(face => {
          if (face.group_id === group.groupID) {
            selectedFaceIds.add(face.face_id);
          }
        });
      }
    }
    return Array.from(selectedFaceIds);
  };

  const handleTransferFaces = () => {
          if (selectedImages.size === 0) {
      showToast('Please select photos to transfer', 'error');
      return;
    }
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    const transferData = { ...(result || {}) };
    transferData.old_group_id = transferData.old_group_id || group?.groupID || null;

    // Clear selection and remove transferred images from the local cache used by selection
    clearSelection();
    if (transferData) {
      clearTransferredImagesFromCache(transferData.old_group_id, transferData.images_to_remove_from_source);
    }

    // Rely on API responses to update the normalized store; no manual store edits or navigation here
    if (transferData?.target_group_id) {
      let targetGroup = currentGroups.find(g => g.groupID === transferData.target_group_id);
      if (!targetGroup && transferData.new_group_name) {
        targetGroup = { groupID: transferData.target_group_id, label: transferData.new_group_name };
      }
      if (targetGroup) {
        const link = `/${eventUrl}/persons/${encodeURIComponent(targetGroup.label)}`;
        showToast(
          <span>
            Transferred {transferData.images_to_remove_from_source?.length || 0} faces to{' '}
            <Link to={link} className="underline hover:text-gray-100">{targetGroup.label}</Link>
          </span>,
          'success'
        );
      }
    }
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
    openGlobalViewer({
      images: sortedImages.map(p => p.id),
      index,
      eventUrl,
      groups: currentGroups,
      currentGroupId: group.groupID,
      showToast,
      onTransferComplete: handleTransferComplete,
      onJumpToMoment: (momentInfo) => timelineManager.navigateToMoment(momentInfo.label, momentInfo.label),
      image: imageId,
    });
  };

  

  const navigateImage = (direction, index) => {
    navigateGlobalViewer(direction, index);
  };

  const handleTitleEdit = () => {
    setEditingTitle(group.label || `Person ${group.groupID}`);
    setIsEditingTitle(true);
    clearConflict(); // Clear any previous conflict
  };

  const handleTitleSave = async () => {
    // Check if the current group still exists in the store
    const currentGroups = useDataStore.getState().groups;
    const groupExists = currentGroups.some(g => g.groupID === group?.groupID);
    
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
      const conflictResult = await groupsAPI.checkName(trimmedTitle, group.groupID, eventUrl);
      
      if (conflictResult.conflict) {
        // Show merge conflict modal with the conflicting group
        showMergeConflictModal(trimmedTitle, group, conflictResult.conflicting_group);
        setIsEditingTitle(false);
        return;
      }
      
      // No conflict, proceed with update
      await optimisticUpdates.updateGroup(group.groupID, { label: trimmedTitle });
      
      // Update the URL to reflect the new group name
              const newUrl = `/${eventUrl}/persons/${encodeURIComponent(trimmedTitle)}`;
      window.history.replaceState(null, '', newUrl);
      
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
                  key={group.representative_face || 'no-representative'}
                  src={group.representative_face && group.representative_face.trim() !== '' && urlHelpers
                    ? urlHelpers.getFaceCropUrl(group.representative_face)
                    : PLACEHOLDER_DATA_URL}
                  alt={group.label || `Person ${group.groupID}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = PLACEHOLDER_DATA_URL;
                  }}
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
                      {group.label || `Person ${group.groupID}`}
                    </h1>
                  </div>
                )}
              </div>
              <div className="relative">
                <p className="text-gray-600">
                  {sortedImages.length} of {group.count || 0} images
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
            
            {/* Group 2: Zoom, List/Grid, Crops */}
            <div className="flex items-center space-x-3 px-4">
              {viewMode === 'grid' && (
                <>
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
                </>
              )}

              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              >
                {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
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
              currentGroupId={group?.groupID}
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
              className={`w-full ${viewMode === 'grid' ? 'photo-gallery-grid' : 'space-y-4 max-w-3xl mx-auto block'}`}
              style={viewMode === 'grid' ? {
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(100, 266 * imageSize)}px`
              } : {}}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {sortedImages.map((image, index) => (
                <motion.div
                  key={image.id || `unknown-${index}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className={`${viewMode === 'grid' ? `photo-card ${imageClasses[image.id] || 'square'}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
                >
                  {viewMode === 'grid' ? (
                    <SingleImageTile
                      image={image}
                      aspectClass={imageClasses[image.id] || 'square'}
                      imageFit={'cover'}
                      thumbSrc={showCrops && image.representative_face && urlHelpers ? urlHelpers.getFaceCropUrl(image.representative_face) : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                      selectionMode={selectionMode}
                      isSelected={selectedImages.has(image.id)}
                      onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                      onOpen={() => openImageViewer(image.id, index)}
                      isFavorite={favoritesSet.has(image.id)}
                      onToggleFavorite={async () => { const id = image.id; await toggleFavoritesForIds([id]); }}
                      isArchived={archiveSet.has(image.id)}
                      onToggleArchive={async (isRemove) => {
                        try {
                          if (isRemove) {
                            const res = await albumsAPI.toggleArchive([image.id], true, eventUrl);
                            showToast(
                              <span>
                                {(Array.isArray(res.removed_ids) ? res.removed_ids.length : (res.removed || 0))} removed from{' '}
                                <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
                              </span>,
                              'success'
                            );
                          } else {
                            const res = await albumsAPI.addToArchive([image.id], eventUrl);
                            showToast(
                              <span>
                                {(Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0))} moved to{' '}
                                <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
                              </span>,
                              'success'
                            );
                          }
                        } catch (err) { showToast('Failed to update archive', 'error'); }
                      }}
                      onImageLoad={(e) => handleImageLoad(image.id, e)}
                      dateLabel={formatDate(image.date_taken)}
                      showDate={!!image.date_taken}
                      showCropBadge={showCrops && !!image.representative_face}
                    />
                  ) : (
                    <SingleImageRow
                      image={image}
                      thumbSrc={showCrops && image.representative_face && urlHelpers ? urlHelpers.getFaceCropUrl(image.representative_face) : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                      isSelected={selectedImages.has(image.id)}
                      onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                      onOpen={() => openImageViewer(image.id, index)}
                      rightContent={showCrops && image.representative_face ? (
                        <div className="bg-primary-600 text-white text-xs px-1 py-0.5 rounded-full">C</div>
                      ) : null}
                    />
                  )}
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
        onAddToBucket={handleAddSelectedToBucket}
        onToggleFavorites={async () => {
          if (selectedImages.size === 0) return;
          await toggleFavoritesForIds(Array.from(selectedImages));
        }}
        onMoveToArchive={async () => {
          if (selectedImages.size === 0) return;
          try {
            const res = await albumsAPI.addToArchive(Array.from(selectedImages), eventUrl);
            const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
            // Remove archived from selection immediately
            deselectMany(Array.from(selectedImages));
            showToast(
              <span>
                {added} moved to{' '}
                <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
              </span>,
              'success'
            );
          } catch (e) {
            showToast('Failed to move to archive', 'error');
          }
        }}
        onTransferFaces={handleTransferFaces}
        eventUrl={eventUrl}
        showToast={showToast}
        urlHelpers={urlHelpers}
        placeholderDataUrl={PLACEHOLDER_DATA_URL}
        showTransferFaces={false} // Filter functionality removed
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
            const result = await optimisticUpdates.updateGroup(group.groupID, updates, eventUrl);
            
            // Update the URL if the group name changed
            if (updates.label && updates.label !== group.label) {
              const newUrl = `/${eventUrl}/persons/${encodeURIComponent(updates.label)}`;
              window.history.replaceState(null, '', newUrl);
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

             {/* Image Viewer handled globally via ImageViewerProvider */}

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
            const targetGroup = currentGroups.find(g => g.groupID === targetGroupId);
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
           selectedFaces={Array.from(getSelectedFaceIds())}
           onTransferComplete={handleTransferComplete}
           showToast={showToast}
         />
       )}
    </div>
  );
}