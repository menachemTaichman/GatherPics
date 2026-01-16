import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, Filter, X, CheckCheck, RotateCcw } from 'lucide-react';
import { sortImagesWithDatePriority, toggleSortOrder } from '../../utils/sorting';
import { usePreference } from '../../hooks/useSettings';
import { setPreference } from '../../utils/settings';
import { momentsAPI } from '../../utils/apiService';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useDataStore, selectors as storeSelectors } from '../../utils/dataManager';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { useModalStore } from '../../utils/modalManager';
import { formatErrorMessage } from '../../utils/errorHandler';

import { formatTime } from '../../utils/dateUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import AbsoluteMasonryGrid from '../images/AbsoluteMasonryGrid';
import { ImageComponent } from '../../hooks/useImage.jsx';

// Stable empty Set to avoid creating new instances
const EMPTY_SET = new Set();

function EditMomentImagesModal({ eventUrl, moment, momentImagesMap, onRefreshImages, onSave, moments, onClose, onToast, urlHelpers: injectedUrlHelpers }) {
  const urlHelpers = injectedUrlHelpers;
  const eventId = useEventId(eventUrl);
  const { updateMoment } = useDataStore();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  
  const MODAL_ID = 'edit-moment-images-modal';
  
  // Subscribe to includeArchived preference
  const includeArchived = usePreference('general.includeArchived', false);
  
  // Get moment ID once and memoize it
  const momentId = useMemo(() => moment?.id || moment?.moment_id, [moment?.id, moment?.moment_id]);
  
  // Subscribe to all images from store using selector
  const storeImages = useDataStore(state => storeSelectors.imagesAll(state, eventId));
  
  // Subscribe to current moment from store (for reactive label updates) - use stable selector
  const currentMoment = useDataStore(useCallback(state => {
    if (!momentId) return null;
    return state.entities?.[eventId]?.moments?.[momentId] || null;
  }, [momentId, eventId]));
  
  // Subscribe to all moments for getting image-moment relationships
  const allMomentsFromStore = useDataStore(state => storeSelectors.momentsAll(state, eventId));
  
  // Filter images based on includeArchived preference
  const allImagesWithTimestamps = useMemo(() => {
    return storeImages.filter(img => includeArchived || !img.is_archived);
  }, [storeImages, includeArchived]);
  
  // Compute current moment's image IDs from images' moment_id field (not from moment.images Set)
  const currentMomentImageIds = useMemo(() => {
    if (!momentId) return EMPTY_SET;
    const ids = new Set();
    allImagesWithTimestamps.forEach(img => {
      if (img && img.moment_id === momentId) {
        ids.add(img.id);
      }
    });
    return ids;
  }, [allImagesWithTimestamps, momentId]);
  
  const [imagesToAdd, setImagesToAdd] = useState(new Set());
  const [imagesToRemove, setImagesToRemove] = useState(new Set());
  const sortOrder = usePreference('EditMomentImagesModal.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('EditMomentImagesModal.sortDir', value);
  const filterType = usePreference('EditMomentImagesModal.filter', 'all');
  const setFilterType = (value) => setPreference('EditMomentImagesModal.filter', value);
  const [error, setError] = useState('');
  const [focusedImageIndex, setFocusedImageIndex] = useState(0);
  const imageRefs = useRef([]);
  const scrollContainerRef = useRef(null);

  // Use modal focus hook with proper modal manager integration
  const { modalRef } = useModalFocus(true, onClose, {
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID
  });

  // Reset method - creates empty lists and doesn't pre-select anything
  const handleReset = () => {
    setImagesToAdd(new Set());
    setImagesToRemove(new Set());
  };

  // Apply scope for all images
  useApplyScopes([{ entity: 'all', id: 'images', eventId }]);
  
  // Register modal with modal manager
  useEffect(() => {
    if (moment) {
      const { registerModal, unregisterModal } = useModalStore.getState();
      try {
        registerModal({ 
          id: MODAL_ID, 
          type: 'popup', 
          allowOutsideScroll: true 
        });
      } catch {}
      
      handleReset();
      setError('');
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        if (onClose) {
          onClose();
        }
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [moment]);

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
      
      // Call the separate add/remove endpoints - changes are applied by interceptor
      if (actualAdditions.length > 0) {
        await momentsAPI.addImages(momentId, actualAdditions, eventUrl);
      }
      
      if (actualRemovals.length > 0) {
        await momentsAPI.removeImages(actualRemovals, eventUrl);
      }
      
      // Wait a bit for store to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Refresh the current moment to get updated representative image
      await momentsAPI.getById(momentId, eventUrl);
      
      // Legacy parent callback (can be removed in future if parent uses store)
      if (onRefreshImages) {
        const store = useDataStore.getState();
        const imageIds = store.entities?.[eventId]?.moments?.[momentId]?.images || EMPTY_SET;
        const images = Array.from(imageIds).map(id => store.entities?.[eventId]?.images?.[id]).filter(Boolean);
        onRefreshImages(momentId, images);
      }
      
      handleClose();
    } catch (error) {
      console.error('Error saving images:', error);
      if (onToast) {
        onToast(formatErrorMessage('save images', error), 'error');
      }
    }
  };

  const handleClose = () => {
    setError('');
    
    // Store current scroll position before closing
    const currentScroll = window.scrollY;
    
    // Call the parent's onClose function
    if (onClose) {
      onClose();
    }
    
    // Restore scroll position after a short delay to prevent jumps
    requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - currentScroll) > 5) {
        window.scrollTo({ top: currentScroll, behavior: 'instant' });
      }
    });
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

  // Check if an image is currently in the moment (using moment_id field)
  const isImageInMoment = useCallback((imageId) => {
    if (!momentId) return false;
    const image = allImagesWithTimestamps.find(img => img.id === imageId);
    return image?.moment_id === momentId;
  }, [momentId, allImagesWithTimestamps]);

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

  // Memoize image-to-moment mapping for performance
  const imageMomentMap = useMemo(() => {
    const map = new Map();
    const store = useDataStore.getState();
    const moments = store.entities?.[eventId]?.moments || {};
    const images = store.entities?.[eventId]?.images || {};
    
    // Simply iterate through all images and use their moment_id field
    for (const [imageId, image] of Object.entries(images)) {
      if (image?.moment_id) {
        const imageMomentId = image.moment_id;
        const momentObj = moments[imageMomentId];
        if (momentObj) {
          map.set(imageId, {
            momentId: imageMomentId,
            title: momentObj.label || imageMomentId,
            isCurrentMoment: imageMomentId === momentId
          });
        }
      }
    }
    
    return map;
  }, [storeImages, allMomentsFromStore, momentId]);
  
  // Use memoized map to get moment info
  const getImageMomentInfo = useCallback((imageId) => {
    return imageMomentMap.get(imageId) || null;
  }, [imageMomentMap]);

  const isImageInPeriod = (imageId) => {
    // Check if image is in period based on moment date range
    if (!moment || !moment.start_date || !moment.end_date) return false;
    
    const image = allImagesWithTimestamps.find(img => img.id === imageId);
    if (!image || !image.date_taken) return false;
    
    const startDate = new Date(moment.start_date);
    const endDate = new Date(moment.end_date);
    const imageDate = new Date(image.date_taken);
    
    return imageDate >= startDate && imageDate <= endDate;
  };

  const getFilteredAndSortedImages = () => {
    let filteredImages = allImagesWithTimestamps;
    if (filterType === 'in-moment') {
      filteredImages = filteredImages.filter(img => 
        img && img.id && img.moment_id === momentId
      );
    } else if (filterType === 'not-in-moment') {
      filteredImages = filteredImages.filter(img => 
        img && img.id && img.moment_id !== momentId
      );
    } else if (filterType === 'in-period') {
      // Filter images locally based on date_taken and moment date range
      if (moment && moment.start_date && moment.end_date) {
        const startDate = new Date(moment.start_date);
        const endDate = new Date(moment.end_date);
        
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
    filteredImages = filteredImages.filter(img => img && img.id);
    return sortImagesWithDatePriority(filteredImages, sortOrder);
  };

  // Get filtered images for selection operations
  const getFilteredImages = () => {
    return getFilteredAndSortedImages();
  };

  // Handle select all for filtered images
  const handleSelectAllFiltered = () => {
    const filteredImages = getFilteredImages();
    const filteredImageIds = filteredImages.map(img => img.id);
    
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
    const filteredImageIds = filteredImages.map(img => img.id);
    
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
      const id = img.id;
      const state = getImageSelectionState(id);
      return state === 'marked-for-addition' || state === 'in-moment';
    });
  };

  // Check if any filtered images are selected
  const areAnyFilteredSelected = () => {
    const filteredImages = getFilteredImages();
    if (filteredImages.length === 0) return false;
    
    return filteredImages.some(img => {
      const id = img.id;
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

  // Memoize filteredImages to prevent infinite loops
  const filteredImages = useMemo(() => getFilteredAndSortedImages(), [
    allImagesWithTimestamps,
    momentId,
    filterType,
    sortOrder,
    moment?.start_date,
    moment?.end_date
  ]);

  // Define renderItem separately to keep reference stable
  const renderImageItem = useCallback((image, index, isPortrait, setRef) => {
    const selectionState = getImageSelectionState(image.id);
    const momentInfo = getImageMomentInfo(image.id);
    const isInPeriod = isImageInPeriod(image.id);
    const isFocused = index === focusedImageIndex;
    
    // Determine border color based on selection state - using outline for outer border
    let borderStyle = {};
    let borderClasses = 'border border-gray-200';
    switch (selectionState) {
      case 'marked-for-addition':
        borderStyle = {
          outline: '4px solid rgb(34, 197, 94)', // green-500
          outlineOffset: '-4px',
          boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.2)' // green-200 ring
        };
        break;
      case 'marked-for-removal':
        borderStyle = {
          outline: '4px solid rgb(239, 68, 68)', // red-500
          outlineOffset: '-4px',
          boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.2)' // red-200 ring
        };
        break;
      case 'in-moment':
        borderStyle = {
          outline: '4px solid rgb(34, 197, 94)', // green-500
          outlineOffset: '-4px',
          boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.2)' // green-200 ring
        };
        break;
      default:
        borderStyle = {};
    }
    
    return (
      <div
        className={`image-item relative cursor-pointer border rounded-lg overflow-visible hover:border-primary-500 transition-colors focus:outline-none ${borderClasses} ${
          isFocused ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.5)]' : ''
        }`}
        style={{ width: '100%', height: '100%', ...borderStyle }}
        onClick={() => toggleImage(image.id)}
        onFocus={() => setFocusedImageIndex(index)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggleImage(image.id);
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`Image ${image.label}${selectionState !== 'not-in-moment' ? ' (selected)' : ''}`}
        data-image-id={image.id}
      >
        <div className="w-full h-full rounded-lg overflow-hidden">
          {ImageComponent(
            image.urls?.thumbnail || (urlHelpers && urlHelpers.getThumbnailUrl(image.id)),
            {
              width: 200,
              height: 200,
              className: 'w-full h-24 object-cover',
              alt: image.label || `Image ${image.id}`,
              loading: 'eager' // Let Virtuoso handle the loading/unloading
            }
          )}
          <div className="p-2 text-xs text-gray-600 truncate">
            {image.date_taken ? formatTime(image.date_taken) : image.label}
          </div>
          {momentInfo && (
            <div className={`absolute top-2 ${endClass('2')} text-white text-xs px-1 py-0.5 rounded ${
              momentInfo.isCurrentMoment ? 'bg-green-500' : 'bg-red-500'
            }`}>
              {momentInfo.title}
            </div>
          )}
        </div>
      </div>
    );
  }, [focusedImageIndex, imagesToAdd, imagesToRemove, currentMomentImageIds, imageMomentMap, moment, allImagesWithTimestamps, urlHelpers, endClass, momentId]);

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
  }, [filteredImages.length, focusedImageIndex]);

  // Prevent scroll propagation to background when scrolling within modal
  const handleWheel = useCallback((e) => {
    const target = scrollContainerRef.current;
    if (!target) return;
    
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const height = target.clientHeight;
    const delta = e.deltaY;
    
    const isAtTop = scrollTop === 0;
    const isAtBottom = scrollTop + height >= scrollHeight - 1;
    
    if ((isAtTop && delta < 0) || (isAtBottom && delta > 0)) {
      // At boundary, prevent propagation to background
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Attach wheel event listener with passive: false
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

  // Calculate caption text
  const getCaptionText = () => {
    // Use the same filtering logic as handleSaveImages for consistency
    const actualAdditions = Array.from(imagesToAdd).filter(id => !isImageInMoment(id));
    const actualRemovals = Array.from(imagesToRemove).filter(id => isImageInMoment(id));
    
    const addCount = actualAdditions.length;
    const removeCount = actualRemovals.length;
    const currentCount = currentMomentImageIds.size;
    const finalCount = currentCount - removeCount + addCount;
    
    if (removeCount === 0 && addCount === 0) {
      return `${t('moments.noChanges')} ${currentCount}`;
    }
    
    // Count how many additions are "shifted" from other moments
    const shiftedCount = actualAdditions.filter(id => {
      const momentInfo = getImageMomentInfo(id);
      return momentInfo && !momentInfo.isCurrentMoment;
    }).length;
    
    let caption = "";
    if (removeCount > 0) {
      caption += `${t('moments.remove')} ${removeCount}`;
    }
    if (addCount > 0) {
      if (caption) caption += ", ";
      if (shiftedCount > 0) {
        caption += `${t('moments.add')} ${addCount} (${t('moments.including')} ${shiftedCount} ${t('moments.shifted')})`;
      } else {
        caption += `${t('moments.add')} ${addCount}`;
      }
    }
    caption += `. ${t('moments.total')} ${finalCount}`;
    
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
          className="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-2 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
        <div className="p-3 sm:p-4 md:p-6 border-b">
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-bold truncate min-w-0">{t('moments.editPhotosTitle')} {currentMoment?.label || moment.label}</h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button 
                onClick={handleReset} 
                className="w-8 h-8 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center"
                title={t('moments.reset')}
                aria-label={t('moments.reset')}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button 
                onClick={handleSaveImages} 
                className="w-8 h-8 rounded-md bg-primary-600 hover:bg-primary-700 text-white flex items-center justify-center"
                title={t('moments.saveChanges')}
                aria-label={t('moments.saveChanges')}
              >
                <CheckCheck className="w-4 h-4" />
              </button>
              <button 
                onClick={handleClose} 
                className="w-8 h-8 rounded-md hover:bg-red-100 text-red-700 flex items-center justify-center"
                title={t('moments.cancel')}
                aria-label={t('moments.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mt-3 sm:mt-4 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Sort button - moved before filter */}
              <button
                onClick={handleToggleSortOrder}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center flex-shrink-0"
                title={sortOrder === 'asc' ? t('moments.sortDescending') : t('moments.sortAscending')}
                aria-label={sortOrder === 'asc' ? t('moments.sortDescending') : t('moments.sortAscending')}
              >
                {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
              
              <Filter className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium text-gray-700 hidden sm:inline">{t('moments.filter')}</span>
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
                    filterType === 'all' 
                      ? 'bg-primary-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('moments.all')}
                </button>
                <button
                  onClick={() => setFilterType('in-moment')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
                    filterType === 'in-moment' 
                      ? 'bg-primary-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('moments.inMoment')}
                </button>
                <button
                  onClick={() => setFilterType('not-in-moment')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
                    filterType === 'not-in-moment' 
                      ? 'bg-primary-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('moments.notInMoment')}
                </button>
                <button
                  onClick={() => setFilterType('in-period')}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${
                    filterType === 'in-period' 
                      ? 'bg-primary-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('moments.inPeriod')}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Select all button - only visible when not all filtered are selected */}
              {!areAllFilteredSelected() && (
                <button
                  onClick={handleSelectAllFiltered}
                  className={`w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center ${
                    areAnyFilteredSelected() 
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title={t('moments.selectAllFiltered')}
                  aria-label={t('moments.selectAllFiltered')}
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              
              {/* Clear button - always visible when any filtered are selected, always red */}
              {areAnyFilteredSelected() && (
                <button
                  onClick={handleClearFilteredSelection}
                  className="w-8 h-8 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors flex items-center justify-center"
                  title={t('moments.clearFilteredSelection')}
                  aria-label={t('moments.clearFilteredSelection')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {filteredImages.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-gray-500 p-3 sm:p-4 md:p-6">
              {t('moments.noImages')}
            </div>
          ) : (
            <div className="flex-1 min-h-0 p-3 sm:p-4 md:p-6 overflow-x-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
              <AbsoluteMasonryGrid
                items={filteredImages}
                baseSize={120}
                containerHeight="100%"
                className="w-full h-full overflow-x-hidden"
                gap={12}
                imageClasses={{}}
                bufferMultiplier={3.0}
                style={{ flex: '1 1 0', minHeight: 0 }}
                onPinchRef={(node) => {
                  scrollContainerRef.current = node;
                }}
                onItemRef={(image, index, el) => {
                  if (el) {
                    imageRefs.current[index] = el;
                  }
                }}
                renderItem={renderImageItem}
              />
            </div>
          )}
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  );
}

export default EditMomentImagesModal;


