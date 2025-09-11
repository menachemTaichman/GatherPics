import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Image, Grid, List, Minus, Plus, Settings, Clock, Calendar, CheckCheck, X, ShoppingBag, Trash2, Move, Pencil, Square, CheckSquare } from 'lucide-react';
import ImageViewer from './ImageViewer';
import EditMomentsModal from './EditMomentsModal';
import EditMomentImagesModal from './EditMomentImagesModal';
import FloatingSelectionControls from './FloatingSelectionControls';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useSetting } from '../utils/useSettings';
import { useDataStore, CHANGE_TYPES, handleDataChange } from '../utils/dataManager';
import { momentsAPI, imagesAPI, API_BASE, albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import MomentCard from './MomentCard';
import timelineManager from '../utils/timeline';
import { getSetting, setSetting } from '../utils/settings';
import useBucketStore from '../utils/bucketStore';


function formatTimeOnly(dateString) {
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
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateString;
  }
}

export default function Moments({ eventUrl }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { urlHelpers, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
  const { 
    moments, 
    setMoments, 
    updateMoment, 
    deleteMoment, 
    addMoment,
    loading: storeLoading,
    error: storeError,
    setLoading: setStoreLoading,
    setError: setStoreError
  } = useDataStore();
  
  const [images, setImages] = useState([]);
  const [viewMode, setViewMode] = useSetting('moments_viewMode', 'grid');
  const [imageSize, setImageSize] = useSetting('moments_imageSize', 1.0);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [includeArchived] = useSetting('include_archived_images', false);
  const [momentImagesMap, setMomentImagesMap] = useState({});
  const [imagesLoading, setImagesLoading] = useState(false);
  const [globalSelection, setGlobalSelection] = useState(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetMoment, setTargetMoment] = useState(null);
  const [carouselVisible, setCarouselVisible] = useSetting('moments_carouselVisible', true);
  const [currentVisibleMoment, setCurrentVisibleMoment] = useState(null);
  const [imageViewer, setImageViewer] = useState({ show: false, image: null, index: 0, images: [] });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const { addImages, open } = useBucketStore();
  
  // New state for checkbox visibility and selection mode
  const [selectionMode, setSelectionMode] = useSetting('selectionMode', false);
  const [lastSelectedImage, setLastSelectedImage] = useState(null);

  // Load selected images from cache when component mounts
  useEffect(() => {
    const cachedSelection = getSetting('moments_selection');
    if (cachedSelection && Array.isArray(cachedSelection)) {
      setGlobalSelection(new Set(cachedSelection));
    }
  }, []);
  
  // Save selection to cache whenever it changes
  useEffect(() => {
    if (globalSelection.size > 0) {
      setSetting('moments_selection', Array.from(globalSelection));
    } else {
      // Clear cache when selection is empty
      try {
        localStorage.removeItem('face_gallery_settings_moments_selection');
      } catch (error) {
        console.warn('Failed to clear selection cache:', error);
      }
    }
  }, [globalSelection]);

  // Toast notification function
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  const momentsRef = useRef({});
  const [showEditMomentsModal, setShowEditMomentsModal] = useState(false);
  const navigateRef = useRef(navigate);


  // Update the ref when navigate changes
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Initialize timeline manager when component mounts
  useEffect(() => {
    timelineManager.init(`/${eventUrl}/timeline`, '.sticky.top-16', (momentKey) => {
      // Callback from timeline manager when moment changes
      const moment = moments.find(m => m.label === momentKey);
      if (moment) {
        setCurrentVisibleMoment(moment);
      }
    });
    
    return () => {
      timelineManager.destroy();
    };
  }, [moments, eventUrl]);

  // Clean up refs when moments change
  useEffect(() => {
    // Clear old refs
    momentsRef.current = {};
  }, [moments]);

  // Callback ref function to set refs for moment elements
  const setMomentRef = useCallback((momentIdOrName) => (element) => {
    if (element) {
      momentsRef.current[momentIdOrName] = element;
      // Register with timeline manager using name key
      timelineManager.registerMoment(momentIdOrName, element);
    } else {
      // Clean up ref when element is unmounted
      delete momentsRef.current[momentIdOrName];
      timelineManager.unregisterMoment(momentIdOrName);
    }
  }, []);

  useEffect(() => {
    fetchMoments();
    fetchImages();
  }, []);

  // Refetch images when includeArchived setting changes
  useEffect(() => {
    if (moments.length > 0) {
      // Force refetch all images to respect new includeArchived setting
      fetchAllMomentImages(null, null, true);
    }
  }, [includeArchived]);

  // Remove archived images from grid when includeArchived is false
  useEffect(() => {
    if (!includeArchived) {
      setMomentImagesMap(prev => {
        const newMap = { ...prev };
        Object.keys(newMap).forEach(momentId => {
          newMap[momentId] = newMap[momentId].filter(img => !img.is_archived);
        });
        return newMap;
      });
    }
  }, [includeArchived]);

  // Handle navigation from Face Detail to scroll to specific moment
  useEffect(() => {
    if (location.state?.scrollToMoment && moments.length > 0) {
      const momentId = location.state.scrollToMoment;
      window.history.replaceState({}, document.title);
      const moment = moments.find(m => m.momentID === momentId);
      if (moment) {
        timelineManager.navigateToMoment(moment.label, moment.label);
      }
    }
  }, [location.state, moments]);

  // Handle URL query parameter for moment (moment name)
  useEffect(() => {
    if (moments.length > 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const momentName = urlParams.get('moment');
      if (momentName) {
        const decodedName = decodeURIComponent(momentName);
        const moment = moments.find(m => m.label === decodedName);
        if (moment) {
          timelineManager.navigateToMoment(moment.label, moment.label);
        }
      }
    }
  }, [moments, location.search]);

  // Recalculate timeline offset when carousel visibility changes
  useEffect(() => {
    // Use a delay to ensure the DOM has updated and animations complete
    const timer = setTimeout(() => {
      timelineManager.recalculateOffset();
    }, 400); // Slightly longer than timeline manager's delay to ensure DOM is ready
    return () => clearTimeout(timer);
  }, [carouselVisible]);

  // The timeline manager now handles all scroll detection and URL updates automatically

  const fetchAllMomentImages = async (specificMomentId = null, updatedImages = null, forceRefetch = false) => {
    try {
      setImagesLoading(true);
      
      // If specific moment and images are provided, update just that moment
      if (specificMomentId && updatedImages !== null) {

        setMomentImagesMap(prev => ({
          ...prev,
          [specificMomentId]: updatedImages
        }));
        setImagesLoading(false);
        return;
      }
      
      const validMoments = moments.filter(moment => moment.momentID && !moment.momentID.startsWith('temp-'));
      
      // Check which moments need images fetched (or all if forceRefetch is true)
      const momentsToFetch = forceRefetch ? validMoments : validMoments.filter(moment => !momentImagesMap[moment.momentID]);
      
      if (momentsToFetch.length === 0) {
        // All images are already loaded
        setImagesLoading(false);
        return;
      }
      
      // Use parallel API calls for moments that need images fetched
      const imagePromises = momentsToFetch.map(async (moment) => {
        try {
          const result = await momentsAPI.getImages(moment.momentID, eventUrl);
          return { momentId: moment.momentID, images: result.images || [] };
        } catch (error) {
          console.error(`Error fetching images for moment ${moment.momentID}:`, error);
          return { momentId: moment.momentID, images: [] };
        }
      });

      // Wait for all image requests to complete in parallel
      const results = await Promise.all(imagePromises);
      
      // Update the images map
      setMomentImagesMap(prev => {
        const newMap = { ...prev };
        results.forEach(({ momentId, images }) => {
          newMap[momentId] = images;
        });
        return newMap;
      });
      
    } catch (error) {
      console.error('Error fetching moment images:', error);
    } finally {
      setImagesLoading(false);
    }
  };

  useEffect(() => {
    if (moments.length > 0) {
      fetchAllMomentImages();
    }
  }, [moments]);

  const fetchMoments = async () => {
    try {
      setStoreLoading(true);
      const response = await momentsAPI.getAll(eventUrl);
      setMoments(response.moments || []);
      setStoreError(null);
    } catch (err) {
      setStoreError('Failed to load moments.');
    } finally {
      setStoreLoading(false);
    }
  };

  const fetchImages = async () => {
    try {
      const response = await imagesAPI.getAll(eventUrl);
      setImages(response.images || []);
    } catch (err) {
      console.error('Error fetching images:', err);
    }
  };

  const handleSaveMoments = async (updatedMoment) => {
    try {
      const response = await momentsAPI.update(updatedMoment.momentID, updatedMoment, eventUrl);

      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);

          // If this is a moment update, also update the momentImagesMap
          if (change.type === CHANGE_TYPES.MOMENT_UPDATED) {
            updateMomentImagesMap(change.data.momentID);
          }
        });
      } else {
        // Fallback to direct update if no change instructions
        updateMoment(updatedMoment.momentID, response.moment || response);
        // Also update the momentImagesMap
        updateMomentImagesMap(updatedMoment.momentID);
      }

      // Return the response so the caller knows the operation succeeded
      return response;

      // setShowEditModal(false); // This state is now managed by modalManager
    } catch (error) {
      console.error('Error updating moment:', error);
      showToast('Failed to update moment', 'error');
    }
  };

  // Function to update the momentImagesMap for a specific moment
  const updateMomentImagesMap = async (momentId) => {
    try {
      const result = await momentsAPI.getImages(momentId);
      
      setMomentImagesMap(prev => ({
        ...prev,
        [momentId]: result.images || []
      }));
      
    } catch (error) {
      console.error('Error updating moment images map:', error);
    }
  };

  const handleDeleteMoment = async (id) => {
    try {
      const response = await momentsAPI.delete(id, eventUrl);
      
      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      } else {
        // Fallback to direct delete if no change instructions
        deleteMoment(id);
      }
    } catch (error) {
      console.error('Error deleting moment:', error);
    }
  };

  const handleImageSelect = (imageName, momentId, event) => {
    const key = `${momentId}:${imageName}`;
    
    // Handle shift-click for range selection
    if (event?.shiftKey && lastSelectedImage && lastSelectedImage !== key) {
      const [lastMomentId, lastImageName] = lastSelectedImage.split(':');
      
      // Only allow range selection within the same moment
      if (lastMomentId === momentId) {
        const currentImages = momentImagesMap[momentId] || [];
        const lastIndex = currentImages.findIndex(p => p.label === lastImageName);
        const currentIndex = currentImages.findIndex(p => p.label === imageName);
        
        if (lastIndex !== -1 && currentIndex !== -1) {
          const startIndex = Math.min(lastIndex, currentIndex);
          const endIndex = Math.max(lastIndex, currentIndex);
          
          // Add all images in the range
          setGlobalSelection(prev => {
            const next = new Set(prev);
            for (let i = startIndex; i <= endIndex; i++) {
              const image = currentImages[i];
              next.add(`${momentId}:${image.label}`);
            }
            return next;
          });
          setLastSelectedImage(key);
          return;
        }
      }
    }
    
    // Regular click - toggle the image
    setGlobalSelection(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setLastSelectedImage(key);
  };

  // Helper function to get all current image keys
  const getAllCurrentImageKeys = () => {
    const allCurrentImages = new Set();
    Object.entries(momentImagesMap).forEach(([momentId, images]) => {
      images.forEach(image => {
        allCurrentImages.add(`${momentId}:${image.label}`);
      });
    });
    return allCurrentImages;
  };



  const selectAllImages = () => {
    // Button always selects all images from all moments
    const allCurrentImages = getAllCurrentImageKeys();
    
    // Use the global allCurrentSelected variable that's calculated at render time
    if (allCurrentSelected) {
      // All current images are selected, clear selection
      setGlobalSelection(new Set());
      // Clear cache when selection is cleared
      try {
        localStorage.removeItem('face_gallery_settings_moments_selection');
      } catch (error) {
        console.warn('Failed to clear selection cache:', error);
      }
      // Don't reset lastSelectedImage here to preserve shift+click functionality
    } else {
      // Select all images
      setGlobalSelection(allCurrentImages);
    }
  };

  // Separate function for Ctrl+A behavior
  const handleCtrlA = () => {
    // First, try to select from current moment if one is focused
    const currentMoment = currentVisibleMoment;
    
    if (currentMoment) {
      const currentMomentImages = momentImagesMap[currentMoment.momentID] || [];
              const currentMomentImageKeys = currentMomentImages.map(image => `${currentMoment.momentID}:${image.label}`);
      
              // Check if all images in current moment are already selected
        const allCurrentMomentSelected = currentMomentImageKeys.length > 0 && 
          currentMomentImageKeys.every(key => globalSelection.has(key));
        
        if (allCurrentMomentSelected) {
          // Current moment is fully selected, now select all from all moments
          const allCurrentImages = getAllCurrentImageKeys();
          setGlobalSelection(allCurrentImages);
        } else {
          // Select all images from current moment
          setGlobalSelection(prev => {
            const next = new Set(prev);
            currentMomentImageKeys.forEach(key => next.add(key));
            return next;
          });
        }
    } else {
      // No current moment focused, use the same logic as button
      selectAllImages();
    }
  };


  const selectAllInMoment = (momentId) => {
    const momentImages = momentImagesMap[momentId] || [];
    const momentImageKeys = momentImages.map(image => `${momentId}:${image.label}`);
    
    // Check if all images in this moment are already selected
    const allSelected = momentImageKeys.every(key => globalSelection.has(key));
    
    if (allSelected) {
      // Clear selection for this moment
      setGlobalSelection(prev => {
        const next = new Set(prev);
        momentImageKeys.forEach(key => next.delete(key));
        return next;
      });
    } else {
      // Select all images in this moment
      setGlobalSelection(prev => {
        const next = new Set(prev);
        momentImageKeys.forEach(key => next.add(key));
        return next;
      });
    }
  };

  const clearMomentSelection = (momentId) => {
    const momentImages = momentImagesMap[momentId] || [];
    const momentImageKeys = momentImages.map(image => `${momentId}:${image.label}`);
    
    setGlobalSelection(prev => {
      const next = new Set(prev);
      momentImageKeys.forEach(key => next.delete(key));
      return next;
    });
    
    // Note: Cache will be automatically updated by the useEffect that watches globalSelection
  };

  const clearGlobalSelection = () => {
    setGlobalSelection(new Set());
    setLastSelectedImage(null);
    // Clear cache when selection is cleared
    try {
      localStorage.removeItem('face_gallery_settings_moments_selection');
    } catch (error) {
      console.warn('Failed to clear selection cache:', error);
    }
  };



  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Ctrl+A or Cmd+A for select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        handleCtrlA();
      }
      // Escape to clear selection
      if (event.key === 'Escape') {
        clearGlobalSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [momentImagesMap, globalSelection]);

  // Helper function to convert globalSelection keys to actual image IDs
  const getSelectedImageIds = () => {
    return Array.from(globalSelection).map(key => {
      const [mId, label] = key.split(':');
      const list = momentImagesMap[mId] || [];
      const found = list.find(img => img.id === label || img.label === label || img.name === label);
      return found ? found.id : null;
    }).filter(Boolean);
  };

  const handleGlobalAddToBucket = async () => {
    if (globalSelection.size === 0) return;
    const ids = getSelectedImageIds();
    const added = addImages(ids);
    if (added > 0) {
      showToast(`${added} added to bucket`, 'success');
    } else {
      showToast('No new items added', 'success');
    }
    open();
  };

  // Determine if an image is in Favorites
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

  // Unified favorites toggle for selected images
  const handleToggleFavorites = async () => {
    if (globalSelection.size === 0) return;
    
    // Get all selected image objects
    const selectedImageObjects = [];
    Array.from(globalSelection).forEach(key => {
      const [mId, label] = key.split(':');
      const list = momentImagesMap[mId] || [];
      const found = list.find(img => img.id === label || img.label === label || img.name === label);
      if (found) {
        selectedImageObjects.push(found);
      }
    });

    if (selectedImageObjects.length === 0) return;

    const allAreFavorites = selectedImageObjects.every(isImageFavorite);
    const imageIds = getSelectedImageIds();

    try {
      if (allAreFavorites) {
        const res = await albumsAPI.toggleFavorite(imageIds, true, eventUrl);
        const removed = Array.isArray(res.removed_ids) ? res.removed_ids.length : (res.removed || 0);
        showToast(`${removed} removed from Favorites`, 'success');
      } else {
        const res = await albumsAPI.toggleFavorite(imageIds, false, eventUrl);
        const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
        showToast(`${added} added to Favorites`, 'success');
      }
    } catch (e) {
      showToast('Failed to update favorites', 'error');
    }
  };

  // Single image favorites toggle
  const handleSingleToggleFavorites = async (imageIds) => {
    if (!Array.isArray(imageIds) || imageIds.length === 0) return;
    
    // Find the image objects
    const imageObjects = [];
    Object.values(momentImagesMap).forEach(images => {
      images.forEach(img => {
        if (imageIds.includes(img.id)) {
          imageObjects.push(img);
        }
      });
    });

    const allAreFavorites = imageObjects.length > 0 && imageObjects.every(isImageFavorite);

    // Optimistic update
    setMomentImagesMap(prev => {
      const newMap = { ...prev };
      Object.keys(newMap).forEach(momentId => {
        newMap[momentId] = newMap[momentId].map(img => 
          imageIds.includes(img.id) ? { ...img, is_favorite: !allAreFavorites } : img
        );
      });
      return newMap;
    });

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
      setMomentImagesMap(prev => {
        const newMap = { ...prev };
        Object.keys(newMap).forEach(momentId => {
          newMap[momentId] = newMap[momentId].map(img => 
            imageIds.includes(img.id) ? { ...img, is_favorite: allAreFavorites } : img
          );
        });
        return newMap;
      });
    }
  };

  // Single image archive toggle
  const handleSingleToggleArchive = async (imageIds, isRemove = false) => {
    if (!Array.isArray(imageIds) || imageIds.length === 0) return;

    try {
      if (isRemove) {
        const res = await albumsAPI.toggleArchive(imageIds, true, eventUrl);
        const removed = Array.isArray(res.removed_ids) ? res.removed_ids.length : (res.removed || 0);
        
        // Optimistic update
        setMomentImagesMap(prev => {
          const newMap = { ...prev };
          Object.keys(newMap).forEach(momentId => {
            newMap[momentId] = newMap[momentId].map(img => 
              imageIds.includes(img.id) ? { ...img, is_archived: false } : img
            );
          });
          return newMap;
        });

        showToast(
          <span>
            {removed} removed from <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
          </span>,
          'success'
        );
      } else {
        const res = await albumsAPI.addToArchive(imageIds, eventUrl);
        const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
        
        // If not including archived, remove from grid
        if (!includeArchived) {
          setMomentImagesMap(prev => {
            const newMap = { ...prev };
            Object.keys(newMap).forEach(momentId => {
              newMap[momentId] = newMap[momentId].filter(img => !imageIds.includes(img.id));
            });
            return newMap;
          });
        } else {
          // Mark as archived
          setMomentImagesMap(prev => {
            const newMap = { ...prev };
            Object.keys(newMap).forEach(momentId => {
              newMap[momentId] = newMap[momentId].map(img => 
                imageIds.includes(img.id) ? { ...img, is_archived: true } : img
              );
            });
            return newMap;
          });
        }

        showToast(
          <span>
            {added} moved to <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
          </span>,
          'success'
        );
      }
    } catch (e) {
      showToast('Failed to update archive', 'error');
    }
  };

  const handleMoveToArchive = async () => {
    if (globalSelection.size === 0) return;
    
    const imageIds = getSelectedImageIds();
    if (imageIds.length === 0) return;

    try {
      const res = await albumsAPI.addToArchive(imageIds, eventUrl);
      const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
      showToast(`${added} moved to Archive`, 'success');
      clearGlobalSelection();
    } catch (e) {
      showToast('Failed to move to archive', 'error');
    }
  };

  const handleRemoveFromMoment = async () => {
    // This would require backend support to remove images from moments
          alert('Remove photos from moment functionality would be implemented here');
  };

  const handleMoveToMoment = async () => {
    if (!targetMoment || globalSelection.size === 0) return;
    
    try {
      // This would require backend support to move images between moments
      alert(`Moving ${globalSelection.size} photos to ${targetMoment.label}`);
      setShowMoveModal(false);
      clearGlobalSelection();
    } catch (error) {
      alert('Failed to move photos');
    }
  };





  const openImageViewer = (images, image, index) => {
    setImageViewer({
      show: true,
      image: image.id, // Pass the image ID instead of the image object
      index: index,
      images: images
    });
  };

  const closeImageViewer = () => {
    setImageViewer({ show: false, image: null, index: 0, images: [] });
  };

  const navigateImage = (direction, index) => {
    const currentIndex = imageViewer.index;
    let newIndex;
    if (direction === 'jump' && typeof index === 'number') {
      newIndex = index;
    } else if (direction === 'next') {
      newIndex = Math.min(currentIndex + 1, imageViewer.images.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    setImageViewer({
      show: true,
      image: imageViewer.images[newIndex].id, // Use image.id instead of image.name
      index: newIndex,
      images: imageViewer.images
    });
  };

  const handleJumpToMoment = (momentInfo) => {
    // Find the moment in our moments list and scroll to it
    const moment = moments.find(m => m.momentID === momentInfo.id);
    if (moment) {
      // Use timeline manager for navigation
      timelineManager.navigateToMoment(moment.momentID, moment.label);
    }
  };

  if (storeLoading) return <div className="p-8 text-center">Loading moments...</div>;
  if (storeError) return <div className="p-8 text-center text-red-500">{storeError}</div>;
  if (urlError) return <div className="p-8 text-center text-red-500">Error loading event: {urlError}</div>;
  if (urlLoading) return <div className="p-8 text-center">Loading event...</div>;

  // Calculate if all current images are selected for the select all button
  const allCurrentImages = getAllCurrentImageKeys();
  const allCurrentSelected = allCurrentImages.size > 0 && 
    Array.from(allCurrentImages).every(key => globalSelection.has(key));

  return (
    <div className="w-full bg-gray-50 min-h-screen">
      {/* Toast Notifications */}
      <AnimatePresence>
        {toast.show && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999] px-6 py-3 rounded-lg shadow-lg text-white font-medium ${
              toast.type === 'success' 
                ? 'bg-green-500' 
                : toast.type === 'error' 
                ? 'bg-red-500' 
                : 'bg-blue-500'
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-30 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h1 className="text-3xl font-bold text-gray-900">Timeline</h1>
            <div className="flex items-center space-x-4">
              <p className="text-gray-600">
                {allCurrentImages.size} photos
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowEditMomentsModal(true)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Edit moments"
            >
              <Pencil className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center divide-x divide-gray-200">
            {/* Group 1: View and Size Controls */}
            <div className="flex items-center space-x-3 px-4">
              {imagesLoading && (
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-4 h-4 border-b-2 border-primary-600"></div>
                  <span>Loading photos...</span>
                </div>
              )}
              
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              >
                {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
              </button>

              {viewMode === 'grid' && (
                <>
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(imageSize * 100);
                      const subtractValue = currentPercent > 100 ? 25 : 10;
                      const newPercent = Math.max(50, currentPercent - subtractValue);
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
                      if (e.key === 'Enter') e.target.blur();
                                              else if (e.key === 'Escape') setImageSizeInputValue(undefined);
                    }}
                    className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                    style={{width: '3rem'}}
                  />
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(imageSize * 100);
                      const addValue = currentPercent >= 100 ? 25 : 10;
                      const newPercent = Math.min(300, currentPercent + addValue);
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
            </div>

            {/* Group 2: Selection Controls */}
            <div className="flex items-center space-x-3 px-4">
              {imagesLoading ? (
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                  <span>Loading...</span>
                </div>
              ) : (
                <>
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
                  
                </>
              )}
            </div>

          </div>

          <div className="flex items-center">
            {/* Carousel Toggle Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCarouselVisible(!carouselVisible)}
              className="flex items-center justify-center w-8 h-8 bg-white rounded-full shadow-md border border-gray-200 hover:shadow-lg transition-all duration-200 hover:bg-gray-50"
              title={carouselVisible ? "Hide carousel" : "Show carousel"}
            >
              {carouselVisible ? (
                <span className="text-gray-600 font-bold text-lg leading-none">↑</span>
              ) : (
                <span className="text-gray-600 font-bold text-lg leading-none">↓</span>
              )}
            </motion.button>
          </div>
        </div>

        {/* Carousel - Now part of the header */}
        <AnimatePresence>
          {carouselVisible && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden pt-4"
            >
              <div className="carousel-container flex space-x-4 overflow-x-auto pb-2">
                {moments.length === 0 && (
                  <div className="bg-gray-100 rounded-lg h-32 min-w-[200px] flex items-center justify-center text-gray-400">
                    No moments yet
                  </div>
                )}
                {imagesLoading && moments.length > 0 && (
                  <div className="bg-gray-100 rounded-lg h-32 min-w-[200px] flex items-center justify-center text-gray-400">
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                      <span>Loading...</span>
                    </div>
                  </div>
                )}
                {moments.map(moment => (
                  <motion.div 
                    key={moment.momentID} 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="relative bg-white rounded-lg shadow flex-shrink-0 w-56 h-32 flex flex-col items-center justify-center p-3 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      // Use timeline manager for navigation with moment name
                      timelineManager.navigateToMoment(moment.label, moment.label);
                    }}
                  >
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded overflow-hidden flex items-center justify-center mb-2">
                      {moment.representative_image && moment.representative_image.trim() !== '' ? (
                        <img 
                          src={moment.representative_image.startsWith('/api/') 
                            ? `${API_BASE}${moment.representative_image}` 
                            : moment.representative_image.startsWith('http') 
                              ? moment.representative_image 
                              : urlHelpers && urlHelpers.getThumbnailUrl(moment.representative_image)
                          } 
                          alt="" 
                          className="object-cover w-full h-full" 
                          loading="lazy" 
                        />
                      ) : imagesLoading ? (
                        <div className="animate-pulse bg-gray-300 w-full h-full rounded"></div>
                      ) : (
                        <Image className="w-8 h-8 text-white" />
                      )}
                    </div>
                    <div className="text-center">
                      <div className="text-base font-semibold truncate max-w-[7rem]">{moment.label}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[7rem]">
                        {formatTimeOnly(moment.start)} - {formatTimeOnly(moment.end)}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Timeline */}
      <div className="px-4 py-8">
        {moments.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <Calendar className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No moments yet</h3>
            <p className="text-gray-500">Create your first moment to start building your timeline.</p>
          </div>
        ) : imagesLoading && Object.keys(momentImagesMap).length === 0 ? (
          <div className="text-center py-12">
            <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600"></div>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Loading timeline...</h3>
            <p className="text-gray-500">Loading photos...</p>
          </div>
        ) : (
          <div className="relative">
                         {/* Fixed right sidebar for sticky info */}
             <div className="fixed right-4 top-100 w-64 z-30 bg-white/70 backdrop-blur-sm p-4 rounded-lg shadow-lg border border-gray-200">
              {currentVisibleMoment ? (
                <>
                  <div className="text-base font-bold text-gray-900 mb-1 leading-tight">{currentVisibleMoment.label}</div>
                  <div className="text-xs text-gray-700 mb-1 font-medium">
                    {formatTimeOnly(currentVisibleMoment.start)} - {formatTimeOnly(currentVisibleMoment.end)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(currentVisibleMoment.start)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-base font-bold text-gray-900 mb-1 leading-tight">Timeline</div>
                  <div className="text-xs text-gray-500">Scroll to see moments</div>
                </>
              )}
            </div>
            
            {/* Timeline line */}
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500">
                             {/* Colorful dots for each moment */}
               {moments.map((moment, index) => (
                 <div
                   key={moment.momentID}
                   className="absolute w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full border-4 border-white shadow-lg z-10"
                  style={{
                    left: '-6px'
                  }}
                  ref={(el) => {
                    if (el && momentsRef.current[moment.label]) {
                      // Position the dot at the beginning of the moment card (top of info box)
                      const momentRect = momentsRef.current[moment.label].getBoundingClientRect();
                      const containerRect = el.parentElement.getBoundingClientRect();
                      el.style.top = `${momentRect.top - containerRect.top + 24}px`; // 24px = p-6 (24px) to align with top of info box
                    }
                  }}
                ></div>
              ))}
            </div>
            
            {/* Timeline items */}
            <div className="space-y-12 pr-4">
              {imagesLoading && (
                <div className="text-center py-8">
                  <div className="inline-flex items-center space-x-2 text-gray-500">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                    <span>Loading photos...</span>
                  </div>
                </div>
              )}
              {moments.map((moment, index) => (
                <MomentCard
                  key={moment.momentID}
                  moment={moment}
                  images={momentImagesMap[moment.momentID] || []}
                  viewMode={viewMode}
                  imageSize={imageSize}
                  globalSelection={globalSelection}
                  onImageSelect={handleImageSelect}
                  onOpenImageViewer={openImageViewer}
                  selectionMode={selectionMode}
                  onSelectAllInMoment={selectAllInMoment}
                  onClearMomentSelection={clearMomentSelection}
                  onToggleFavorites={handleSingleToggleFavorites}
                  onToggleArchive={handleSingleToggleArchive}
                  showToast={showToast}
                  eventUrl={eventUrl}
                  includeArchived={includeArchived}
                  ref={setMomentRef(moment.label)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showEditMomentsModal && (
        <EditMomentsModal
          eventUrl={eventUrl}
          moments={moments}
          images={images}
          momentImagesMap={momentImagesMap}
          onSave={handleSaveMoments}
          onDelete={handleDeleteMoment}
          onRefreshImages={fetchAllMomentImages}
          onToast={showToast}
          onClose={() => setShowEditMomentsModal(false)}
        />
      )}



      {/* Move Modal */}
      {showMoveModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-lg shadow-lg w-full max-w-md p-6"
          >
            <h4 className="font-semibold mb-4">Move Photos to Moment</h4>
            <select
              value={targetMoment?.momentID || ''}
              onChange={(e) => setTargetMoment(moments.find(m => m.momentID === e.target.value))}
              className="w-full border rounded px-3 py-2 mb-4"
            >
              <option value="">Select a moment for photos...</option>
              {moments.map(m => (
                <option key={m.momentID} value={m.momentID}>{m.label}</option>
              ))}
            </select>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setShowMoveModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleMoveToMoment} className="btn-primary">Move</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* image Viewer */}
      {imageViewer.show && (
        <ImageViewer
          image={imageViewer.image}
          eventUrl={eventUrl}
          onClose={closeImageViewer}
          onNavigate={navigateImage}
          totalImages={imageViewer.images.length}
          currentIndex={imageViewer.index}
          currentGroupId={null}
          onJumpToMoment={handleJumpToMoment}
          showToast={showToast}
        />
      )}

      {/* Floating Selection Controls */}
      <FloatingSelectionControls
        selectedCount={globalSelection.size}
        totalCount={allCurrentImages.size}
        selectedImages={new Set(getSelectedImageIds())}
        onSelectAll={selectAllImages}
        onClearSelection={clearGlobalSelection}
        onAddToBucket={handleGlobalAddToBucket}
        onToggleFavorites={handleToggleFavorites}
        onMoveToArchive={handleMoveToArchive}
        onRemoveFromMoment={handleRemoveFromMoment}
        onMoveToMoment={() => setShowMoveModal(true)}
        eventUrl={eventUrl}
        showToast={showToast}
        urlHelpers={urlHelpers}
        placeholderDataUrl="data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>"
        showTransferFaces={false}
        showRemoveFromMoment={true}
        showMoveToMoment={true}
        showArchive={true}
        showFavorites={true}
        showBucket={true}
        showAlbum={true}
        selectionMode={selectionMode}
      />
    </div>
  );
} 