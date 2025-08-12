import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
import PhotoViewer from './PhotoViewer';
import MergeConflictModal from './MergeConflictModal';
import TransferFacesModal from './TransferFacesModal';
import GroupsFilter from './GroupsFilter';
import { sortPhotos, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { getSetting, setSetting } from '../utils/settings';
import { useGroupNameConflict } from '../utils/useGroupNameConflict';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, handleAPIError, optimisticUpdates } from '../utils/apiService';
import { clearTransferredPhotosFromCache } from '../utils/selection';

export default function FaceDetail({ groups, onDeleteGroup, showToast, onRefreshGroups }) {
  const { group_name } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const skipNextFetch = useRef(false);
  const [viewMode, setViewMode] = useSetting('faceDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [lastSelectedPhoto, setLastSelectedPhoto] = useState(null);
  
  // Load selected photos from cache when group changes
  useEffect(() => {
    if (group?.groupID) {
      const cachedSelection = getSetting(`faceDetail_selection_${group.groupID}`);
      if (cachedSelection && Array.isArray(cachedSelection)) {
        setSelectedPhotos(new Set(cachedSelection));
      } else {
        setSelectedPhotos(new Set());
      }
      setLastSelectedPhoto(null);
    }
  }, [group?.groupID]);
  
  // Save selection to cache whenever it changes
  useEffect(() => {
    if (group?.groupID && selectedPhotos.size > 0) {
      setSetting(`faceDetail_selection_${group.groupID}`, Array.from(selectedPhotos));
    } else if (group?.groupID && selectedPhotos.size === 0) {
      // Clear cache when selection is empty
      try {
        localStorage.removeItem(`face_gallery_settings_faceDetail_selection_${group.groupID}`);
      } catch (error) {
        console.warn('Failed to clear selection cache:', error);
      }
    }
  }, [selectedPhotos, group?.groupID]);
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0 });
  const [photoClasses, setPhotoClasses] = useState({});
  const [sortedPhotos, setSortedPhotos] = useState([]);
  const [sortBy, setSortBy] = useSetting('faceDetail_sortBy', 'date');
  const [sortOrder, setSortOrder] = useSetting('faceDetail_sortOrder', 'asc');
  const [loading, setLoading] = useState(false);
  const [photoSize, setPhotoSize] = useSetting('faceDetail_photoSize', 1.0);
  const [showCrops, setShowCrops] = useState(false);
  const [imageCrops, setImageCrops] = useState({});
  const [photoSizeInputValue, setPhotoSizeInputValue] = useState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [selectionMode, setSelectionMode] = useSetting('faceDetail_selectionMode', false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  
  // Filter state
  const [filterGroups, setFilterGroups] = useState([]);
  const [filterMode, setFilterMode] = useSetting('faceDetail_filterMode', 'and');
  const [onlySelected, setOnlySelected] = useState(false);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const [filterVisible, setFilterVisible] = useSetting('faceDetail_filterVisible', true);
  const [filterLoading, setFilterLoading] = useState(false);
  
  // No complex flag checking needed - the data store handles everything

  // Use the data store for groups
  const { groups: storeGroups, updateGroup: storeUpdateGroup, deleteGroup: storeDeleteGroup, replaceGroup } = useDataStore();

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

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  // Use groups from store if available, otherwise fall back to props
  const currentGroups = storeGroups.length > 0 ? storeGroups : groups;

  useEffect(() => {
    const foundGroup = currentGroups.find(g => g.label === group_name);
    if (foundGroup) {
      console.debug('[DEBUG] FaceDetail: group received from API', {
        groupID: foundGroup.groupID,
        label: foundGroup.label,
        face_representative: foundGroup.face_representative
      });
      setGroup(foundGroup);
      console.debug('[DEBUG] FaceDetail: setGroup called', {
        groupID: foundGroup.groupID,
        label: foundGroup.label,
        face_representative: foundGroup.face_representative
      });
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
      console.debug('[DEBUG] FaceDetail: group used in UI', {
        groupID: group.groupID,
        label: group.label,
        face_representative: group.face_representative
      });
    }
  }, [group]);

  // Fetch sorted photos from backend - only on initial load or manual refresh
  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    if (group && group.groupID !== undefined && group.groupID !== null) {
      // Only fetch if no filters are active
      if (filterGroups.length === 0 && !onlySelected) {
        fetchSortedPhotos();
      }
    }
  }, [group?.groupID]); // Only when group changes (initial load or navigation)

  // Re-sort photos when sort settings change
  useEffect(() => {
    setSortedPhotos(prevPhotos => sortPhotos(prevPhotos, sortBy, sortOrder));
  }, [sortBy, sortOrder]);

  // Subscribe to global groups state changes to keep local photos in sync
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
          // If this is the source group, remove photos that should be removed
          if (transferResult.old_group_id === group?.groupID && transferResult.photos_to_remove_from_source) {
            setSortedPhotos(prevPhotos => {
              const removedSet = new Set(transferResult.photos_to_remove_from_source);
              const updatedPhotos = prevPhotos.filter(photo => !removedSet.has(photo.id));

              // If viewer is open and current photo was removed, move to the next logical photo
              if (photoViewer.show && removedSet.has(photoViewer.photo)) {
                if (updatedPhotos.length === 0) {
                  setPhotoViewer({ show: false, photo: null, index: 0 });
                } else {
                  const newIndex = Math.min(photoViewer.index, updatedPhotos.length - 1);
                  const newPhotoId = updatedPhotos[newIndex].id;
                  setPhotoViewer({ show: true, photo: newPhotoId, index: newIndex });
                }
              }

              return updatedPhotos;
            });
            // Update crop data by removing crops for transferred photos
            setImageCrops(prevCrops => {
              const newCrops = { ...prevCrops };
              transferResult.photos_to_remove_from_source.forEach(photoId => {
                delete newCrops[photoId];
              });
              return newCrops;
            });
          }
          // If this is the target group, add photos that should be added
          else if (transferResult.target_group_id === group?.groupID && transferResult.photos_to_add_to_target) {
            // Use the full photo data from the transfer result
            if (transferResult.transferred_photos_data && transferResult.transferred_photos_data.length > 0) {
              setSortedPhotos(prevPhotos => {
                // Create a map of existing photo IDs for efficient lookup
                const existingPhotoIds = new Set(prevPhotos.map(photo => photo.id));
                
                // Filter out photos that already exist in the current array
                const newPhotos = transferResult.transferred_photos_data.filter(
                  photo => !existingPhotoIds.has(photo.id) && transferResult.photos_to_add_to_target.includes(photo.id)
                );
                
                            // Add only new photos and sort them
            const updatedPhotos = [...prevPhotos, ...newPhotos];
            return sortPhotos(updatedPhotos, sortBy, sortOrder);
          });
        }
        // Update crop data by adding crops for new photos if available in transfer result
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
            updatedGroup.face_representative !== group.face_representative;
          
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
  }, [group?.groupID, sortBy, sortOrder, navigate, photoViewer]); // include photoViewer for accurate updates

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

  const fetchSortedPhotos = async () => {
    if (!group?.groupID) {
      return;
    }
    
    if (skipNextFetch.current) {
      return;
    }
    
    try {
      setLoading(true);
      const response = await groupsAPI.getPhotosComplete(group.groupID);
      const photos = response.photos || [];
      
      // Sort photos based on current settings
      const sorted = sortPhotos(photos, sortBy, sortOrder);
      setSortedPhotos(sorted);
    } catch (error) {
      console.error('Error fetching sorted photos:', error);
      setSortedPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchFilteredPhotos = async () => {
    if (!group?.groupID) {
      return;
    }
    
    try {
      setFilterLoading(true);
      const response = await groupsAPI.getFilteredPhotos(
        group.groupID, 
        filterGroups, 
        filterMode, 
        onlySelected
      );
      
      const photos = response.photos || [];
      const relatedGroupsData = response.related_groups || [];
      
      // Sort photos based on current settings
      const sorted = sortPhotos(photos, sortBy, sortOrder);
      setSortedPhotos(sorted);
      setRelatedGroups(relatedGroupsData);
    } catch (error) {
      console.error('Error fetching filtered photos:', error);
      setSortedPhotos([]);
      setRelatedGroups([]);
    } finally {
      setFilterLoading(false);
    }
  };

  const fetchRelatedGroups = async () => {
    if (!group?.groupID) {
      return;
    }
    
    try {
      const response = await groupsAPI.getRelatedGroups(group.groupID);
      setRelatedGroups(response.related_groups || []);
    } catch (error) {
      console.error('Error fetching related groups:', error);
      setRelatedGroups([]);
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
    setOnlySelected(false);
  };

  const handleFilterVisibilityToggle = () => {
    setFilterVisible(!filterVisible);
  };

  // Fetch related groups when group changes
  useEffect(() => {
    if (group?.groupID) {
      fetchRelatedGroups();
    }
  }, [group?.groupID]);

  // Fetch filtered photos when filter changes
  useEffect(() => {
    if (!group?.groupID) return;

    if (filterGroups.length > 0 || onlySelected) {
      fetchFilteredPhotos();
    } else {
      // No filter active, fetch normal photos, but only if not initial load
      // (initial load is handled by the group change effect)
      if (sortedPhotos.length > 0) {
        fetchSortedPhotos();
      }
    }
  }, [filterGroups, filterMode, onlySelected]); // Removed group?.groupID from dependencies

  const getSortedPhotos = () => {
    return sortedPhotos;
  };

  const handleImageLoad = (photoId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    setPhotoClasses(prev => ({
      ...prev,
      [photoId]: imageClass
    }));
  };

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
    // Re-sort current photos with new order
    setSortedPhotos(prevPhotos => sortPhotos(prevPhotos, sortBy, newOrder));
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
    alert(`Add ${selectedPhotos.size} selected photos to bucket functionality will be implemented later`);
  };

  const getSelectedFaceIds = () => {
    const selectedFaceIds = new Set();
    for (const photoId of selectedPhotos) {
      const photo = sortedPhotos.find(p => p.id === photoId);
      if (photo && photo.faces) {
        photo.faces.forEach(face => {
          if (face.group_id === group.groupID) {
            selectedFaceIds.add(face.face_id);
          }
        });
      }
    }
    return Array.from(selectedFaceIds);
  };

  const handleTransferFaces = () => {
    if (selectedPhotos.size === 0) {
      showToast('Please select photos to transfer', 'error');
      return;
    }
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    const transferData = result.changes && result.changes.length > 0 ? result.changes[0].data : null;
    const isCompleteTransfer = transferData?.old_group_deleted;

    // Clear selection and remove transferred photos from cache
    setSelectedPhotos(new Set());
    
    // If photos were transferred away from this group, remove them from the cached selection
    if (transferData) {
      clearTransferredPhotosFromCache(transferData.old_group_id, transferData.photos_to_remove_from_source);
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
        const response = await groupsAPI.getPhotosComplete(newGroup.groupID);
        const photos = response.photos || [];
        setSortedPhotos(sortPhotos(photos, sortBy, sortOrder));
      } catch (err) {
        console.error('Error fetching target group photos after merge:', err);
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
            Transferred {transferData.photos_to_remove_from_source?.length || 0} faces to{' '}
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

  const togglePhotoSelection = (photoId, event) => {
    const newSelected = new Set(selectedPhotos);
    
    // Handle shift-click for range selection
    if (event?.shiftKey && lastSelectedPhoto && lastSelectedPhoto !== photoId) {
      const lastIndex = sortedPhotos.findIndex(p => p.id === lastSelectedPhoto);
      const currentIndex = sortedPhotos.findIndex(p => p.id === photoId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex);
        const endIndex = Math.max(lastIndex, currentIndex);
        
        // Add all photos in the range
        for (let i = startIndex; i <= endIndex; i++) {
          newSelected.add(sortedPhotos[i].id);
        }
        setSelectedPhotos(newSelected);
        setLastSelectedPhoto(photoId);
        return;
      }
    }
    
    // Regular click - toggle the photo
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    
    setSelectedPhotos(newSelected);
    setLastSelectedPhoto(photoId);
  };

  const selectAllPhotos = () => {
    setSelectedPhotos(new Set(sortedPhotos.map(p => p.id)));
    setLastSelectedPhoto(sortedPhotos.length > 0 ? sortedPhotos[sortedPhotos.length - 1].id : null);
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
    setLastSelectedPhoto(null);
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Ctrl+A or Cmd+A for select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        if (sortedPhotos.length > 0) {
          selectAllPhotos();
        }
      }
      // Escape to clear selection
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedPhotos]);

  const openPhotoViewer = (photoId, index) => {
    // Use the photo data directly since it comes from the API
    setPhotoViewer({
      show: true,
      photo: photoId, // Store just the photo_id string for consistency
      index: index
    });
  };

  const closePhotoViewer = () => {
    setPhotoViewer({ show: false, photo: null, index: 0 });
  };

  const navigatePhoto = (direction, index) => {
    const currentIndex = photoViewer.index;
    let newIndex;
    if (direction === 'jump' && typeof index === 'number') {
      newIndex = index;
    } else if (direction === 'next') {
      newIndex = Math.min(currentIndex + 1, sortedPhotos.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    setPhotoViewer({
      show: true,
      photo: sortedPhotos[newIndex].id, // This is already correct
      index: newIndex
    });
  };

  const handleJumpToMoment = (momentInfo) => {
    // Navigate to the moments page and scroll to the specific moment
    navigate('/moments', { state: { scrollToMoment: momentInfo.id } });
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
                  key={group.face_representative || 'no-representative'}
                  src={group.face_representative && group.face_representative.trim() !== ''
                    ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representative}.webp`
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
                  {sortedPhotos.length} of {group.image_ids?.length || 0} photos
                  {showCrops && (
                    <span className="ml-2 text-primary-600 font-medium">
                      • Showing face crops
                    </span>
                  )}
                </p>
                {selectedPhotos.size > 0 && (
                  <p className="text-sm text-primary-600 font-medium absolute top-full left-0">
                    {selectedPhotos.size} selected
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
                  id="search-photos"
                  name="search-photos"
                  placeholder="Search photos..."
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
                  setSortedPhotos(prevPhotos => sortPhotos(prevPhotos, e.target.value, sortOrder));
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
                      const currentPercent = Math.round(photoSize * 100);
                      const next25 = Math.ceil(currentPercent / 25) * 25;
                      const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                      const subtract25 = currentPercent - 25;
                      const newPercent = Math.max(50, Math.max(subtract25, prev25));
                      setPhotoSize(newPercent / 100);
                    }}
                    disabled={photoSize <= 0.5}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Decrease size"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    id="face-detail-photo-size"
                    name="face-detail-photo-size"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={photoSizeInputValue !== undefined ? photoSizeInputValue : Math.round(photoSize * 100)}
                    onChange={e => setPhotoSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={e => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) val = Math.round(photoSize * 100);
                      val = Math.max(50, Math.min(300, val));
                      setPhotoSize(val / 100);
                      setPhotoSizeInputValue(undefined);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.target.blur();
                      } else if (e.key === 'Escape') {
                        setPhotoSizeInputValue(undefined);
                      }
                    }}
                    className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                    style={{width: '3rem'}}
                  />
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(photoSize * 100);
                      const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                      const add25 = currentPercent + 25;
                      const newPercent = Math.min(300, Math.min(add25, next25));
                      setPhotoSize(newPercent / 100);
                    }}
                    disabled={photoSize >= 3}
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
            {sortedPhotos.length > 0 && viewMode === 'grid' && (
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
                {selectionMode && (
                  <button
                    onClick={() => selectedPhotos.size === sortedPhotos.length ? clearSelection() : selectAllPhotos()}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                      selectedPhotos.size === sortedPhotos.length
                        ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                    title={selectedPhotos.size === sortedPhotos.length ? "Clear selection" : "Select all photos (Ctrl+A)"}
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
                {selectedPhotos.size > 0 && (
                  <button
                    onClick={clearSelection}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                    title="Clear selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Group 4: Actions on Selection */}
            {sortedPhotos.length > 0 && viewMode === 'grid' && selectedPhotos.size > 0 && (
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
            {sortedPhotos.length > 0 && viewMode === 'list' && (
              <>
                {/* Group 3: Selection Controls */}
                <div className="flex items-center space-x-3 px-4">
                  <button
                    onClick={() => selectedPhotos.size === sortedPhotos.length ? clearSelection() : selectAllPhotos()}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                      selectedPhotos.size === sortedPhotos.length
                        ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                    title={selectedPhotos.size === sortedPhotos.length ? "Clear selection" : "Select all photos (Ctrl+A)"}
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                </div>

                {/* Group 4: Actions on Selection */}
                {selectedPhotos.size > 0 && (
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
      </div>

      {/* Groups Filter */}
      <AnimatePresence>
        {filterVisible && (
          <GroupsFilter
            group={group}
            relatedGroups={relatedGroups}
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

      {/* Content Area */}
      <div className="px-8 py-8">
        {/* Photos Grid/List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading photos...</p>
          </div>
        ) : sortedPhotos.length === 0 ? (
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
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * photoSize)}px, 1fr))`,
              gridAutoRows: `${Math.max(100, 266 * photoSize)}px`
            } : {}}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {sortedPhotos.map((photo, index) => (
              <motion.div
                key={`${photo.id || 'unknown'}-${index}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className={`${viewMode === 'grid' ? `photo-card ${photoClasses[photo.id] || 'square'}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
              >
                {viewMode === 'grid' ? (
                  <div className="relative group cursor-pointer h-full" onClick={(e) => {
                    if (!e.target.closest('input[type="checkbox"]')) {
                      openPhotoViewer(photo.id, index);
                    }
                  }}>
                    <input
                      type="checkbox"
                      id={`photo-checkbox-grid-${photo.id}`}
                      name={`photo-checkbox-grid-${photo.id}`}
                      checked={selectedPhotos.has(photo.id)}
                      onChange={() => {}} // Empty handler to satisfy React
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePhotoSelection(photo.id, e);
                      }}
                      className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                        viewMode === 'list' || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    />
                    <img
                      src={showCrops && imageCrops[photo.id] 
                        ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[photo.id]}.webp`
                        : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photo.id}.webp`
                      }
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                      loading="lazy"
                      onLoad={(e) => handleImageLoad(photo.id, e)}
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
                    {photo.date_taken && (
                      <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                        {formatDate(photo.date_taken)}
                      </div>
                    )}
                    {/* Crop indicator */}
                    {showCrops && imageCrops[photo.id] && (
                      <div className="absolute top-2 right-2 bg-primary-600 text-white text-xs px-2 py-1 rounded">
                        Crop
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      id={`photo-checkbox-list-${photo.id}`}
                      name={`photo-checkbox-list-${photo.id}`}
                      checked={selectedPhotos.has(photo.id)}
                      onChange={() => {}} // Empty handler to satisfy React
                      onClick={(e) => {
                        togglePhotoSelection(photo.id, e);
                      }}
                      className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                    />
                    <div className="relative">
                      <img
                        src={showCrops && imageCrops[photo.id] 
                          ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[photo.id]}.webp`
                          : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photo.id}.webp`
                        }
                        alt={`Photo ${index + 1}`}
                        className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                        loading="lazy"
                        onClick={(e) => {
                          if (!e.target.closest('input[type="checkbox"]')) {
                            openPhotoViewer(photo.id, index);
                          }
                        }}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = PLACEHOLDER_DATA_URL;
                        }}
                      />
                      {/* Crop indicator for list view */}
                      {showCrops && imageCrops[photo.id] && (
                        <div className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs px-1 py-0.5 rounded-full">
                          C
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{photo.name}</p>
                      <p className="text-sm text-gray-500">
                        {photo.date_taken ? formatDate(photo.date_taken) : 'Unknown date'}
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

             {/* Photo Viewer */}
       {photoViewer.show && (
         <PhotoViewer
           photo={photoViewer.photo}
           onClose={closePhotoViewer}
           onNavigate={navigatePhoto}
           totalPhotos={sortedPhotos.length}
           currentIndex={photoViewer.index}
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