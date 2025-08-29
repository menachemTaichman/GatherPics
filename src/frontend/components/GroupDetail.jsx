import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  Edit, 
  User, 
  Image as ImageIcon, 
  Grid, 
  List,
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus,
  Crop,
  Check,
  CheckCheck,
  X,
  AlertTriangle,
  Users,
  Square,
  CheckSquare,
  ShoppingBag
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import ImageViewer from './ImageViewer';
import MergeConflictModal from './MergeConflictModal';
import TransferFacesModal from './TransferFacesModal';
import GroupsFilter from './GroupsFilter';
import { sortImages, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { getSetting, setSetting } from '../utils/settings';
import { useGroupNameConflict } from '../utils/useGroupNameConflict';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, handleAPIError, optimisticUpdates, FIXED_EVENT_ID, API_BASE, urlHelpers } from '../utils/apiService';
import { clearTransferredImagesFromCache } from '../utils/selection';
import timelineManager from '../utils/timeline';

export default function GroupDetail({ groups, onDeleteGroup, showToast, onRefreshGroups }) {
  const { group_name } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [group, setGroup] = useState(null);
  const skipNextFetch = useRef(false);
  const [viewMode, setViewMode] = useSetting('groupDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [lastSelectedImage, setLastSelectedImage] = useState(null);
  
  // Load selected images from cache when group changes
  useEffect(() => {
    if (group?.groupID) {
      const cachedSelection = getSetting(`groupDetail_selection_${group.groupID}`);
      if (cachedSelection && Array.isArray(cachedSelection)) {
        setSelectedImages(new Set(cachedSelection));
      } else {
        setSelectedImages(new Set());
      }
      setLastSelectedImage(null);
    }
  }, [group?.groupID]);
  
  // Save selection to cache whenever it changes
  useEffect(() => {
    if (group?.groupID && selectedImages.size > 0) {
      setSetting(`groupDetail_selection_${group.groupID}`, Array.from(selectedImages));
    } else if (group?.groupID && selectedImages.size === 0) {
      // Clear cache when selection is empty
      try {
        localStorage.removeItem(`face_gallery_settings_groupDetail_selection_${group.groupID}`);
      } catch (error) {
        console.warn('Failed to clear selection cache:', error);
      }
    }
  }, [selectedImages, group?.groupID]);
  const [imageViewer, setImageViewer] = useState({ show: false, image: null, index: 0 });
  const [imageClasses, setImageClasses] = useState({});
  const [sortedImages, setSortedImages] = useState([]);
  const [sortBy, setSortBy] = useSetting('groupDetail_sortBy', 'date');
  const [sortOrder, setSortOrder] = useSetting('groupDetail_sortOrder', 'asc');
  const [loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useSetting('groupDetail_imageSize', 1.0);
  const [showCrops, setShowCrops] = useState(false);
  const [imageCrops, setImageCrops] = useState({});
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [selectionMode, setSelectionMode] = useSetting('selectionMode', false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  
  // Filter state
  const [filterGroups, setFilterGroups] = useState([]);
  const [filterMode, setFilterMode] = useState('and');
  const [onlySelected, setOnlySelected] = useState(false);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const [filterVisible, setFilterVisible] = useSetting('groupDetail_filterVisible', true);
  const [filterLoading, setFilterLoading] = useState(false);
  
  // No complex flag checking needed - the data store handles everything

  // Use the data store for groups
  const { groups: storeGroups, updateGroup: storeUpdateGroup, deleteGroup: storeDeleteGroup, replaceGroup } = useDataStore();

  // Use groups from store if available, otherwise fall back to props
  const currentGroups = storeGroups.length > 0 ? storeGroups : groups;

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

    // Store group names for later restoration when relatedGroups are loaded
    if (groupNames) {
      // We'll restore these when relatedGroups are available
      // Store them in a ref to avoid dependency issues
      window.__pendingFilterGroups = groupNames.split(',');
    }
  }, []); // Empty dependency array - only run once on mount

  // Restore filter groups from URL once relatedGroups are loaded
  useEffect(() => {
    if (relatedGroups.length === 0 || !window.__pendingFilterGroups) return;
    
    const groupNames = window.__pendingFilterGroups;
    const groupIds = groupNames
      .map(name => relatedGroups.find(g => g.label === name)?.groupID)
      .filter(Boolean); // Filter out any undefineds if a group isn't found
    
    // Only set filter groups if we found matching groups
    if (groupIds.length > 0) {
      setFilterGroups(groupIds);
    }
    
    // Clear the pending groups
    delete window.__pendingFilterGroups;
  }, [relatedGroups]); // Only depend on relatedGroups, not location.search

  // Fallback: Try to restore filter groups from main groups list if relatedGroups aren't loaded yet
  useEffect(() => {
    if (currentGroups.length === 0 || !window.__pendingFilterGroups) return;
    
    const groupNames = window.__pendingFilterGroups;
    const groupIds = groupNames
      .map(name => currentGroups.find(g => g.label === name)?.groupID)
      .filter(Boolean)
      .filter(id => id !== group?.groupID); // Exclude the main group
    
    if (groupIds.length > 0) {
      setFilterGroups(groupIds);
      // Clear the pending groups
      delete window.__pendingFilterGroups;
    }
  }, [currentGroups, group?.groupID]);

  // Cleanup pending filter groups on unmount
  useEffect(() => {
    return () => {
      if (window.__pendingFilterGroups) {
        delete window.__pendingFilterGroups;
      }
    };
  }, []);

  // Update URL when filter state changes
  useEffect(() => {
    // Skip URL updates during initial load to avoid conflicts with URL restoration
    if (window.__pendingFilterGroups) {
      return;
    }
    
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
          .map(id => relatedGroups.find(g => g.groupID === id)?.label)
          .filter(Boolean)
          .join(',');
        if (groupNames) {
          searchParams.set('filterGroups', groupNames);
        }
      } else {
        // If relatedGroups aren't loaded yet, try to get names from currentGroups as fallback
        const groupNames = filterGroups
          .map(id => currentGroups.find(g => g.groupID === id)?.label)
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
    window.history.replaceState(null, '', newUrl);
  }, [filterGroups, filterMode, onlySelected, relatedGroups, location.pathname, currentGroups, group?.label]);

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
  } = useGroupNameConflict(group, onRefreshGroups);

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
      navigate('/');
    }
  }, [group_name, currentGroups, navigate, group]);

  useEffect(() => {
    if (group) {
    }
  }, [group]);

  // Re-sort images when sort settings change
  useEffect(() => {
            setSortedImages(prevImages => sortImages(prevImages, sortBy, sortOrder));
  }, [sortBy, sortOrder]);

  // Subscribe to global groups state changes to keep local images in sync
  useEffect(() => {
    const unsubscribe = useDataStore.subscribe(
      (state) => {
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
              if (imageViewer.show && removedSet.has(imageViewer.image)) {
                if (updatedImages.length === 0) {
                  setImageViewer({ show: false, image: null, index: 0 });
                } else {
                  const newIndex = Math.min(imageViewer.index, updatedImages.length - 1);
                  const newImageId = updatedImages[newIndex].id;
                  setImageViewer({ show: true, image: newImageId, index: newIndex });
                }
              }

              return updatedImages;
            });
            // Update crop data by removing crops for transferred images
            setImageCrops(prevCrops => {
              const newCrops = { ...prevCrops };
                           transferResult.images_to_remove_from_source.forEach(imageId => {
               delete newCrops[imageId];
             });
              return newCrops;
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
          setImageCrops(prevCrops => ({
            ...prevCrops,
            ...transferResult.crop_mapping
          }));
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
  }, [group?.groupID, sortBy, sortOrder, navigate, imageViewer]); // include imageViewer for accurate updates

  // Fetch crop data when group changes - only on initial load or manual refresh
  useEffect(() => {
    if (group && group.groupID !== undefined && group.groupID !== null) {
      // Fetch normally - no merge logic needed since we only use transfer
      fetchGroupCrops();
    }
  }, [group?.groupID]); // Only when group changes (initial load or navigation)

  const fetchGroupCrops = async () => {
    if (!group?.groupID) {
      return;
    }
    
    try {
      const response = await groupsAPI.getCrops(group.groupID);
      setImageCrops(response.crops || {});
    } catch (error) {
      console.error('Error fetching group crops:', error);
      setImageCrops({});
    }
  };

  const fetchFilteredImages = async () => {
    if (!group?.groupID) {
      return;
    }
    
    try {
      setFilterLoading(true);
      
             // For now, use the basic images endpoint since the filtered endpoint expects different parameters
      // TODO: Update backend to support the filtering parameters we need
      const response = await groupsAPI.getImagesComplete(group.groupID);
      
      if (response && response.images) {
        let filteredImages = response.images;
        
        // Apply frontend filtering logic
        if (filterGroups.length > 0) {
          if (filterMode === 'and') {
            // All filter groups must be present
            filteredImages = filteredImages.filter(image => {
              const imageGroupIds = new Set(image.faces?.map(f => f.group_id).filter(Boolean) || []);
              return filterGroups.every(groupId => imageGroupIds.has(groupId));
            });
          } else {
            // Any filter group can be present
            filteredImages = filteredImages.filter(image => {
              const imageGroupIds = new Set(image.faces?.map(f => f.group_id).filter(Boolean) || []);
              return filterGroups.some(groupId => imageGroupIds.has(groupId));
            });
          }
        }
        
        // Apply onlySelected filter
        if (onlySelected) {
          filteredImages = filteredImages.filter(image => 
            selectedImages.has(image.id)
          );
        }
        
        // Sort the filtered images
        const sortedFilteredImages = sortImages(filteredImages, sortBy, sortOrder);
        setSortedImages(sortedFilteredImages);
        
        // Extract related groups from the images
        const relatedGroupIds = new Set();
        filteredImages.forEach(image => {
          image.faces?.forEach(face => {
            if (face.group_id && face.group_id !== group.groupID) {
              relatedGroupIds.add(face.group_id);
            }
          });
        });
        
        const relatedGroupObjects = Array.from(relatedGroupIds)
          .map(id => currentGroups.find(g => g.groupID === id))
          .filter(Boolean); // Filter out any groups not found
        
        setRelatedGroups(relatedGroupObjects);
      }

    } catch (error) {
      console.error('Error fetching filtered images:', error);
      // On error, fall back to basic images
      await fetchBasicImages();
      setRelatedGroups([]);
    } finally {
      setFilterLoading(false);
    }
  };

  const fetchBasicImages = async () => {
    if (!group?.groupID) return;
    
    try {
      const response = await groupsAPI.getImagesComplete(group.groupID);
      if (response && response.images) {
        const sortedImages = sortImages(response.images, sortBy, sortOrder);
        setSortedImages(sortedImages);
      }
    } catch (error) {
      console.error('Error fetching basic images:', error);
    }
  };

  const handleFilterChange = (newFilterGroups) => {
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
    
    // Clear pending filter groups to prevent conflicts
    if (window.__pendingFilterGroups) {
      delete window.__pendingFilterGroups;
    }
    
    // Clear URL parameters
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('filterMode');
    searchParams.delete('filterGroups');
    searchParams.delete('only');
    const newUrl = `${location.pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    window.history.replaceState(null, '', newUrl);
  };

  const handleFilterVisibilityToggle = () => {
    setFilterVisible(!filterVisible);
  };

  // Centralized effect for fetching all image and group data
  useEffect(() => {
    if (!group?.groupID) return;

    fetchFilteredImages();

  }, [filterGroups, filterMode, onlySelected, group?.groupID]); // Re-run whenever filters or the main group changes

  const getSortedImages = () => {
    return sortedImages;
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

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
    // Re-sort current images with new order
            setSortedImages(prevImages => sortImages(prevImages, sortBy, newOrder));
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



  const handleAddSelectedToBucket = async () => {
    // TODO: Implement add selected to bucket functionality
            alert(`Add ${selectedImages.size} selected images to bucket functionality will be implemented later`);
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
    const transferData = result.changes && result.changes.length > 0 ? result.changes[0].data : null;
    const isCompleteTransfer = transferData?.old_group_deleted;

    // Clear selection and remove transferred images from cache
    setSelectedImages(new Set());
    
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
        const response = await groupsAPI.getImagesComplete(newGroup.groupID);
        const images = response.images || [];
        setSortedImages(sortImages(images, sortBy, sortOrder));
      } catch (err) {
        console.error('Error fetching target group images after merge:', err);
      }
      try {
        const cropsResp = await groupsAPI.getCrops(newGroup.groupID);
        setImageCrops(cropsResp.crop_mapping || {});
      } catch (err) {
        console.error('Error fetching target group crops after merge:', err);
      }
      setLoading(false); // Ensure spinner is not shown
      if (newGroup && newGroup.label) {
        navigate(`/group/${encodeURIComponent(newGroup.label)}`, { replace: true });
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
        const link = `/group/${encodeURIComponent(targetGroup.label)}`;
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
    const newSelected = new Set(selectedImages);
    
    // Handle shift-click for range selection
    if (event?.shiftKey && lastSelectedImage && lastSelectedImage !== imageId) {
          const lastIndex = sortedImages.findIndex(p => p.id === lastSelectedImage);
    const currentIndex = sortedImages.findIndex(p => p.id === imageId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex);
        const endIndex = Math.max(lastIndex, currentIndex);
        
        // Add all images in the range
        for (let i = startIndex; i <= endIndex; i++) {
          newSelected.add(sortedImages[i].id);
        }
        setSelectedImages(newSelected);
        setLastSelectedImage(imageId);
        return;
      }
    }
    
    // Regular click - toggle the image
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    
            setSelectedImages(newSelected);
    setLastSelectedImage(imageId);
  };

  const selectAllImages = () => {
    setSelectedImages(new Set(sortedImages.map(p => p.id)));
    setLastSelectedImage(sortedImages.length > 0 ? sortedImages[sortedImages.length - 1].id : null);
  };

  const clearSelection = () => {
    setSelectedImages(new Set());
    setLastSelectedImage(null);
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
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
        handleFilterReset(); // Also reset filters on Escape
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedImages]);

  const openImageViewer = (imageId, index) => {
    // Use the image data directly since it comes from the API
    setImageViewer({
      show: true,
      image: imageId, // Store just the image_id string for consistency
      index: index
    });
  };

  const closeImageViewer = () => {
    setImageViewer({ show: false, image: null, index: 0 });
  };

  const navigateImage = (direction, index) => {
    const currentIndex = imageViewer.index;
    let newIndex;
    if (direction === 'jump' && typeof index === 'number') {
      newIndex = index;
    } else if (direction === 'next') {
              newIndex = Math.min(currentIndex + 1, sortedImages.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    setImageViewer({
      show: true,
              image: sortedImages[newIndex].id, // This is already correct
      index: newIndex
    });
  };

  const handleJumpToMoment = (momentInfo) => {
    timelineManager.navigateToMoment(momentInfo.label, momentInfo.label);
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
      const conflictResult = await groupsAPI.checkName(trimmedTitle, group.groupID);
      
      if (conflictResult.conflict) {
        // Show merge conflict modal with the conflicting group
        showMergeConflictModal(trimmedTitle, group, conflictResult.conflicting_group);
        setIsEditingTitle(false);
        return;
      }
      
      // No conflict, proceed with update
      await optimisticUpdates.updateGroup(group.groupID, { label: trimmedTitle });
      
      // Update the URL to reflect the new group name
      const newUrl = `/group/${encodeURIComponent(trimmedTitle)}`;
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
              to="/"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
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
                  src={group.representative_face && group.representative_face.trim() !== ''
                    ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.representative_face}.webp`
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
                  {sortedImages.length} of {group.image_ids?.length || 0} images
                  {showCrops && (
                    <span className="ml-2 text-primary-600 font-medium">
                      • Showing face crops
                    </span>
                  )}
                </p>
                {selectedImages.size > 0 && (
                  <p className="text-sm text-primary-600 font-medium absolute top-full left-0">
                    {selectedImages.size} selected
                  </p>
                )}
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
                      setimageSize(newPercent / 100);
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
                    onChange={e => setimageSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={e => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) val = Math.round(imageSize * 100);
                      val = Math.max(50, Math.min(300, val));
                      setimageSize(val / 100);
                      setimageSizeInputValue(undefined);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.target.blur();
                      } else if (e.key === 'Escape') {
                        setimageSizeInputValue(undefined);
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
                      setimageSize(newPercent / 100);
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

                        {/* Group 3: Selection Controls */}
            {sortedImages.length > 0 && viewMode === 'grid' && (
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
                {/* Select all button - only visible when checkboxes are shown AND not all are selected */}
                {selectionMode && selectedImages.size < sortedImages.length && (
                  <button
                    onClick={selectAllPhotos}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                      selectedImages.size > 0 
                        ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                    title="Select all photos (Ctrl+A)"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
                
                {/* Clear button - always visible when any images are selected, always red */}
                {selectedImages.size > 0 && (
                  <button
                    onClick={clearSelection}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center bg-red-100 text-red-700 hover:bg-red-200"
                    title="Clear selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Group 4: Actions on Selection */}
            {sortedImages.length > 0 && viewMode === 'grid' && selectedImages.size > 0 && (
              <div className="flex items-center space-x-3 px-4">
                {filterMode !== 'or' && (
                  <button
                    onClick={handleTransferFaces}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-orange-100 text-orange-700"
                    title="Change group for selected faces"
                  >
                    <Users className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={handleAddSelectedToBucket}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                  title="Add selected photos to bucket"
                >
                  <ShoppingBag className="w-4 h-4" />
                </button>
              </div>
            )}
            
            {/* List View Selection Controls - Always show when in list mode */}
            {sortedImages.length > 0 && viewMode === 'list' && (
              <>
                {/* Group 3: Selection Controls */}
                <div className="flex items-center space-x-3 px-4">
                  {/* Select all button - only visible when not all are selected */}
                  {selectedImages.size < sortedImages.length && (
                    <button
                      onClick={selectAllImages}
                                              className={`w-8 h-8 rounded transition-colors flex items-center justify-center ${
                          selectedImages.size > 0 
                            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                            : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      title="Select all photos (Ctrl+A)"
                    >
                      <CheckCheck className="w-4 h-4" />
                    </button>
                  )}
                  
                  {/* Clear button - always visible when any images are selected, always red */}
                  {selectedImages.size > 0 && (
                    <button
                      onClick={clearSelection}
                      className="w-8 h-8 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors flex items-center justify-center"
                      title="Clear selection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Group 4: Actions on Selection */}
                {selectedImages.size > 0 && (
                  <div className="flex items-center space-x-3 px-4">
                    {filterMode !== 'or' && (
                      <button
                        onClick={handleTransferFaces}
                        className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-orange-100 text-orange-700"
                        title="Change group for selected faces"
                      >
                        <Users className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleAddSelectedToBucket}
                      className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                                          title="Add selected photos to bucket"
                  >
                    <ShoppingBag className="w-4 h-4" />
                  </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Groups Filter - Now part of the header */}
        <AnimatePresence>
          {filterVisible && (
            <GroupsFilter
              group={group}
              relatedGroups={relatedGroups.filter(g => g.groupID !== group?.groupID)}
              selectedGroups={filterGroups}
              filterMode={filterMode}
              onlySelected={onlySelected}
              onFilterChange={handleFilterChange}
              onModeChange={handleFilterModeChange}
              onOnlySelectedChange={handleOnlySelectedChange}
              onReset={handleFilterReset}
              isVisible={filterVisible}
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
                key={`${image.id || 'unknown'}-${index}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className={`${viewMode === 'grid' ? `photo-card ${imageClasses[image.id] || 'square'}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
              >
                {viewMode === 'grid' ? (
                  <div className="relative group cursor-pointer h-full" onClick={(e) => {
                    if (!e.target.closest('input[type="checkbox"]')) {
                      openImageViewer(image.id, index);
                    }
                  }}>
                    <input
                      type="checkbox"
                      id={`image-checkbox-grid-${image.id}`}
                      name={`image-checkbox-grid-${image.id}`}
                      checked={selectedImages.has(image.id)}
                      onChange={() => {}} // Empty handler to satisfy React
                                             onClick={(e) => {
                         e.stopPropagation();
                         toggleImageSelection(image.id, e);
                       }}
                      className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                        viewMode === 'list' || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    />
                    <img
                      src={showCrops && imageCrops[image.id] 
                        ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[image.id]}.webp`
                        : `${API_BASE}/api/events/${FIXED_EVENT_ID}/thumb/${image.id}.webp`
                      }
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                      loading="lazy"
                      onLoad={(e) => handleImageLoad(image.id, e)}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = PLACEHOLDER_DATA_URL;
                      }}
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                        <ImageIcon className="w-8 h-8 mx-auto mb-1" />
                        <span className="text-sm">Click to view</span>
                      </div>
                    </div>
                    {/* Date overlay */}
                    {image.date_taken && (
                      <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                        {formatDate(image.date_taken)}
                      </div>
                    )}
                    {/* Crop indicator */}
                    {showCrops && imageCrops[image.id] && (
                      <div className="absolute top-2 right-2 bg-primary-600 text-white text-xs px-2 py-1 rounded">
                        Crop
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      id={`image-checkbox-list-${image.id}`}
                      name={`image-checkbox-list-${image.id}`}
                      checked={selectedImages.has(image.id)}
                      onChange={() => {}} // Empty handler to satisfy React
                                             onClick={(e) => {
                         toggleImageSelection(image.id, e);
                       }}
                      className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                    />
                    <div className="relative">
                      <img
                        src={showCrops && imageCrops[image.id] 
                          ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[image.id]}.webp`
                          : `${API_BASE}/api/events/${FIXED_EVENT_ID}/thumb/${image.id}.webp`
                        }
                        alt={`Photo ${index + 1}`}
                        className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                        loading="lazy"
                        onClick={(e) => {
                          if (!e.target.closest('input[type="checkbox"]')) {
                            openImageViewer(image.id, index);
                          }
                        }}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = PLACEHOLDER_DATA_URL;
                        }}
                      />
                      {/* Crop indicator for list view */}
                      {showCrops && imageCrops[image.id] && (
                        <div className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs px-1 py-0.5 rounded-full">
                          C
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{image.label}</p>
                      <p className="text-sm text-gray-500">
                        {image.date_taken ? formatDate(image.date_taken) : 'Unknown date'}
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Modals */}
      {showEditModal && (
        <EditGroupModal
          group={group}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            const result = await optimisticUpdates.updateGroup(group.groupID, updates);
            
            // Update the URL if the group name changed
            if (updates.label && updates.label !== group.label) {
              const newUrl = `/group/${encodeURIComponent(updates.label)}`;
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

             {/* Image Viewer */}
       {imageViewer.show && (
         <ImageViewer
           image={imageViewer.image}
           onClose={closeImageViewer}
           onNavigate={navigateImage}
           totalImages={sortedImages.length}
           currentIndex={imageViewer.index}
           currentGroupId={group.groupID}
           onJumpToMoment={handleJumpToMoment}
           groups={currentGroups}
           onTransferComplete={handleTransferComplete}
           showToast={showToast}
         />
       )}

      {/* Merge Conflict Modal */}
      {showMergeModal && conflictData && (
        <MergeConflictModal
          isOpen={showMergeModal}
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
              navigate(`/group/${encodeURIComponent(targetGroup.label)}`);
            } else {
              navigate('/');
            }
          }}
        />
      )}

             {/* Transfer Faces Modal */}
       {showTransferModal && (
         <TransferFacesModal
           isOpen={showTransferModal}
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