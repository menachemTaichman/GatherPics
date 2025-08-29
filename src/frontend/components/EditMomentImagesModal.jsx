import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, Filter, X, CheckCheck, RotateCcw } from 'lucide-react';
import { sortImagesWithDatePriority, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { imagesAPI, momentsAPI, handleAPIError, optimisticUpdates, urlHelpers } from '../utils/apiService';
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

function EditImagesModal({ moment, momentImagesMap, onRefreshImages, onSave, moments, onClose }) {
  const { updateMoment } = useDataStore();
  const [imagesToAdd, setImagesToAdd] = useState(new Set());
  const [imagesToRemove, setImagesToRemove] = useState(new Set());
  const [allImagesWithTimestamps, setAllImagesWithTimestamps] = useState([]);
  const [imagesInPeriod, setImagesInPeriod] = useState([]);
  const [sortOrder, setSortOrder] = useSetting('editMomentImages_sortOrder', 'asc');
  const [filterType, setFilterType] = useSetting('editMomentImages_filterType', 'all');
  const [error, setError] = useState('');
  const [focusedImageIndex, setFocusedImageIndex] = useState(0);
  const imageRefs = useRef([]);

  // Use modal focus hook with allowOutsideScroll: false to prevent space key scrolling
  const { modalRef } = useModalFocus(true, onClose, {
    allowOutsideScroll: false
  });

  // Reset method - creates empty lists and doesn't pre-select anything
  const handleReset = () => {
    setImagesToAdd(new Set());
    setImagesToRemove(new Set());
  };

  useEffect(() => {
    if (moment) {
      // Call reset when modal opens to ensure clean state
      handleReset();
      
      fetchImagesInPeriod();
      fetchAllImagesWithTimestamps();
      setError('');
    }
  }, [moment, momentImagesMap]);

  // Fetch all images with timestamps when modal opens
  useEffect(() => {
    if (moment) {
      fetchAllImagesWithTimestamps();
    }
  }, [moment]);

  // Refetch images when dependencies change (only if modal is open)
  useEffect(() => {
    if (moment && Object.keys(momentImagesMap).length > 0) {
      fetchAllImagesWithTimestamps();
    }
  }, [momentImagesMap, moment]);

  useEffect(() => {
    if (moment) {
      setError('');
    }
  }, [moment]);

  const fetchAllImagesWithTimestamps = async () => {
    try {
      const data = await imagesAPI.getAll();
      // Filter out invalid images and ensure they have required properties
      const validImages = (data.images || []).filter(img => 
        img && (img.id || img.imageID) && typeof img === 'object'
      );
      setAllImagesWithTimestamps(validImages);
    } catch (error) {
      console.error('Error fetching images:', error);
      const errorInfo = handleAPIError(error, 'Failed to fetch images');
      setError(errorInfo.message);
      setAllImagesWithTimestamps([]);
    }
  };

  const fetchImagesInPeriod = async () => {
    // We don't need to fetch images in period separately anymore
    // The filtering will be done locally in getFilteredAndSortedImages
    setImagesInPeriod([]);
  };

  const handleSaveImages = async () => {
    try {
      // Only proceed if there are actual changes
      if (imagesToAdd.size === 0 && imagesToRemove.size === 0) {
        handleClose();
        return;
      }
      
      // Filter to ensure only actual changes are sent
      const actualAdditions = Array.from(imagesToAdd).filter(id => !isImageInMoment(id));
      const actualRemovals = Array.from(imagesToRemove).filter(id => isImageInMoment(id));
      
      // Call the API directly
      await momentsAPI.update(moment.momentID, {
        images_to_add: actualAdditions,
        images_to_remove: actualRemovals
      });
      
      // Get the updated images for this moment to update the local state
      const updatedImagesResult = await momentsAPI.getImages(moment.momentID);
      const updatedImages = updatedImagesResult.images || [];
      
      // Update the momentImagesMap directly in the parent component
      // This ensures the UI reflects the changes immediately
      if (onRefreshImages) {
        // Pass the updated images data to the parent
        onRefreshImages(moment.momentID, updatedImages);
      }
      
      // Handle images that were moved from other moments
      // We need to remove them from those moments in the local state
      const imagesMovedFromOtherMoments = actualAdditions.filter(id => {
        const momentInfo = getImageMomentInfo(id);
        return momentInfo && !momentInfo.isCurrentMoment;
      });
      
      // Store moment info for moved images before making changes
      // This is needed because getImageMomentInfo won't work after momentImagesMap is updated
      const movedImagesMomentInfo = imagesMovedFromOtherMoments.map(id => {
        const momentInfo = getImageMomentInfo(id);
        return { imageId: id, momentInfo };
      }).filter(item => item.momentInfo && !item.momentInfo.isCurrentMoment);
      
      // Update the momentImagesMap for moments that lost images
      for (const { imageId, momentInfo } of movedImagesMomentInfo) {
        // Remove this image from the other moment in the local state
        if (onRefreshImages) {
          // Get the current images for that moment and remove the moved image
          const otherMomentImages = momentImagesMap[momentInfo.momentId] || [];
          const updatedOtherMomentImages = otherMomentImages.filter(p => 
            (p.id || p.imageID) !== imageId
          );
          // Update the other moment's images
          onRefreshImages(momentInfo.momentId, updatedOtherMomentImages);
        }
      }
      
      // Wait a bit for images to be updated, then update moment data
      // This ensures representative images are calculated with the latest image data
      // Increased delay to ensure backend has fully processed representative image calculation
      await new Promise(resolve => setTimeout(resolve, 300));
            
      // Also trigger a moment update to refresh the moment data
      // This ensures the representative image and other moment data is updated
      // We update the moment directly to avoid triggering change handlers that might conflict
      let updatedMoment = await momentsAPI.getById(moment.momentID);
      if (updatedMoment) {
        
        // If the representative image hasn't changed, wait a bit more and try again
        // This handles cases where the backend needs more time to calculate
        if (updatedMoment.representative_image === moment.representative_image) {
          await new Promise(resolve => setTimeout(resolve, 200));
          updatedMoment = await momentsAPI.getById(moment.momentID);
          if (updatedMoment) {
          }
        }
        
        // Update the moment data directly without triggering change handlers
        // This ensures the representative image and other moment data is updated
        updateMoment(moment.momentID, updatedMoment);
      } else {
        console.warn('Could not get updated moment data for:', moment.momentID);
      }
      
      // Also update the moment data for moments that lost images
      // This ensures the representative image is recalculated
      for (const { imageId, momentInfo } of movedImagesMomentInfo) {
        try {
          let otherMoment = await momentsAPI.getById(momentInfo.momentId);
          if (otherMoment) {
            // Get the current moment data to compare
            const currentMoment = useDataStore.getState().moments.find(m => m.momentID === momentInfo.momentId);
            if (currentMoment) {
              
              // If the representative image hasn't changed, wait a bit more and try again
              if (otherMoment.representative_image === currentMoment.representative_image) {
                await new Promise(resolve => setTimeout(resolve, 200));
                otherMoment = await momentsAPI.getById(momentInfo.momentId);
                if (otherMoment) {
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
      // This is especially important for representative images in carousels and other components
      try {
        // Trigger a small delay to ensure all updates are processed
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Also try to refresh the moments data to ensure representative images are up to date
        // This is a fallback in case the individual moment updates didn't work
        try {
          const allMoments = await momentsAPI.getAll();
          if (allMoments && allMoments.moments) {
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
                
      } catch (error) {
        console.error('Error during data store refresh:', error);
      }
      
      handleClose();
    } catch (error) {
      console.error('Error saving images:', error);
      const errorInfo = handleAPIError(error, 'Failed to save images');
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

  const toggleImage = (imageId) => {
    const isCurrentlyInMoment = isImageInMoment(imageId);
    
    if (isCurrentlyInMoment) {
      // Image is currently in the moment
      if (imagesToRemove.has(imageId)) {
        // Remove from remove list (undo removal)
        setImagesToRemove(prev => {
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
      } else {
        // Add to remove list (mark for removal)
        setImagesToRemove(prev => new Set(prev).add(imageId));
      }
    } else {
      // Image is not currently in the moment
      if (imagesToAdd.has(imageId)) {
        // Remove from add list (undo addition)
        setImagesToAdd(prev => {
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
      } else {
        // Add to add list (mark for addition)
        setImagesToAdd(prev => new Set(prev).add(imageId));
      }
    }
  };

  const handleToggleSortOrder = () => {
    setSortOrder(prev => toggleSortOrder(prev));
  };

  // Check if an image is currently in the moment
  const isImageInMoment = (imageId) => {
    return (momentImagesMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === imageId);
  };

  // Get the effective selection state for an image (considering pending changes)
  const getImageSelectionState = (imageId) => {
    const isCurrentlyInMoment = isImageInMoment(imageId);
    
    if (isCurrentlyInMoment) {
      // Currently in moment
      if (imagesToRemove.has(imageId)) {
        return 'marked-for-removal'; // Red border, will be removed
      }
      return 'in-moment'; // Green border, staying in moment (default state)
    } else {
      // Not currently in moment
      if (imagesToAdd.has(imageId)) {
        return 'marked-for-addition'; // Green border, will be added
      }
      return 'not-in-moment'; // No special border
    }
  };

  // Use moments array to get the title for a moment ID
  const getImageMomentInfo = (imageId) => {
    for (const momentId in momentImagesMap) {
      const momentImages = momentImagesMap[momentId] || [];
      const foundImage = momentImages.find(p => (p.id || p.imageID) === imageId);
      if (foundImage) {
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

  const isImageInPeriod = (imageId) => {
    // Check if image is in period based on moment date range
    if (!moment || !moment.start || !moment.end) return false;
    
    const image = allImagesWithTimestamps.find(img => (img.id || img.imageID) === imageId);
    if (!image || !image.date_taken) return false;
    
    const startDate = new Date(moment.start);
    const endDate = new Date(moment.end);
    const imageDate = new Date(image.date_taken);
    
    return imageDate >= startDate && imageDate <= endDate;
  };

  const getFilteredAndSortedImages = () => {
    let filteredImages = allImagesWithTimestamps;
    if (filterType === 'in-moment') {
      filteredImages = filteredImages.filter(img => 
        img && (img.id || img.imageID) && (momentImagesMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === (img.id || img.imageID))
      );
    } else if (filterType === 'not-in-moment') {
      filteredImages = filteredImages.filter(img => 
        img && (img.id || img.imageID) && !(momentImagesMap[moment?.momentID] || []).some(p => (p.id || p.imageID) === (img.id || img.imageID))
      );
    } else if (filterType === 'in-period') {
      // Filter images locally based on date_taken and moment date range
      if (moment && moment.start && moment.end) {
        const startDate = new Date(moment.start);
        const endDate = new Date(moment.end);
        
        filteredImages = filteredImages.filter(img => {
          if (!img || !img.date_taken) return false;
          
          const imageDate = new Date(img.date_taken);
          return imageDate >= startDate && imageDate <= endDate;
        });
      } else {
        // If moment doesn't have date range, show no images
        filteredImages = [];
      }
    }
    
    // Filter out any invalid images and sort using global utility with date priority
    filteredImages = filteredImages.filter(img => img && (img.id || img.imageID));
    return sortImagesWithDatePriority(filteredImages, sortOrder);
  };

  // Get filtered images for selection operations
  const getFilteredImages = () => {
    return getFilteredAndSortedImages();
  };

  // Handle select all for filtered images
  const handleSelectAllFiltered = () => {
    const filteredImages = getFilteredImages();
    const filteredImageIds = filteredImages.map(img => img.id || img.imageID);
    
    // Check if all filtered are already effectively selected
    const allSelected = filteredImageIds.every(id => {
      const state = getImageSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
    
    if (allSelected) {
      // Deselect all filtered
      filteredImageIds.forEach(id => {
        const isCurrentlyInMoment = isImageInMoment(id);
        if (isCurrentlyInMoment) {
          // Add to remove list (mark for removal)
          setImagesToRemove(prev => new Set(prev).add(id));
        } else {
          // Remove from add list
          setImagesToAdd(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      });
    } else {
      // Select all filtered
      filteredImageIds.forEach(id => {
        const isCurrentlyInMoment = isImageInMoment(id);
        if (isCurrentlyInMoment) {
          // Remove from remove list (keep in moment)
          setImagesToRemove(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        } else {
          // Add to add list
          setImagesToAdd(prev => new Set(prev).add(id));
        }
      });
    }
  };

  // Handle clear selection for filtered images
  const handleClearFilteredSelection = () => {
    const filteredImages = getFilteredImages();
    const filteredImageIds = filteredImages.map(img => img.id || img.imageID);
    
    filteredImageIds.forEach(id => {
      const isCurrentlyInMoment = isImageInMoment(id);
      if (isCurrentlyInMoment) {
        // Add to remove list (mark for removal)
        setImagesToRemove(prev => new Set(prev).add(id));
      } else {
        // Remove from add list
        setImagesToAdd(prev => {
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
      const state = getImageSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
  };

  // Check if any filtered images are selected
  const areAnyFilteredSelected = () => {
    const filteredImages = getFilteredImages();
    if (filteredImages.length === 0) return false;
    
    return filteredImages.some(img => {
      const id = img.id || img.imageID;
      const state = getImageSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
  };

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e) => {
    const filteredImages = getFilteredAndSortedImages();
    if (filteredImages.length === 0) return;

    // Handle space key when an image is focused
    if (document.activeElement && document.activeElement.closest('.image-item') && e.key === ' ') {
      e.preventDefault();
      const imageId = document.activeElement.getAttribute('data-image-id');
      if (imageId) {
        toggleImage(imageId);
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
        handleSaveImages();
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        setFocusedImageIndex(prev => {
          const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
          const newIndex = prev - cols;
          return newIndex >= 0 ? newIndex : filteredImages.length - 1;
        });
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        setFocusedImageIndex(prev => {
          const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
          const newIndex = prev + cols;
          return newIndex < filteredImages.length ? newIndex : 0;
        });
        break;
      
      case 'ArrowLeft':
        e.preventDefault();
        setFocusedImageIndex(prev => {
          const newIndex = prev > 0 ? prev - 1 : filteredImages.length - 1;
          return newIndex;
        });
        break;
      
      case 'ArrowRight':
        e.preventDefault();
        setFocusedImageIndex(prev => {
          const newIndex = prev < filteredImages.length - 1 ? prev + 1 : 0;
          return newIndex;
        });
        break;
    }
  }, [focusedImageIndex, getFilteredAndSortedImages, handleSaveImages, toggleImage]);

  // Reset focused index when filter or sort changes
  useEffect(() => {
    // Clear old refs when images change
    imageRefs.current = [];
    // Reset focus after a short delay to ensure refs are populated
    setTimeout(() => {
      setFocusedImageIndex(0);
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

  // Focus the image element when focusedImageIndex changes
  useEffect(() => {
    if (imageRefs.current[focusedImageIndex] && focusedImageIndex < imageRefs.current.length) {
      imageRefs.current[focusedImageIndex].focus();
    }
  }, [focusedImageIndex]);

  // Ensure refs are populated when filtered images change
  useEffect(() => {
    // Wait for refs to be populated
    const timer = setTimeout(() => {
      if (imageRefs.current.length > 0 && focusedImageIndex === 0) {
        imageRefs.current[0]?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [filteredImages, focusedImageIndex]);

  // Calculate caption text
  const getCaptionText = () => {
    // Use the same filtering logic as handleSaveImages for consistency
    const actualAdditions = Array.from(imagesToAdd).filter(id => !isImageInMoment(id));
    const actualRemovals = Array.from(imagesToRemove).filter(id => isImageInMoment(id));
    
    const addCount = actualAdditions.length;
    const removeCount = actualRemovals.length;
    const currentCount = (momentImagesMap[moment?.momentID] || []).length;
    const finalCount = currentCount - removeCount + addCount;
    
    if (removeCount === 0 && addCount === 0) {
      return `No changes. Total: ${currentCount}`;
    }
    
    // Count how many additions are "shifted" from other moments
    const shiftedCount = actualAdditions.filter(id => {
      const momentInfo = getImageMomentInfo(id);
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
              <button onClick={handleSaveImages} className="btn-primary">Save Changes</button>
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
                  title="Select all filtered images"
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
            {filteredImages.map((image, index) => {
              const selectionState = getImageSelectionState(image.id || image.imageID);
              const momentInfo = getImageMomentInfo(image.id || image.imageID);
              const isInPeriod = isImageInPeriod(image.id || image.imageID);
              const isFocused = index === focusedImageIndex;
              
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
                  borderClasses = 'border-green-500 ring-2 ring-green-200'; // Green border for images staying in moment
                  break;
                default:
                  borderClasses = '';
              }
              
              return (
                <div
                  key={image.id}
                  ref={el => imageRefs.current[index] = el}
                  onClick={() => toggleImage(image.id || image.imageID)}
                  onFocus={() => setFocusedImageIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggleImage(image.id || image.imageID);
                    }
                  }}
                  className={`image-item relative cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors focus:outline-none ${borderClasses} ${
                    isFocused ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.5)]' : ''
                  }`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Image ${image.label}${selectionState !== 'not-in-moment' ? ' (selected)' : ''}`}
                  data-image-id={image.id || image.imageID}
                >
                  <img
                    src={image.urls?.thumbnail || urlHelpers.getThumbnailUrl(image.id || image.imageID)}
                    alt={image.label || `Image ${image.id || image.imageID}`}
                    className="w-full h-24 object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                    }}
                  />
                  <div className="p-2 text-xs text-gray-600 truncate">
                    {image.date_taken ? formatDateTime(image.date_taken) : image.label}
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

export default EditImagesModal;