import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Image, Minus, Plus, Settings, Clock, Calendar, CheckCheck, X, ShoppingBag, Trash2, Move, Pencil, Square, CheckSquare } from 'lucide-react';
import ImageViewer from './ImageViewer';
import useImageViewerController from '../utils/useImageViewerController.js';
import EditMomentsModal from './EditMomentsModal';
import EditMomentImagesModal from './EditMomentImagesModal';
import FloatingSelectionControls from './FloatingSelectionControls';
import Toast from './Toast';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import useImageSelection from '../utils/useImageSelection';
import { usePreference } from '../utils/useSettings';
import { setPreference } from '../utils/settings';
import { useDataStore, selectors as storeSelectors } from '../utils/dataManager';
import { shallow } from 'zustand/shallow';
import { momentsAPI, imagesAPI, API_BASE } from '../utils/apiService';
import useImageActions from './ImageActions';
import { useEventUrls } from '../utils/useEventUrls';
import MomentCard from './MomentCard';
import timelineManager from '../utils/timeline';
import useBucketStore from '../utils/bucketStore';
import { useToast } from '../utils/ToastContext';
import { sortMoments } from '../utils/sorting';
import { getImageCount } from '../utils/settings';


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
  const allMoments = useDataStore(state => storeSelectors.momentsAll(state), shallow);
  const includeArchived = usePreference('general.includeArchived', false);
  const moments = useMemo(() => {
    let filteredMoments = allMoments.filter(moment => {
      const imageCount = getImageCount(moment);
      return imageCount > 0;
    });
    
    // Filter out archived moments if includeArchived is false
    if (!includeArchived) {
      filteredMoments = filteredMoments.filter(moment => !moment.is_archived);
    }
    
    return sortMoments(filteredMoments, 'asc');
  }, [allMoments, includeArchived]);
  const updateMoment = useDataStore(state => state.updateMoment);
  const deleteMoment = useDataStore(state => state.deleteMoment);
  const addMoment = useDataStore(state => state.addMoment);
  const storeLoading = useDataStore(state => state.loading);
  const storeError = useDataStore(state => state.error);
  const setStoreLoading = useDataStore(state => state.setLoading);
  const setStoreError = useDataStore(state => state.setError);
  
  const [images, setImages] = useState([]);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [momentImagesMap, setMomentImagesMap] = useState({});
  const [imagesLoading, setImagesLoading] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetMoment, setTargetMoment] = useState(null);
  const carouselVisible = usePreference('Moments.carouselExpanded', true);
  const setCarouselVisible = (value) => setPreference('Moments.carouselExpanded', value);
  const [currentVisibleMoment, setCurrentVisibleMoment] = useState(null);
  const { toast, showToast } = useToast();
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast: showToast,
    onTransferComplete: null,
    onJumpToMoment: (momentInfo) => handleJumpToMoment(momentInfo),
    defaultSortBy: 'date',
    defaultSortOrder: 'asc',
  });
  const { addImages, open } = useBucketStore();
  
  // New state for checkbox visibility and selection mode
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);

  const flatSelectionItems = useMemo(() => {
    const items = [];
    Object.entries(momentImagesMap).forEach(([momentId, imgs]) => {
      (imgs || []).forEach(img => {
        const key = `${momentId}:${img && img.id}`;
        items.push({ key, group: momentId });
      });
    });
    return items;
  }, [momentImagesMap]);

  const {
    selectedKeys,
    toggleKey,
    clear: clearGlobalSelection,
    selectAll,
    selectMany,
    deselectMany,
    allKeys
  } = useImageSelection({
    items: flatSelectionItems,
    getKey: (it) => it.key,
    storageKey: 'moments_selection',
    persist: true,
    enableRange: true,
    groupKey: (it) => it.group,
  });

  // Selection persistence handled by useImageSelection


  const momentsRef = useRef({});
  const [showEditMomentsModal, setShowEditMomentsModal] = useState(false);
  const navigateRef = useRef(navigate);
  const lastFetchSignatureRef = useRef('');


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
  }, [eventUrl]);

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
    // Clear signature when component mounts or event changes
    lastFetchSignatureRef.current = '';
    fetchMoments();
    fetchImages();
  }, [eventUrl]);



  // Handle navigation from Face Detail to scroll to specific moment
  useEffect(() => {
    if (location.state?.scrollToMoment && moments.length > 0) {
      const momentId = location.state.scrollToMoment;
      window.history.replaceState({}, document.title);
      const moment = moments.find(m => m.id === momentId);
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
          setCurrentVisibleMoment(moment);
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

  const fetchAllMomentImages = useCallback(async (specificMomentId = null, updatedImages = null, forceRefetch = false) => {
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
      
      const validMoments = moments.filter(moment => moment.id && !String(moment.id).startsWith('temp-'));
      
      // Check which moments need images fetched (or all if forceRefetch is true)
      const momentsToFetch = forceRefetch ? validMoments : validMoments.filter(moment => !momentImagesMap[moment.id]);
      
      if (momentsToFetch.length === 0) {
        // All images are already loaded
        setImagesLoading(false);
        return;
      }
      
      // Use parallel API calls for moments that need images fetched
      const imagePromises = momentsToFetch.map(async (moment) => {
        try {
          const result = await momentsAPI.getById(moment.id, eventUrl);
          // After interceptor applies changes, read images from store
          const entities = useDataStore.getState().entities;
          const idsSet = entities?.moments?.[moment.id]?.images || new Set();
          let imgs = Array.from(idsSet).map(id => entities?.images?.[id]).filter(Boolean);
          
          // Filter out archived images if includeArchived is false
          if (!includeArchived) {
            imgs = imgs.filter(img => !img.is_archived);
          }
          
          return { momentId: moment.id, images: imgs };
        } catch (error) {
          console.error(`Error fetching images for moment ${moment.id}:`, error);
          return { momentId: moment.id, images: [] };
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
  }, [includeArchived, eventUrl]);

  useEffect(() => {
    if (moments.length > 0) {
      // Create signature from moments and includeArchived to detect changes
      const momentIds = moments.map(m => m.id).sort().join(',');
      const sig = `${momentIds}|${includeArchived ? '1' : '0'}`;
      
      // Only fetch if signature has changed
      if (sig === lastFetchSignatureRef.current) return;
      
      lastFetchSignatureRef.current = sig;
      fetchAllMomentImages();
    }
  }, [moments, includeArchived, fetchAllMomentImages]);

  // Separate effect for includeArchived changes to force immediate refetch
  const prevIncludeArchivedRef = useRef(includeArchived);
  useEffect(() => {
    if (prevIncludeArchivedRef.current !== includeArchived && moments.length > 0) {
      // Force refetch when includeArchived changes
      fetchAllMomentImages(null, null, true);
      prevIncludeArchivedRef.current = includeArchived;
    }
  }, [includeArchived, moments.length, fetchAllMomentImages]);

  const fetchMoments = async () => {
    try {
      setStoreLoading(true);
      const response = await momentsAPI.getAll(eventUrl);
      // Changes are automatically applied by apiService interceptor
      setStoreError(null);
    } catch (err) {
      setStoreError('Failed to load moments.');
    } finally {
      setStoreLoading(false);
    }
  };

  const fetchImages = async () => {
    try {
      const response = await imagesAPI.getImages([], eventUrl);
      
      // Changes are automatically applied by apiService interceptor
      
      const imgs = response.images || [];
      setImages(imgs);
    } catch (err) {
      console.error('Error fetching images:', err);
    }
  };

  const handleSaveMoments = async (updatedMoment) => {
    try {
      const response = await momentsAPI.update(updatedMoment.id, updatedMoment, eventUrl);
      // Changes are automatically applied by apiService interceptor
      updateMoment(updatedMoment.id, response.moment || updatedMoment);
      updateMomentImagesMap(updatedMoment.id);
      
      // Return the response so the caller knows the operation succeeded
      return response;

      // setShowEditModal(false); // This state is now managed by modalManager
    } catch (error) {
      console.error('Error updating moment:', error);
      showToast('Failed to update moment', 'error');
    }
  };

  // Function to update the momentImagesMap for a specific moment
  const updateMomentImagesMap = useCallback(async (momentId) => {
    try {
      await momentsAPI.getById(momentId, eventUrl);
      const entities = useDataStore.getState().entities;
      const idsSet = entities?.moments?.[momentId]?.images || new Set();
      let imgs = Array.from(idsSet).map(id => entities?.images?.[id]).filter(Boolean);
      
      // Filter out archived images if includeArchived is false
      if (!includeArchived) {
        imgs = imgs.filter(img => !img.is_archived);
      }

      setMomentImagesMap(prev => ({
        ...prev,
        [momentId]: imgs
      }));
      
    } catch (error) {
      console.error('Error updating moment images map:', error);
    }
  }, [includeArchived, eventUrl]);

  const handleDeleteMoment = async (id) => {
    try {
      const response = await momentsAPI.delete(id, eventUrl);
      // Changes are automatically applied by apiService interceptor
      deleteMoment(id);
    } catch (error) {
      console.error('Error deleting moment:', error);
    }
  };

  const handleImageSelect = (imageName, momentId, event) => {
    const key = `${momentId}:${imageName}`;
    toggleKey(key, event);
  };

  // Helper function to get all current image keys
  const getAllCurrentImageKeys = () => {
    return new Set(allKeys);
  };



  const selectAllImages = () => {
    if (allKeys.length === 0) return;
    const allCurrentImages = getAllCurrentImageKeys();
    if (allCurrentSelected) {
      clearGlobalSelection();
    } else {
      selectMany(Array.from(allCurrentImages));
    }
  };

  // Separate function for Ctrl+A behavior
  const handleCtrlA = () => {
    // First, try to select from current moment if one is focused
    const currentMoment = currentVisibleMoment;
    
    if (currentMoment) {
      const currentMomentImages = momentImagesMap[currentMoment.id] || [];
      const currentMomentImageKeys = currentMomentImages.map(image => `${currentMoment.id}:${image && image.id}`);
      
            // Check if all images in current moment are already selected
        const allCurrentMomentSelected = currentMomentImageKeys.length > 0 && 
          currentMomentImageKeys.every(key => selectedKeys.has(key));
        
        if (allCurrentMomentSelected) {
          // Current moment is fully selected, now select all from all moments
          const allCurrentImages = getAllCurrentImageKeys();
          selectMany(Array.from(allCurrentImages));
        } else {
          // Select all images from current moment
          selectMany(currentMomentImageKeys);
        }
    } else {
      // No current moment focused, use the same logic as button
      selectAllImages();
    }
  };


  const selectAllInMoment = (momentId) => {
    const momentImages = momentImagesMap[momentId] || [];
    const momentImageKeys = momentImages.map(image => `${momentId}:${image && image.id}`);
    
    // Check if all images in this moment are already selected
    const allSelected = momentImageKeys.every(key => selectedKeys.has(key));
    
    if (allSelected) {
      // Clear selection for this moment
      deselectMany(momentImageKeys);
    } else {
      // Select all images in this moment
      selectMany(momentImageKeys);
    }
  };

  const clearMomentSelection = (momentId) => {
    const momentImages = momentImagesMap[momentId] || [];
    const momentImageKeys = momentImages.map(image => `${momentId}:${image && image.id}`);
    
    deselectMany(momentImageKeys);
    
    // Note: Cache will be automatically updated by the useEffect that watches globalSelection
  };

  // clearGlobalSelection provided by useImageSelection



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
  }, [momentImagesMap, selectedKeys]);

  // Helper function to convert selectedKeys to actual image ids
  const getSelectedImageIds = () => {
    return Array.from(selectedKeys).map(key => {
      const [, imageId] = key.split(':');
      return imageId || null;
    }).filter(Boolean);
  };


  // Create ImageActions instance for selected images
  const selectedImageActions = useImageActions({
    imageIds: getSelectedImageIds(),
    eventUrl,
    urlHelpers,
    placeholderDataUrl: "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>",
    onImageUpdated: () => {}, // No need to update local state, store handles it
    onAlbumAdded: () => {} // No special handling needed
  });

  const handleSingleToggleArchive = (isArchived) => {
    selectedImageActions.toggleArchive(isArchived);
  };

  const handleRemoveFromMoment = async () => {
    // This would require backend support to remove images from moments
          alert('Remove photos from moment functionality would be implemented here');
  };

  const handleMoveToMoment = async () => {
    if (!targetMoment || selectedKeys.size === 0) return;
    
    try {
      // This would require backend support to move images between moments
      alert(`Moving ${selectedKeys.size} photos to ${targetMoment.label}`);
      setShowMoveModal(false);
      clearGlobalSelection();
    } catch (error) {
      alert('Failed to move photos');
    }
  };




  const openImageViewer = (images, image, index) => {
    const momentId = Object.keys(momentImagesMap).find(mId => 
      momentImagesMap[mId]?.some(img => img.id === image?.id)
    );
    openViewer({ index, parent: momentId, entity: 'moment', sortBy: 'date', sortOrder: 'asc' });
  };

  const closeImageViewer = () => {};
  const navigateImage = (direction, index) => navigateViewer(direction, index);

  const handleJumpToMoment = (momentInfo) => {
    // Find the moment in our moments list and scroll to it
            const moment = moments.find(m => m.id === momentInfo.id);
    if (moment) {
      // Use timeline manager for navigation
            timelineManager.navigateToMoment(moment.id, moment.label);
    }
  };

  if (storeLoading) return <div className="p-8 text-center">Loading moments...</div>;
  if (storeError) return <div className="p-8 text-center text-red-500">{storeError}</div>;
  if (urlError) return <div className="p-8 text-center text-red-500">Error loading event: {urlError}</div>;
  if (urlLoading) return <div className="p-8 text-center">Loading event...</div>;

  // Calculate if all current images are selected for the select all button
  const allCurrentImages = getAllCurrentImageKeys();
  const allCurrentSelected = allCurrentImages.size > 0 && 
    Array.from(allCurrentImages).every(key => selectedKeys.has(key));

  return (
    <div className="w-full bg-gray-50 min-h-screen">
      {/* Toast Notifications */}
      <Toast toast={toast} />

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
              <Pencil className="w-5 h-5 text_gray-600" />
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
                    key={moment.id} 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="relative bg_white rounded-lg shadow flex-shrink-0 w-56 h-32 flex flex-col items-center justify-center p-3 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      // Use timeline manager for navigation with moment name
                      timelineManager.navigateToMoment(moment.label, moment.label);
                    }}
                  >
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded overflow-hidden flex items-center justify-center mb-2">
                      <img 
                        src={urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl('moments', moment.id) : ''} 
                        alt="" 
                        className="object-cover w-full h-full" 
                        loading="lazy" 
                      />
                      <Image className="w-8 h-8 text-white" style={{ display: 'none' }} />
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
            <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full flex items_center justify-center mb-4">
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
                  key={moment.id}
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
                  key={moment.id}
                  moment={moment}
                  images={momentImagesMap[moment.id] || []}
                  imageSize={imageSize}
                  globalSelection={selectedKeys}
                  onImageSelect={handleImageSelect}
                  onOpenImageViewer={openImageViewer}
                  selectionMode={selectionMode}
                  onSelectAllInMoment={selectAllInMoment}
                  onClearMomentSelection={clearMomentSelection}
                  eventUrl={eventUrl}
                  urlHelpers={urlHelpers}
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
              value={targetMoment?.id || ''}
              onChange={(e) => setTargetMoment(moments.find(m => String(m.id) === e.target.value))}
              className="w-full border rounded px-3 py-2 mb-4"
            >
              <option value="">Select a moment for photos...</option>
              {moments.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setShowMoveModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleMoveToMoment} className="btn-primary">Move</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {viewerOpen && (
        <ImageViewer {...viewerProps} />
      )}

      {/* Floating Selection Controls */}
      <FloatingSelectionControls
        selectedCount={selectedKeys.size}
        totalCount={allCurrentImages.size}
        selectedImages={new Set(getSelectedImageIds())}
        onSelectAll={selectAllImages}
        onClearSelection={clearGlobalSelection}
        onRemoveFromMoment={handleRemoveFromMoment}
        onMoveToMoment={() => setShowMoveModal(true)}
        eventUrl={eventUrl}
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
