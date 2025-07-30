import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  Download, 
  Edit, 
  Trash2, 
  User, 
  Image, 
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
  X,
  AlertTriangle,
  Users
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import PhotoViewer from './PhotoViewer';
import MergeConflictModal from './MergeConflictModal';
import TransferFacesModal from './TransferFacesModal';
import { sortPhotos, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { useGroupNameConflict } from '../utils/useGroupNameConflict';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, handleAPIError, showToast, optimisticUpdates } from '../utils/apiService';

export default function FaceDetail({ groups, onDeleteGroup, showToast, onRefreshGroups }) {
  const { group_name } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [viewMode, setViewMode] = useSetting('faceDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Use the data store for groups
  const { groups: storeGroups, updateGroup: storeUpdateGroup, deleteGroup: storeDeleteGroup } = useDataStore();

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

  // Fetch sorted photos from backend
  useEffect(() => {
    if (group && group.groupID !== undefined && group.groupID !== null) {
      fetchSortedPhotos();
    }
  }, [group?.groupID]); // Only refetch when groupID changes, not when group object updates

  // Subscribe to global groups state changes to keep local photos in sync
  useEffect(() => {
    const unsubscribe = useDataStore.subscribe(
      (state) => {
        // Handle transfer results
        const transferResult = state.lastTransferResult;
        if (transferResult && transferResult.transferred_photos) {
          // If this is the source group, remove transferred photos surgically
          if (transferResult.old_group_id === group?.groupID) {
            setSortedPhotos(prevPhotos => 
              prevPhotos.filter(photo => !transferResult.transferred_photos.includes(photo.id))
            );
          }
          // If this is the target group, add transferred photos surgically
          else if (transferResult.target_group_id === group?.groupID) {
            // Use the full photo data from the transfer result
            if (transferResult.transferred_photos_data && transferResult.transferred_photos_data.length > 0) {
              setSortedPhotos(prevPhotos => {
                // Add new photos and sort them
                const newPhotos = [...prevPhotos, ...transferResult.transferred_photos_data];
                return sortPhotos(newPhotos, sortBy, sortOrder);
              });
            }
          }
        }
        
        // Handle group updates (including name and representative changes)
        const updatedGroup = state.groups.find(g => g.groupID === group?.groupID);
        if (updatedGroup && group) {
          const hasChanges = 
            updatedGroup.label !== group.label ||
            updatedGroup.face_representive !== group.face_representive;
          
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
  }, [group?.groupID, sortBy, sortOrder]); // Removed sortedPhotos.length to prevent unnecessary re-subscriptions

  // Fetch crop data when group changes
  useEffect(() => {
    if (group && group.groupID !== undefined && group.groupID !== null) {
      fetchGroupCrops();
    }
  }, [group?.groupID]);

  const fetchGroupCrops = async () => {
    try {
      const response = await groupsAPI.getCrops(group.groupID);
      setImageCrops(response.crop_mapping || {});
    } catch (error) {
      console.error('Error fetching group crops:', error);
      setImageCrops({});
    }
  };

  const fetchSortedPhotos = async () => {
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

  const handleAddGroupToBucket = async () => {
    // TODO: Implement add to bucket functionality
    alert(`Add ${group.label || `Person_${group.groupID}`} to bucket functionality will be implemented later`);
  };

  const handleAddSelectedToBucket = async () => {
    // TODO: Implement add selected to bucket functionality
    alert(`Add ${selectedPhotos.size} selected photos to bucket functionality will be implemented later`);
  };

  const getSelectedFaceIds = () => {
    const selectedFaceIds = [];
    for (const photoId of selectedPhotos) {
      const photo = sortedPhotos.find(p => p.id === photoId);
      if (photo && photo.faces) {
        photo.faces.forEach(face => {
          if (face.group_id === group.groupID) {
            selectedFaceIds.push(face.face_id);
          }
        });
      }
    }
    return selectedFaceIds;
  };

  const handleTransferFaces = () => {
    if (selectedPhotos.size === 0) {
      showToast('Please select photos to transfer', 'error');
      return;
    }
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    // Clear selection
    setSelectedPhotos(new Set());
    
    // The change instruction system will handle all updates automatically
    // No need for manual updates here - the API service interceptor
    // will process the GROUP_FACES_TRANSFERRED change instruction
    
    // Show success notification
    if (result.target_group_id) {
      const targetGroup = currentGroups.find(g => g.groupID === result.target_group_id);
      let groupName = result.new_group_name || (targetGroup ? targetGroup.label : 'new group');
      showToast(`Successfully transferred faces to "${groupName}"`, 'success');
    }
    
    // If old group was deleted, redirect to the new group
    if (result.old_group_deleted) {
      showToast('Group was empty and has been deleted', 'success');
      // Find the target group and redirect to it
      const targetGroup = currentGroups.find(g => g.groupID === result.target_group_id);
      if (targetGroup) {
        navigate(`/group/${encodeURIComponent(targetGroup.label)}`);
      } else {
        navigate('/');
      }
      return; // Exit early since we're navigating away
    }
    
    // Handle PhotoViewer navigation if we're currently viewing a photo
    if (photoViewer.show && result.transferred_photos && result.transferred_photos.length > 0) {
      const currentPhotoId = photoViewer.photo;
      const wasCurrentPhotoTransferred = result.transferred_photos.includes(currentPhotoId);
      
      if (wasCurrentPhotoTransferred) {
        // Current photo was transferred, need to navigate to next photo or close
        const remainingPhotos = sortedPhotos.filter(photo => 
          !result.transferred_photos.includes(photo.id)
        );
        
        if (remainingPhotos.length > 0) {
          // Find the next photo to show
          const currentIndex = sortedPhotos.findIndex(p => p.id === currentPhotoId);
          let nextIndex = currentIndex;
          
          // Try to find the next photo, or go to the previous one if at the end
          while (nextIndex < sortedPhotos.length - 1) {
            nextIndex++;
            if (!result.transferred_photos.includes(sortedPhotos[nextIndex].id)) {
              break;
            }
          }
          
          // If we didn't find a next photo, try going backwards
          if (nextIndex >= sortedPhotos.length || result.transferred_photos.includes(sortedPhotos[nextIndex].id)) {
            nextIndex = currentIndex;
            while (nextIndex > 0) {
              nextIndex--;
              if (!result.transferred_photos.includes(sortedPhotos[nextIndex].id)) {
                break;
              }
            }
          }
          
          // If we found a valid photo, navigate to it
          if (nextIndex >= 0 && nextIndex < sortedPhotos.length && 
              !result.transferred_photos.includes(sortedPhotos[nextIndex].id)) {
            const nextPhoto = sortedPhotos[nextIndex];
            setPhotoViewer({
              show: true,
              photo: nextPhoto.id,
              index: remainingPhotos.findIndex(p => p.id === nextPhoto.id)
            });
          } else {
            // No more photos in this group, redirect to target group
            const targetGroup = currentGroups.find(g => g.groupID === result.target_group_id);
            if (targetGroup) {
              navigate(`/group/${encodeURIComponent(targetGroup.label)}`);
            } else {
              closePhotoViewer();
            }
          }
        } else {
          // No photos left in this group, redirect to target group
          const targetGroup = currentGroups.find(g => g.groupID === result.target_group_id);
          if (targetGroup) {
            navigate(`/group/${encodeURIComponent(targetGroup.label)}`);
          } else {
            closePhotoViewer();
          }
        }
      }
    }
    
    // The data store subscription already handles the surgical updates
    // No need to refetch photos - the API interceptor and data store
    // will handle all the updates automatically
  };

  const togglePhotoSelection = (photoId) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const selectAllPhotos = () => {
    setSelectedPhotos(new Set(sortedPhotos.map(p => p.id)));
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
  };

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
    if (editingTitle.trim() && editingTitle !== group.label) {
      // Check for conflicts before saving
      await checkNameConflict(editingTitle.trim());
      
      if (nameConflict) {
        // Show merge conflict modal
        showMergeConflictModal(editingTitle.trim());
        setIsEditingTitle(false);
        return;
      }
      
      try {
        await optimisticUpdates.updateGroup(group.groupID, { label: editingTitle.trim() });
        
        // Update the URL to reflect the new group name
        const newUrl = `/group/${encodeURIComponent(editingTitle.trim())}`;
        window.history.replaceState(null, '', newUrl);
      } catch (error) {
        console.error('Error updating group name:', error);
      }
    }
    setIsEditingTitle(false);
    clearConflict(); // Clear conflict after saving
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
              <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg">
                <img
                  key={group.face_representive || 'no-representative'}
                  src={group.face_representive && group.face_representive.trim() !== ''
                    ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representive}.webp`
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
                  <div className="flex items-center space-x-2">
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
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Edit group details"
                    >
                      <Edit className="w-4 h-4 text-gray-500" />
                    </button>
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
                  <p className="text-sm text-gray-500 absolute top-full left-0">
                    {selectedPhotos.size} selected
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 min-w-max">
            <button
              onClick={handleAddGroupToBucket}
              className="btn-primary flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Add All to Bucket</span>
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 flex items-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-4">
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
            
            {/* Sort Controls */}
            <div className="flex items-center space-x-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
              </select>
              
              <button
                onClick={handleToggleSortOrder}
                className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-1"
                title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </button>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-colors ${
                  viewMode === 'grid' ? 'bg-gray-100' : 'hover:bg-gray-100'
                }`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-colors ${
                  viewMode === 'list' ? 'bg-gray-100' : 'hover:bg-gray-100'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {/* Size Control - Only show in grid mode */}
            {viewMode === 'grid' && (
              <div className="flex items-center space-x-2 px-3 py-2">
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
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Crop Toggle */}
            <div className="flex items-center space-x-2 px-3 py-2">
              <button
                onClick={() => setShowCrops(!showCrops)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-md transition-colors ${
                  showCrops 
                    ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                    : 'hover:bg-gray-200 text-gray-700'
                }`}
                title={showCrops ? 'Show full images' : 'Show face crops'}
              >
                <Crop className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {showCrops ? 'Crops' : 'Full'}
                </span>
              </button>
              {showCrops && (
                <span className="text-xs text-gray-500 ml-1">
                  (face only)
                </span>
              )}
            </div>

            {/* Compact Selection Controls */}
            {sortedPhotos.length > 0 && (
              <div className="flex items-center space-x-2 px-3 py-2">
                <button
                  onClick={() => setSelectionMode(!selectionMode)}
                  className={`text-sm font-medium px-2 py-1 rounded transition-colors ${
                    selectionMode 
                      ? 'text-red-600 hover:text-red-700 hover:bg-red-50' 
                      : 'text-primary-600 hover:text-primary-700 hover:bg-primary-50'
                  }`}
                >
                  {selectionMode ? 'Cancel' : 'Select'}
                </button>
                {selectionMode && (
                  <button
                    onClick={selectAllPhotos}
                    disabled={selectedPhotos.size === sortedPhotos.length}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium px-2 py-1 hover:bg-primary-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    All
                  </button>
                )}
                                    {selectedPhotos.size > 0 && (
                  <>
                    <button
                      onClick={clearSelection}
                      className="text-sm text-gray-600 hover:text-gray-700 font-medium px-2 py-1 hover:bg-gray-100 rounded transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleTransferFaces}
                      className="text-sm text-orange-600 hover:text-orange-700 font-medium px-2 py-1 hover:bg-orange-50 rounded transition-colors flex items-center space-x-1"
                    >
                      <Users className="w-3 h-3" />
                      <span>Change Group</span>
                    </button>
                    <button
                      onClick={handleAddSelectedToBucket}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium px-2 py-1 hover:bg-primary-50 rounded transition-colors flex items-center space-x-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Add to Bucket</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
            <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
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
                key={photo.id || `photo-${index}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className={`${viewMode === 'grid' ? `photo-card ${photoClasses[photo.id] || 'square'}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
              >
                {viewMode === 'grid' ? (
                  <div className="relative group cursor-pointer h-full" onClick={() => openPhotoViewer(photo.id, index)}>
                    <input
                      type="checkbox"
                      id={`photo-checkbox-grid-${photo.id}`}
                      name={`photo-checkbox-grid-${photo.id}`}
                      checked={selectedPhotos.has(photo.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        togglePhotoSelection(photo.id);
                      }}
                      onClick={e => e.stopPropagation()}
                      className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                        selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
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
                        <Image className="w-8 h-8 mx-auto mb-1" />
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
                      onChange={(e) => {
                        togglePhotoSelection(photo.id);
                      }}
                      onClick={e => e.stopPropagation()}
                      className={`w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                        selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
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
                        onClick={() => openPhotoViewer(photo.id, index)}
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
            await optimisticUpdates.updateGroup(group.groupID, updates);
            setShowEditModal(false);
          }}
          onRefreshGroups={onRefreshGroups}
        />
      )}

      {showDeleteModal && (
        <DeleteConfirmModal
          group={group}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            await storeDeleteGroup(group.groupID);
            navigate('/');
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
        />
      )}
    </div>
  );
}