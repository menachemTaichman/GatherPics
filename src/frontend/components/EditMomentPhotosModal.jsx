import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, Filter, X, CheckCheck } from 'lucide-react';
import { sortPhotosWithDatePriority, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';
import { imagesAPI, momentsAPI, handleAPIError } from '../utils/apiService';
import { useModalFocus } from '../utils/useModalFocus';

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
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
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

  useEffect(() => {
    if (moment) {
      const currentPhotos = (momentPhotosMap[moment.momentID] || []).map(p => p.name);
      setSelectedPhotos(new Set(currentPhotos));
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
      // Calculate which photos to add and remove instead of sending the full list
      const currentPhotos = getCurrentMomentPhotos();
      const newPhotos = Array.from(selectedPhotos);
      
      // Find photos to add (in newPhotos but not in currentPhotos)
      const photosToAdd = newPhotos.filter(photo => !currentPhotos.includes(photo));
      
      // Find photos to remove (in currentPhotos but not in newPhotos)
      const photosToRemove = currentPhotos.filter(photo => !newPhotos.includes(photo));
      
      // Only proceed if there are actual changes
      if (photosToAdd.length === 0 && photosToRemove.length === 0) {
        console.log('No photo changes detected, closing modal');
        handleClose();
        return;
      }
      
      console.log('Updating moment photos incrementally:', {
        photosToAdd,
        photosToRemove,
        totalChanges: photosToAdd.length + photosToRemove.length
      });
      
      // Update the moment with incremental photo changes
      const updatedMoment = {
        ...moment,
        photos_to_add: photosToAdd,
        photos_to_remove: photosToRemove
      };

      // The API service interceptor will automatically handle the state updates
      await onSave(updatedMoment);
      
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
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleToggleSortOrder = () => {
    setSortOrder(prev => toggleSortOrder(prev));
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

  // Get current photos from the moment
  const getCurrentMomentPhotos = () => {
    if (!moment || !momentPhotosMap[moment.momentID]) {
      return [];
    }
    return momentPhotosMap[moment.momentID].map(p => p.id || p.imageID);
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
          return newIndex >= 0 ? newIndex : prev;
        });
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2;
          const newIndex = prev + cols;
          return newIndex < filteredImages.length ? newIndex : prev;
        });
        break;
      
      case 'ArrowLeft':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          return newIndex;
        });
        break;
      
      case 'ArrowRight':
        e.preventDefault();
        setFocusedPhotoIndex(prev => {
          const newIndex = prev < filteredImages.length - 1 ? prev + 1 : prev;
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
              <button onClick={handleSavePhotos} className="btn-primary">Save Changes</button>
              <button onClick={handleClose} className="btn-secondary">Cancel</button>
            </div>
          </div>
          {error && (
            <div className="mt-2 text-red-600 text-sm">{error}</div>
          )}
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
              {selectedPhotos.size > 0 && (
                <button
                  onClick={() => setSelectedPhotos(new Set())}
                  className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-red-100 text-red-700"
                  title="Clear selection"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => {
                  const filteredImages = getFilteredAndSortedImages();
                  const filteredPhotoIds = filteredImages.map(img => img.id || img.imageID);
                  const allSelected = filteredPhotoIds.every(id => selectedPhotos.has(id));
                  
                  if (allSelected) {
                    // Deselect all filtered
                    setSelectedPhotos(prev => {
                      const next = new Set(prev);
                      filteredPhotoIds.forEach(id => next.delete(id));
                      return next;
                    });
                  } else {
                    // Select all filtered
                    setSelectedPhotos(prev => {
                      const next = new Set(prev);
                      filteredPhotoIds.forEach(id => next.add(id));
                      return next;
                    });
                  }
                }}
                className={`w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center ${
                  (() => {
                    const filteredImages = getFilteredAndSortedImages();
                    const filteredPhotoIds = filteredImages.map(img => img.id || img.imageID);
                    const allSelected = filteredPhotoIds.every(id => selectedPhotos.has(id));
                    return allSelected
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      : 'hover:bg-gray-100 text-gray-700';
                  })()
                }`}
                title={(() => {
                  const filteredImages = getFilteredAndSortedImages();
                  const filteredPhotoIds = filteredImages.map(img => img.id || img.imageID);
                  const allSelected = filteredPhotoIds.every(id => selectedPhotos.has(id));
                  return allSelected ? "Deselect all filtered photos" : "Select all filtered photos";
                })()}
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredImages.map((photo, index) => {
              const isSelected = selectedPhotos.has(photo.id || photo.imageID);
              const momentInfo = getPhotoMomentInfo(photo.id || photo.imageID);
              const isInPeriod = isPhotoInPeriod(photo.id || photo.imageID);
              const isFocused = index === focusedPhotoIndex;
              
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
                  className={`photo-item relative cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors focus:outline-none ${
                    isSelected ? 'border-purple-500 ring-2 ring-purple-200' : 
                    isInPeriod && !momentInfo ? 'border-red-500 ring-2 ring-red-200' : ''
                  } ${
                    isFocused ? 'ring-2 ring-blue-400 ring-offset-2' : ''
                  }`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Photo ${photo.name}${isSelected ? ' (selected)' : ''}`}
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