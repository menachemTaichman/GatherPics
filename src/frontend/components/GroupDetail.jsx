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
import { groupsAPI, handleAPIError, optimisticUpdates, API_BASE, albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { clearTransferredImagesFromCache } from '../utils/selection';
import timelineManager from '../utils/timeline';
import useBucketStore from '../utils/bucketStore';
import { Plus as PlusIcon, Heart as HeartIcon } from 'lucide-react';
import SingleImageTile from './SingleImageTile';
import SingleImageRow from './SingleImageRow';
import GroupsFilter from './GroupsFilter';

export default function GroupDetail({ groups, onDeleteGroup, showToast, onRefreshGroups }) {
  const { group_name, eventUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { urlHelpers, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
  const [group, setGroup] = useState(null);
  const skipNextFetch = useRef(false);
  const [viewMode, setViewMode] = useSetting('groupDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [sortedImages, setSortedImages] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
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

  // Memoize props for GroupsFilter to prevent infinite re-renders
  const memoizedImageIds = useMemo(() => sortedImages.map(img => img.id), [sortedImages]);
  const memoizedRelatedGroups = useMemo(() => relatedGroups.filter(g => g.groupID !== group?.groupID), [relatedGroups, group?.groupID]);
  
  // No complex flag checking needed - the data store handles everything

  // Use the data store for groups
  const { groups: storeGroups, updateGroup: storeUpdateGroup, deleteGroup: storeDeleteGroup, replaceGroup } = useDataStore();

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

  useEffect(() => {
    const groupsArray = currentGroups?.groups || currentGroups;
    const foundGroup = groupsArray.find(g => g.label === group_name);
    if (foundGroup) {
      setGroup(foundGroup);
    } else if (group && group.groupID) {
      // If we have a group but the label doesn't match the URL, 
      // it might be because we just updated the group name
      // Don't redirect in this case
      return;
    } else {
      navigate(`/${eventUrl}/persons`);
    }
  }, [group_name, currentGroups, navigate, group]);

  // Re-sort images when sort settings change
  useEffect(() => {
            setSortedImages(prevImages => sortImages(prevImages, sortBy, sortOrder));
  }, [sortBy, sortOrder]);

  // Subscribe to global groups state changes to keep local images in sync
  useEffect(() => {
    const unsubscribe = useDataStore.subscribe(
      (state) => {
        // Handle images refresh events (favorites/archive)
        const imgRefresh = state.lastImagesRefresh;
        if (imgRefresh && imgRefresh.imageIds) {
          const affected = new Set(imgRefresh.imageIds || []);
          if (imgRefresh.album_label === 'favorites') {
            setSortedImages(prev => prev.map(img => affected.has(img.id) ? { ...img, is_favorite: imgRefresh.isAdd } : img));
          }
          if (imgRefresh.album_label === 'archive') {
            if (imgRefresh.isAdd) {
              // Archiving: either remove from grid (if not including archived) or mark as archived
              if (!getSetting('include_archived_images', false)) {
                setSortedImages(prev => {
                  const next = prev.filter(img => !affected.has(img.id));
                  // If viewer is open and current image was removed, close it
                  try {
                    if (isViewerOpen && currentImageId && affected.has(currentImageId)) {
                      closeGlobalViewer();
                    }
                  } catch {}
                  return next;
                });
              } else {
                setSortedImages(prev => prev.map(img => affected.has(img.id) ? { ...img, is_archived: true } : img));
              }
            } else {
              // Unarchive
              setSortedImages(prev => prev.map(img => affected.has(img.id) ? { ...img, is_archived: false } : img));
            }
          }
        }

        // Handle images to remove from album add
        const albumAddResult = state.lastAlbumAdd;
        if (albumAddResult && albumAddResult.images_to_remove && albumAddResult.images_to_remove.length > 0) {
            const removedSet = new Set(albumAddResult.images_to_remove);
            setSortedImages(prev => prev.filter(img => !removedSet.has(img.id)));
            // Reset after processing
            useDataStore.getState().addImagesToAlbum(null); 
        }

        // Handle transfer results
        const transferResult = state.lastTransferResult;
        if (transferResult) {
          // If the source group was deleted (complete transfer/merge),
          // ignore local remove/add to prevent flicker; the complete
          // transfer handler will load authoritative target data.
          if (transferResult.old_group_deleted) {
            // No-op here; handled in handleTransferComplete
          } else {
          // If this is the source group, remove images that should be removed
          if (transferResult.old_group_id === group?.groupID && transferResult.images_to_remove_from_source) {
            setSortedImages(prevImages => {
              const removedSet = new Set(transferResult.images_to_remove_from_source);
              const updatedImages = prevImages.filter(image => !removedSet.has(image.id));

              // If viewer is open and current image was removed, move to the next logical image
              try {
                if (isViewerOpen && currentImageId && removedSet.has(currentImageId)) {
                  if (updatedImages.length === 0) {
                    closeGlobalViewer();
                  } else {
                    const newIndex = Math.min(viewerIndex || 0, updatedImages.length - 1);
                    updateViewerSession({ images: updatedImages.map(i => i.id), index: newIndex });
                  }
                }
              } catch {}

              return updatedImages;
            });
          }
          // If this is the target group, add images that should be added
          else if (transferResult.target_group_id === group?.groupID && transferResult.images_to_add_to_target) {
            // Use the full image data from the transfer result
            if (transferResult.transferred_images_data && transferResult.transferred_images_data.length > 0) {
              setSortedImages(prevImages => {
                // Create a map of existing image IDs for efficient lookup
                const existingImageIds = new Set(prevImages.map(image => image.id));
                
                // Filter out images that already exist in the current array
              const newImages = transferResult.transferred_images_data.filter(
                image => !existingImageIds.has(image.id) && transferResult.images_to_add_to_target.includes(image.id)
              );
                
                            // Add only new images and sort them
            const updatedImages = [...prevImages, ...newImages];
            return sortImages(updatedImages, sortBy, sortOrder);
          });
        }
        // Update crop data by adding crops for new images if available in transfer result
        if (transferResult.crop_mapping) {
          // This part of the logic is no longer needed as representative_face is used directly
          // setImageCrops(prevCrops => ({
          //   ...prevCrops,
          //   ...transferResult.crop_mapping
          // }));
        }
      }
          }
        }
        
        // Handle group updates (including name and representative changes)
        const updatedGroup = state.groups.find(g => g.groupID === group?.groupID);
        if (updatedGroup && group) {
                  const hasChanges = 
          updatedGroup.label !== group.label ||
          updatedGroup.representative_face !== group.representative_face;
          
          if (hasChanges) {
            setGroup(updatedGroup);
          }
        }
        
        // Also check if this group was updated in a transfer result
        if (transferResult && transferResult.updated_source_group && transferResult.updated_source_group.groupID === group?.groupID) {
          setGroup(transferResult.updated_source_group);
        }
      }
    );
    
    return unsubscribe;
  }, [group?.groupID, sortBy, sortOrder, navigate, isViewerOpen, currentImageId, viewerIndex]);

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
      
      setGroup(prev => ({...prev, ...response.group}));
      
      const sorted = sortImages(response.images || [], sortBy, sortOrder);
      if (resetImages || currentOffset === 0) {
        setSortedImages(() => {
          const seen = new Set();
          const unique = [];
          for (const img of sorted) {
            const id = img?.id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            unique.push(img);
          }
          return unique;
        });
      } else {
        // merge without full reset to avoid grid flicker and dedupe by id
        setSortedImages(prev => {
          const seen = new Set(prev.map(i => i?.id).filter(Boolean));
          const merged = [...prev];
          for (const img of sorted) {
            const id = img?.id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            merged.push(img);
          }
          return merged;
        });
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
  }, [group?.groupID, eventUrl, sortBy, sortOrder, filterGroups, filterMode, onlySelected, isFetchingMore]);

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
    // Re-sort current images with new order
            setSortedImages(prevImages => sortImages(prevImages, sortBy, newOrder));
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
  const isImageFavorite = (img) => {
    if (!img) return false;
    if (img.is_favorite !== undefined && img.is_favorite !== null) {
      return !!img.is_favorite;
    }
    if (img.is_favorites !== undefined && img.is_favorites !== null) {
      return !!img.is_favorites;
    }
    return Array.isArray(img.albums) && img.albums.some(a => (a || '').toLowerCase() === 'favorites');
  };

  // Unified favorites toggle for single or multiple images
  const toggleFavoritesForIds = async (imageIds) => {
    if (!Array.isArray(imageIds) || imageIds.length === 0) return;
    const selectedImageObjects = sortedImages.filter(img => imageIds.includes(img.id));
    const allAreFavorites = selectedImageObjects.length > 0 && selectedImageObjects.every(isImageFavorite);

    // Optimistic update
    setSortedImages(prevImages =>
      prevImages.map(img =>
        imageIds.includes(img.id) ? { ...img, is_favorite: !allAreFavorites } : img
      )
    );

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
    } catch (e) {
      // Rollback on error
      showToast('Failed to update favorites', 'error');
      setSortedImages(prev => {
        const newImages = [...prev];
        selectedImageObjects.forEach(originalImage => {
          const index = newImages.findIndex(i => i.id === originalImage.id);
          if (index !== -1) {
            newImages[index] = originalImage;
          }
        });
        return newImages;
      });
    }
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
    // Use the full API result which contains transfer metadata
    const transferData = { ...(result || {}) };
    // Ensure old_group_id is present for downstream logic
    transferData.old_group_id = transferData.old_group_id || group?.groupID || null;
    // Push transfer result into the global store to trigger grid updates
    try {
      useDataStore.getState().transferFaces(transferData);
    } catch (e) {
      console.warn('Failed to update store after transfer:', e);
    }
    const isCompleteTransfer = !!transferData.old_group_deleted;

    // Clear selection and remove transferred images from cache
    clearSelection();
    
    // If images were transferred away from this group, remove them from the cached selection
    if (transferData) {
      clearTransferredImagesFromCache(transferData.old_group_id, transferData.images_to_remove_from_source);
    }

    if (isCompleteTransfer) {
      skipNextFetch.current = true; // Prevent fetch on next group change
      // 1. Remove source group from store
      if (transferData.old_group_id) {
        useDataStore.getState().deleteGroup(transferData.old_group_id);
      }
      // 2. Add/update target group in store
      if (transferData.updated_target_group) {
        useDataStore.getState().replaceGroup(transferData.target_group_id, transferData.updated_target_group);
      }
      // 3. Update UI to show target group
      const newGroup = transferData.updated_target_group;
      setGroup(newGroup);
      // 4. Fetch full, authoritative data for the target group to avoid client-side drift
      try {
        const response = await groupsAPI.getById(newGroup.groupID, eventUrl);
        const images = response.images || [];
        setSortedImages(sortImages(images, sortBy, sortOrder));
      } catch (err) {
        console.error('Error fetching target group images after merge:', err);
      }
      setLoading(false); // Ensure spinner is not shown
      if (newGroup && newGroup.label) {
        navigate(`/${eventUrl}/persons/${encodeURIComponent(newGroup.label)}`, { replace: true });
      }
      showToast('All faces transferred. Now viewing the merged group.', 'success');
      return;
    }
    
    // For partial transfers, just show success message
    if (transferData?.target_group_id) {
      // For new groups, construct the target group info from the transfer data
      let targetGroup = currentGroups.find(g => g.groupID === transferData.target_group_id);
      if (!targetGroup && transferData.new_group_name) {
        targetGroup = {
          groupID: transferData.target_group_id,
          label: transferData.new_group_name
        };
      }
      
      if (targetGroup) {
        const link = `/${eventUrl}/persons/${encodeURIComponent(targetGroup.label)}`;
        const isNewGroup = transferData.new_group_name;
        showToast(
          <span>
            Transferred {transferData.images_to_remove_from_source?.length || 0} faces to{' '}
            {isNewGroup && 'a new group '}
            <Link to={link} className="underline hover:text-gray-100">
              {targetGroup.label}
            </Link>
          </span>,
          'success'
        );
      }
    }
    
    // The change instruction system will handle all updates automatically
    // No need for manual updates here - the API service interceptor
    // will process the GROUP_FACES_TRANSFERRED change instruction
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

  const closeImageViewer = () => {};

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
                      imageFit={showCrops ? 'contain' : 'cover'}
                      thumbSrc={showCrops && image.representative_face && urlHelpers ? urlHelpers.getFaceCropUrl(image.representative_face) : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                      selectionMode={selectionMode}
                      isSelected={selectedImages.has(image.id)}
                      onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                      onOpen={() => openImageViewer(image.id, index)}
                      isFavorite={isImageFavorite(image)}
                      onToggleFavorite={async () => { const id = image.id; await toggleFavoritesForIds([id]); }}
                      isArchived={!!image.is_archived}
                      onToggleArchive={async (isRemove) => {
                        try {
                          if (isRemove) {
                            const res = await albumsAPI.toggleArchive([image.id], true, eventUrl);
                            setSortedImages(prev => prev.map(img => img.id === image.id ? { ...img, is_archived: false } : img));
                            showToast(
                              <span>
                                {(Array.isArray(res.removed_ids) ? res.removed_ids.length : (res.removed || 0))} removed from{' '}
                                <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
                              </span>,
                              'success'
                            );
                          } else {
                            const res = await albumsAPI.addToArchive([image.id], eventUrl);
                            if (!getSetting('include_archived_images', false)) {
                              setSortedImages(prev => prev.filter(img => img.id !== image.id));
                            } else {
                              setSortedImages(prev => prev.map(img => img.id === image.id ? { ...img, is_archived: true } : img));
                            }
                            showToast(
                              <span>
                                {(Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0))} moved to{' '}
                                <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
                              </span>,
                              'success'
                            );
                          }
                        } catch (err) {
                          showToast('Failed to update archive', 'error');
                        }
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