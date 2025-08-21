import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, Filter, X, CheckCheck, RotateCcw } from 'lucide-react';
import { sortPhotosWithDatePriority, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { imagesAPI, momentsAPI, handleAPIError, optimisticUpdates } from '../utils/apiService';
import { useModalFocus } from '../utils/useModalFocus';
import { useDataStore } from '../utils/dataManager';

function formatDateTime(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

function EditPhotosModal({ moment, momentPhotosMap, onRefreshPhotos, onSave, moments, onClose }) {
  const { updateMoment } = useDataStore();
  const [photosToAdd, setPhotosToAdd] = useState(new Set());
  const [photosToRemove, setPhotosToRemove] = useState(new Set());
  const [allImagesWithTimestamps, setAllImagesWithTimestamps] = useState([]);
  const [photosInPeriod, setPhotosInPeriod] = useState([]);
  const [sortOrder, setSortOrder] = useSetting('editMomentPhotos_sortOrder', 'asc');
  const [filterType, setFilterType] = useSetting('editMomentPhotos_filterType', 'all');
  const [error, setError] = useState('');
  const [focusedPhotoIndex, setFocusedPhotoIndex] = useState(0);
  const photoRefs = useRef([]);

  // Use modal focus hook with allowOutsideScroll: false to prevent space key scrolling
  const { modalRef } = useModalFocus(true, onClose, {
    allowOutsideScroll: false
  });

  // Reset method - creates empty lists and doesn't pre-select anything
  const handleReset = () => {
    setPhotosToAdd(new Set());
    setPhotosToRemove(new Set());
  };

  useEffect(() => {
    if (moment) {
      // Call reset when modal opens to ensure clean state
      handleReset();
      
      fetchPhotosInPeriod();
      fetchAllImagesWithTimestamps();
      setError('');
    }
  }, [moment, momentPhotosMap]);

  // Fetch all images with timestamps when modal opens
  useEffect(() => {
    if (moment) {
      fetchAllImagesWithTimestamps();
    }
  }, [moment]);

  // Refetch images when dependencies change (only if modal is open)
  useEffect(() => {
    if (moment && (photosInPeriod.length > 0 || Object.keys(momentPhotosMap).length > 0)) {
      fetchAllImagesWithTimestamps();
    }
  }, [photosInPeriod, momentPhotosMap, moment]);

  useEffect(() => {
    if (moment) {
      setError('');
    }
  }, [moment]);

  const fetchAllImagesWithTimestamps = async () => {
    try {
      const data = await imagesAPI.getAll();
      setAllImagesWithTimestamps(data.images || []);
    } catch (error) {
      console.error('Error fetching images:', error);
      const errorInfo = handleAPIError(error, 'Failed to fetch images');
      setError(errorInfo.message);
      setAllImagesWithTimestamps([]);
    }
  };

  const fetchPhotosInPeriod = async () => {
    if (!moment || !moment.start || !moment.end) {
      setPhotosInPeriod([]);
      return;
    }

    try {
      const result = await momentsAPI.getPhotosInPeriod(moment.momentID);
      setPhotosInPeriod(result.photos || []);
    } catch (error) {
      console.error('Error fetching photos in period:', error);
      const errorInfo = handleAPIError(error, 'Failed to fetch photos in period');
      setError(errorInfo.message);
      setPhotosInPeriod([]);
    }
  };

  const handleSavePhotos = async () => {
    try {
      // Only proceed if there are actual changes
      if (photosToAdd.size === 0 && photosToRemove.size === 0) {
        handleClose();
        return;
      }
      
      // Filter to ensure only actual changes are sent
      const actualAdditions = Array.from(photosToAdd).filter(id => !isPhotoInMoment(id));
      const actualRemovals = Array.from(photosToRemove).filter(id => isPhotoInMoment(id));
      
      // Call the API directly
      await momentsAPI.update(moment.momentID, {
        photos_to_add: actualAdditions,
        photos_to_remove: actualRemovals
      });
      
      // Get the updated photos for this moment to update the local state
      const updatedPhotosResult = await momentsAPI.getPhotos(moment.momentID);
      const updatedPhotos = updatedPhotosResult.photos || [];
      
      // Update the momentPhotosMap directly in the parent component
      // This ensures the UI reflects the changes immediately
      if (onRefreshPhotos) {
        // Pass the updated photos data to the parent
        onRefreshPhotos(moment.momentID, updatedPhotos);
      }
      
      // Handle photos that were moved from other moments
      // We need to remove them from those moments in the local state
      const photosMovedFromOtherMoments = actualAdditions.filter(id => {
        const momentInfo = getPhotoMomentInfo(id);
        return momentInfo && !momentInfo.isCurrentMoment;
      });
      
      // Store moment info for moved photos before making changes
      // This is needed because getPhotoMomentInfo won't work after momentPhotosMap is updated
      const movedPhotosMomentInfo = photosMovedFromOtherMoments.map(id => {
        const momentInfo = getPhotoMomentInfo(id);
        return { photoId: id, momentInfo };
      }).filter(item => item.momentInfo && !item.momentInfo.isCurrentMoment);
      
      // Update the momentPhotosMap for moments that lost photos
      for (const { photoId, momentInfo } of movedPhotosMomentInfo) {
        // Remove this photo from the other moment in the local state
        if (onRefreshPhotos) {
          // Get the current photos for that moment and remove the moved photo
          const otherMomentPhotos = momentPhotosMap[momentInfo.momentId] || [];
          const updatedOtherMomentPhotos = otherMomentPhotos.filter(p => 
            (p.id || p.imageID) !== photoId
          );
          // Update the other moment's photos
          onRefreshPhotos(momentInfo.momentId, updatedOtherMomentPhotos);
        }
      }
      
      // Wait a bit for photos to be updated, then update moment data
      // This ensures representative photos are calculated with the latest photo data
      // Increased delay to ensure backend has fully processed representative photo calculation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('Updating moment data for representative photos...');
      
      // Also trigger a moment update to refresh the moment data
      // This ensures the representative photo and other moment data is updated
      // We update the moment directly to avoid triggering change handlers that might conflict
      let updatedMoment = await momentsAPI.getById(moment.momentID);
      if (updatedMoment) {
        console.log('Updating current moment:', moment.momentID, 'with representative photo:', updatedMoment.representative_photo);
        console.log('Previous representative photo was:', moment.representative_photo);
        
        // If the representative photo hasn't changed, wait a bit more and try again
        // This handles cases where the backend needs more time to calculate
        if (updatedMoment.representative_photo === moment.representative_photo) {
          console.log('Representative photo unchanged, waiting a bit more...');
          await new Promise(resolve => setTimeout(resolve, 200));
          updatedMoment = await momentsAPI.getById(moment.momentID);
          if (updatedMoment) {
            console.log('After retry - representative photo:', updatedMoment.representative_photo);
          }
        }
        
        // Update the moment data directly without triggering change handlers
        // This ensures the representative photo and other moment data is updated
        updateMoment(moment.momentID, updatedMoment);
      } else {
        console.warn('Could not get updated moment data for:', moment.momentID);
      }
      
      // Also update the moment data for moments that lost photos
      // This ensures the representative photo is recalculated
      for (const { photoId, momentInfo } of movedPhotosMomentInfo) {
        try {
          let otherMoment = await momentsAPI.getById(momentInfo.momentId);
          if (otherMoment) {
            console.log('Updating moment that lost photos:', momentInfo.momentId, 'with representative photo:', otherMoment.representative_photo);
            // Get the current moment data to compare
            const currentMoment = useDataStore.getState().moments.find(m => m.momentID === momentInfo.momentId);
            if (currentMoment) {
              console.log('Previous representative photo for', momentInfo.momentId, 'was:', currentMoment.representative_photo);
              
              // If the representative photo hasn't changed, wait a bit more and try again
              if (otherMoment.representative_photo === currentMoment.representative_photo) {
                console.log('Representative photo unchanged for', momentInfo.momentId, ', waiting a bit more...');
                await new Promise(resolve => setTimeout(resolve, 200));
                otherMoment = await momentsAPI.getById(momentInfo.momentId);
                if (otherMoment) {
                  console.log('After retry - representative photo for', momentInfo.momentId, ':', otherMoment.representative_photo);
                }
              }
            }
            updateMoment(momentInfo.momentId, otherMoment);
          } else {
            console.warn('Could not get updated moment data for:', momentInfo.momentId);
          }
        } catch (error) {
          console.error(`Error updating moment ${momentInfo.momentId}:`, error);
        }
      }
      
      // Force a refresh of the data store to ensure all components get the latest data
      // This is especially important for representative photos in carousels and other components
      try {
        // Trigger a small delay to ensure all updates are processed
        await new Promise(resolve => setTimeout(resolve, 50));
        console.log('Forcing data store refresh...');
        
        // Also try to refresh the moments data to ensure representative photos are up to date
        // This is a fallback in case the individual moment updates didn't work
        try {
          const allMoments = await momentsAPI.getAll();
          if (allMoments && allMoments.moments) {
            console.log('Refreshing all moments data...');
            // Update the data store with all moments to ensure consistency
            allMoments.moments.forEach(momentData => {
              updateMoment(momentData.momentID, momentData);
            });
          }
        } catch (refreshError) {
          console.warn('Could not refresh all moments:', refreshError);
        }
        
        // Also try to force a re-render by updating a non-critical field
        // This can help trigger re-renders in components that might be stuck
        try {
          const currentMoments = useDataStore.getState().moments;
          if (currentMoments.length > 0) {
            // Update the first moment with a timestamp to force re-renders
            const firstMoment = currentMoments[0];
            updateMoment(firstMoment.momentID, { 
              ...firstMoment, 
              _last_updated: new Date().toISOString() 
            });
          }
        } catch (forceUpdateError) {
          console.warn('Could not force update:', forceUpdateError);
        }
        
        console.log('Data store refresh completed. Summary of updates:');
        console.log('- Current moment updated:', moment.momentID);
        console.log('- Moments that lost photos:', movedPhotosMomentInfo.map(item => item.momentInfo.momentId));
        console.log('- All moments refreshed from backend');
        
      } catch (error) {
        console.error('Error during data store refresh:', error);
      }
      
      handleClose();
    } catch (error) {
      console.error('Error saving photos:', error);
      const errorInfo = handleAPIError(error, 'Failed to save photos');
      setError(errorInfo.message);
    }
  };

  const handleClose = () => {
    setError('');
    // Call the parent's onClose function
    if (onClose) {
      onClose();
    }
  };

  const togglePhoto = (photoId) => {
    const isCurrentlyInMoment = isPhotoInMoment(photoId);
    
    if (isCurrentlyInMoment) {
      // Photo is currently in the moment
      if (photosToRemove.has(photoId)) {
        // Remove from remove list (undo removal)
        setPhotosToRemove(prev => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
      } else {
        // Add to remove list (mark for removal)
        setPhotosToRemove(prev => new Set(prev).add(photoId));
      }
    } else {
      // Photo is not currently in the moment
      if (photosToAdd.has(photoId)) {
        // Remove from add list (undo addition)
        setPhotosToAdd(prev => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
      } else {
        // Add to add list (mark for addition)
        setPhotosToAdd(prev => new Set(prev).add(photoId));
      }
    }
  };

  const handleToggleSortOrder = () => {
    setSortOrder(prev => toggleSortOrder(prev));
  };

  // Check if a photo is currently in the moment
  const isPhotoInMoment = (photoId) => {
    return (momentPhotosMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === photoId);
  };

  // Get the effective selection state for a photo (considering pending changes)
  const getPhotoSelectionState = (photoId) => {
    const isCurrentlyInMoment = isPhotoInMoment(photoId);
    
    if (isCurrentlyInMoment) {
      // Currently in moment
      if (photosToRemove.has(photoId)) {
        return 'marked-for-removal'; // Red border, will be removed
      }
      return 'in-moment'; // Green border, staying in moment (default state)
    } else {
      // Not currently in moment
      if (photosToAdd.has(photoId)) {
        return 'marked-for-addition'; // Green border, will be added
      }
      return 'not-in-moment'; // No special border
    }
  };

  // Use moments array to get the title for a moment ID
  const getPhotoMomentInfo = (photoId) => {
    for (const momentId in momentPhotosMap) {
      const momentPhotos = momentPhotosMap[momentId] || [];
      const foundPhoto = momentPhotos.find(p => (p.id || p.imageID) === photoId);
      if (foundPhoto) {
        const momentObj = moments.find(m => m.momentID === momentId);
        return {
          momentId: momentId,
          title: momentObj ? momentObj.label : momentId,
          isCurrentMoment: moment && momentId === moment.momentID
        };
      }
    }
    return null;
  };

  const isPhotoInPeriod = (photoId) => {
    return photosInPeriod.some(p => (p.id || p.imageID) === photoId);
  };

  const getFilteredAndSortedImages = () => {
    let filteredImages = allImagesWithTimestamps;
    if (filterType === 'in-moment') {
      filteredImages = filteredImages.filter(img => 
        (momentPhotosMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === (img.id || img.imageID))
      );
    } else if (filterType === 'not-in-moment') {
      filteredImages = filteredImages.filter(img => 
        !(momentPhotosMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === (img.id || img.imageID))
      );
    } else if (filterType === 'in-period') {
      filteredImages = photosInPeriod;
    }
    
    // Sort using global utility with date priority
    return sortPhotosWithDatePriority(filteredImages, sortOrder);
  };

  // Get filtered images for selection operations
  const getFilteredImages = () => {
    return getFilteredAndSortedImages();
  };

  // Handle select all for filtered images
  const handleSelectAllFiltered = () => {
    const filteredImages = getFilteredImages();
    const filteredPhotoIds = filteredImages.map(img => img.id || img.imageID);
    
    // Check if all filtered are already effectively selected
    const allSelected = filteredPhotoIds.every(id => {
      const state = getPhotoSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
    
    if (allSelected) {
      // Deselect all filtered
      filteredPhotoIds.forEach(id => {
        const isCurrentlyInMoment = isPhotoInMoment(id);
        if (isCurrentlyInMoment) {
          // Add to remove list (mark for removal)
          setPhotosToRemove(prev => new Set(prev).add(id));
        } else {
          // Remove from add list
          setPhotosToAdd(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      });
    } else {
      // Select all filtered
      filteredPhotoIds.forEach(id => {
        const isCurrentlyInMoment = isPhotoInMoment(id);
        if (isCurrentlyInMoment) {
          // Remove from remove list (keep in moment)
          setPhotosToRemove(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        } else {
          // Add to add list
          setPhotosToAdd(prev => new Set(prev).add(id));
        }
      });
    }
  };

  // Handle clear selection for filtered images
  const handleClearFilteredSelection = () => {
    const filteredImages = getFilteredImages();
    const filteredPhotoIds = filteredImages.map(img => img.id || img.imageID);
    
    filteredPhotoIds.forEach(id => {
      const isCurrentlyInMoment = isPhotoInMoment(id);
      if (isCurrentlyInMoment) {
        // Add to remove list (mark for removal)
        setPhotosToRemove(prev => new Set(prev).add(id));
      } else {
        // Remove from add list
        setPhotosToAdd(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  };

  // Check if all filtered images are effectively selected
  const areAllFilteredSelected = () => {
    const filteredImages = getFilteredImages();
    if (filteredImages.length === 0) return false;
    
    return filteredImages.every(img => {
      const id = img.id || img.imageID;
      const state = getPhotoSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
  };

  // Check if any filtered images are selected
  const areAnyFilteredSelected = () => {
    const filteredImages = getFilteredImages();
    if (filteredImages.length === 0) return false;
    
    return filteredImages.some(img => {
      const id = img.id || img.imageID;
      const state = getPhotoSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
  };

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e) => {
    const filteredImages = getFilteredAndSortedImages();
    if (filteredImages.length === 0) return;

    // Handle space key when a photo is focused
    if (document.activeElement && document.activeElement.closest('.photo-item') && e.key === ' ') {
      e.preventDefault();
      const photoId = document.activeElement.getAttribute('data-photo-id');
      if (photoId) {
        togglePhoto(photoId);
      }
      return;
    }

    // Handle Tab normally for navigation
    if (e.key === 'Tab') {
      return;
    }

    // Handle all other keys
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        handleSavePhotos();
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
          const newIndex = prev - cols;
          return newIndex >= 0 ? newIndex : filteredImages.length - 1;
        });
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
          const newIndex = prev + cols;
          return newIndex < filteredImages.length ? newIndex : 0;
        });
        break;
      
      case 'ArrowLeft':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const newIndex = prev > 0 ? prev - 1 : filteredImages.length - 1;
          return newIndex;
        });
        break;
      
      case 'ArrowRight':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const newIndex = prev < filteredImages.length - 1 ? prev + 1 : 0;
          return newIndex;
        });
        break;
    }
  }, [focusedPhotoIndex, getFilteredAndSortedImages, handleSavePhotos, togglePhoto]);

  // Reset focused index when filter or sort changes
  useEffect(() => {
    // Clear old refs when images change
    photoRefs.current = [];
    // Reset focus after a short delay to ensure refs are populated
    setTimeout(() => {
      setFocusedPhotoIndex(0);
    }, 100);
  }, [filterType, sortOrder]);

  // Add document-level keyboard listener as fallback
  useEffect(() => {
    if (moment) {
      const handleDocumentKeyDown = (e) => {
        // Only handle if the modal is open and focused
        if (modalRef.current && modalRef.current.contains(document.activeElement)) {
          handleKeyDown(e);
        }
      };
      
      document.addEventListener('keydown', handleDocumentKeyDown, true); // Use capture phase
      return () => {
        document.removeEventListener('keydown', handleDocumentKeyDown, true);
      };
    }
  }, [moment, handleKeyDown]);

  if (!moment) return null;

  const filteredImages = getFilteredAndSortedImages();

  // Focus the photo element when focusedPhotoIndex changes
  useEffect(() => {
    if (photoRefs.current[focusedPhotoIndex] && focusedPhotoIndex < photoRefs.current.length) {
      photoRefs.current[focusedPhotoIndex].focus();
    }
  }, [focusedPhotoIndex]);

  // Ensure refs are populated when filtered images change
  useEffect(() => {
    // Wait for refs to be populated
    const timer = setTimeout(() => {
      if (photoRefs.current.length > 0 && focusedPhotoIndex === 0) {
        photoRefs.current[0]?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [filteredImages, focusedPhotoIndex]);

  // Calculate caption text
  const getCaptionText = () => {
    // Use the same filtering logic as handleSavePhotos for consistency
    const actualAdditions = Array.from(photosToAdd).filter(id => !isPhotoInMoment(id));
    const actualRemovals = Array.from(photosToRemove).filter(id => isPhotoInMoment(id));
    
    const addCount = actualAdditions.length;
    const removeCount = actualRemovals.length;
    const currentCount = (momentPhotosMap[moment?.momentID] || []).length;
    const finalCount = currentCount - removeCount + addCount;
    
    if (removeCount === 0 && addCount === 0) {
      return `No changes. Total: ${currentCount}`;
    }
    
    // Count how many additions are "shifted" from other moments
    const shiftedCount = actualAdditions.filter(id => {
      const momentInfo = getPhotoMomentInfo(id);
      return momentInfo && !momentInfo.isCurrentMoment;
    }).length;
    
    let caption = "";
    if (removeCount > 0) {
      caption += `Remove ${removeCount}`;
    }
    if (addCount > 0) {
      if (caption) caption += ", ";
      if (shiftedCount > 0) {
        caption += `add ${addCount} (inc. ${shiftedCount} shifted)`;
      } else {
        caption += `add ${addCount}`;
      }
    }
    caption += `. Total: ${finalCount}`;
    
    return caption;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
        <motion.div 
          ref={modalRef}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          tabIndex={-1}
        >
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Edit Photos: {moment.label}</h3>
            <div className="flex space-x-2">
              <button onClick={handleReset} className="btn-secondary">Reset</button>
              <button onClick={handleSavePhotos} className="btn-primary">Save Changes</button>
              <button onClick={handleClose} className="btn-secondary">Cancel</button>
            </div>
          </div>
          {error && (
            <div className="mt-2 text-red-600 text-sm">{error}</div>
          )}
          
          {/* Compact caption */}
          <div className="mt-2 text-sm text-gray-600 font-medium">
            {getCaptionText()}
          </div>
          
          {/* Filter and Sort Controls */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center space-x-2">
              {/* Sort button - moved before filter */}
              <button
                onClick={handleToggleSortOrder}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
                title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
              >
                {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
              
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filter:</span>
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'all' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('in-moment')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'in-moment' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                In Moment
              </button>
              <button
                onClick={() => setFilterType('not-in-moment')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'not-in-moment' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Not in Moment
              </button>
              <button
                onClick={() => setFilterType('in-period')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'in-period' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                In Period
              </button>
            </div>
            <div className="flex items-center space-x-2">
              {/* Select all button - only visible when not all filtered are selected */}
              {!areAllFilteredSelected() && (
                <button
                  onClick={handleSelectAllFiltered}
                  className={`w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center ${
                    areAnyFilteredSelected() 
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title="Select all filtered photos"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              
              {/* Clear button - always visible when any filtered are selected, always red */}
              {areAnyFilteredSelected() && (
                <button
                  onClick={handleClearFilteredSelection}
                  className="w-8 h-8 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors flex items-center justify-center"
                  title="Clear filtered selection"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredImages.map((photo, index) => {
              const selectionState = getPhotoSelectionState(photo.id || photo.imageID);
              const momentInfo = getPhotoMomentInfo(photo.id || photo.imageID);
              const isInPeriod = isPhotoInPeriod(photo.id || photo.imageID);
              const isFocused = index === focusedPhotoIndex;
              
              // Determine border color based on selection state
              let borderClasses = '';
              switch (selectionState) {
                case 'marked-for-addition':
                  borderClasses = 'border-green-500 ring-2 ring-green-200';
                  break;
                case 'marked-for-removal':
                  borderClasses = 'border-red-500 ring-2 ring-red-200';
                  break;
                case 'in-moment':
                  borderClasses = 'border-green-500 ring-2 ring-green-200'; // Green border for photos staying in moment
                  break;
                default:
                  borderClasses = '';
              }
              
              return (
                <div
                  key={photo.id}
                  ref={el => photoRefs.current[index] = el}
                  onClick={() => togglePhoto(photo.id || photo.imageID)}
                  onFocus={() => setFocusedPhotoIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      togglePhoto(photo.id || photo.imageID);
                    }
                  }}
                  className={`photo-item relative cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors focus:outline-none ${borderClasses} ${
                    isFocused ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.5)]' : ''
                  }`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Photo ${photo.name}${selectionState !== 'not-in-moment' ? ' (selected)' : ''}`}
                  data-photo-id={photo.id || photo.imageID}
                >
                  <img
                    src={photo.urls.thumbnail}
                    alt={photo.name}
                    className="w-full h-24 object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                    }}
                  />
                  <div className="p-2 text-xs text-gray-600 truncate">
                    {photo.date_taken ? formatDateTime(photo.date_taken) : photo.name}
                  </div>
                  {momentInfo && (
                    <div className={`absolute top-2 right-2 text-white text-xs px-1 py-0.5 rounded ${
                      momentInfo.isCurrentMoment ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {momentInfo.title}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  );
}

export default EditPhotosModal;