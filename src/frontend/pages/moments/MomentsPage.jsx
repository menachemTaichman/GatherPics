import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Minus, Plus, Clock, Calendar, CheckCheck, X, Pencil, Square, CheckSquare, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageViewer } from '../../components/images';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { EditMomentsModal, MoveToMomentModal } from '../../components/moments';
import { FloatingSelectionControls } from '../../components/layout';
import { Toast, PermissionGate } from '../../components/common';
import { useLocation, useNavigate } from 'react-router-dom';
import useImageSelection from '../../hooks/useImageSelection';
import { usePreference } from '../../hooks/useSettings';
import { setPreference } from '../../utils/settings';
import { useDataStore, selectors as storeSelectors } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { shallow } from 'zustand/shallow';
import { momentsAPI, imagesAPI } from '../../utils/apiService';
import useImageActions from '../../components/images/ImageActions';
import useBucketStore from '../../utils/bucketStore';
import { useToast } from '../../contexts/ToastContext';
import { formatErrorMessage } from '../../utils/errorHandler';
import { sortMoments, sortImages, toggleSortOrder } from '../../utils/sorting';
import { getImageCount } from '../../utils/settings';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { useImageViewerGridSync } from '../../hooks/useImageViewerGridSync';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { formatTimeOnly, formatDate } from '../../utils/dateUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import usePinchToZoom from '../../hooks/usePinchToZoom';
import AbsoluteMasonryGrid from '../../components/images/AbsoluteMasonryGrid';
import { SingleImageTile } from '../../components/images';
import i18n from '../../i18n';
import { APP_CONFIG } from '../../config/appConfig';

const EMPTY_ARRAY = Object.freeze([]);

export default function Moments({ eventUrl, urlHelpers: injectedUrlHelpers }) {
  const location = useLocation();
  const navigate = useNavigate();
  const urlHelpers = injectedUrlHelpers;
  const eventId = useEventId(eventUrl);
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  
  // Apply scope for all moments and images - memoized to ensure proper cleanup
  const momentsScopes = useMemo(() => {
    if (!eventId) return [];
    return [{ entity: 'all', id: 'moments', eventId }];
  }, [eventId]);
  useApplyScopes(momentsScopes);
  
  const storeMoments = useDataStore(state => storeSelectors.momentsAll(state, eventId), shallow);
  
  // Get all images from store (they should have moment_id field)
  const storeImages = useDataStore(state => storeSelectors.imagesAll(state, eventId), shallow);
  
  // Subscribe to entities changes to make the component reactive
  const entities = useDataStore(state => state.entities, shallow);
  
  // Track moment_id changes in images to ensure grid updates when images move between moments
  // This creates a signature that changes when any image's moment_id changes
  const momentIdSignature = useMemo(() => {
    if (!isAuthenticated || !entities?.[eventId]?.images) return '';
    const images = entities[eventId].images;
    return Object.values(images)
      .filter(img => img && img.moment_id)
      .map(img => `${img.id}:${img.moment_id}`)
      .sort()
      .join('|');
  }, [entities, eventId, isAuthenticated]);
  
  // Create placeholder moments when not authenticated
  const placeholderMoments = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      id: `placeholder-${i}`,
      label: '',
      images: new Set(),
      isPlaceholder: true
    }));
  }, []);
  
  const allMoments = isAuthenticated ? storeMoments : placeholderMoments;
  const includeArchived = usePreference('general.includeArchived', false);
  const momentSortOrder = usePreference('Moments.sortDir', 'desc'); // Default: newest first
  const setMomentSortOrder = (value) => setPreference('Moments.sortDir', value);
  const moments = useMemo(() => {
    // Return placeholders as-is without filtering
    if (!isAuthenticated) return allMoments;
    
    let filteredMoments = allMoments.filter(moment => {
      const imageCount = getImageCount(moment);
      return imageCount > 0;
    });
    
    // Filter out archived moments if includeArchived is false
    if (!includeArchived) {
      filteredMoments = filteredMoments.filter(moment => !moment.is_archived);
    }
    
    return sortMoments(filteredMoments, momentSortOrder);
  }, [allMoments, includeArchived, isAuthenticated, momentSortOrder]);
  
  const storeLoading = useDataStore(state => state.loading);
  const storeError = useDataStore(state => state.error);
  const setStoreLoading = useDataStore(state => state.setLoading);
  const setStoreError = useDataStore(state => state.setError);
  
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  
  // Pinch-to-zoom for mobile
  const setPinchRef = usePinchToZoom(imageSize, setImageSize);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [carouselVisible, setCarouselVisible] = useState(false);
  const [currentVisibleMoment, setCurrentVisibleMoment] = useState(null);
  const carouselRef = useRef(null);
  const carouselContainerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  
  // Ref to track if URL update is programmatic (to prevent infinite loops)
  const isUpdatingUrlRef = useRef(false);
  
  // Ref to track initial URL restoration
  const __initialRestorationComplete = useRef(false);
  const __pendingMomentFromUrl = useRef(null);
  const __processedUrlRef = useRef(null); // Track which URL we've already processed
  
  // State for image aspect ratio classes
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);
  const pendingClassUpdatesRef = useRef({});
  const flushClassesRafRef = useRef(null);
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Refs for arrow key navigation
  const imageTileRefs = useRef([]);
  const gridContainerRef = useRef(null);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const { toast, showToast, hideToast } = useToast();
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast: showToast,
    onTransferComplete: null,
    onJumpToMoment: (momentInfo) => handleJumpToMoment(momentInfo),
    defaultSortBy: 'date',
    defaultSortOrder: 'asc',
    urlHelpers,
  });
  
  // Refs for grid scrolling
  const gridRef = useRef(null);
  
  // Map to store DOM element references for each image (for PhotoSwipe zoom-out animation)
  const itemsRefs = useRef(new Map());
  
  // Callback to register/unregister image DOM elements
  // For PhotoSwipe zoom-out animation, we need the actual img element, not the wrapper div
  const handleItemRef = useCallback((itemData, index, node) => {
    if (node && itemData && !itemData.isHeader) {
      // Try to find the img element within the node (SingleImageTile passes the wrapper div)
      const imgElement = node.querySelector('img');
      // Use the img element if found, otherwise fall back to the node itself
      itemsRefs.current.set(itemData.id, imgElement || node);
    } else if (itemData && !itemData.isHeader) {
      itemsRefs.current.delete(itemData.id);
    }
  }, []);
  
  const { addImages, open } = useBucketStore();
  
  // Selection mode and state
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);

  // Get all images sorted by moment and date
  // Images should have moment_id field from backend
  const sortedImages = useMemo(() => {
    if (!isAuthenticated || !storeImages.length) return EMPTY_ARRAY;
    
    // Filter images by archived status and ensure they have moment_id
    const filteredImages = storeImages.filter(image => {
      if (!image) return false;
      if (!includeArchived && image.is_archived) return false;
      // Only include images that belong to a moment
      return image.moment_id && moments.some(m => m.id === image.moment_id);
    });
    
    // Group by moment and sort within each moment
    const momentMap = new Map();
    moments.forEach(moment => {
      momentMap.set(moment.id, []);
    });
    
    filteredImages.forEach(image => {
      if (image.moment_id && momentMap.has(image.moment_id)) {
        momentMap.get(image.moment_id).push(image);
      }
    });
    
    // Sort images within each moment by date, then combine
    const sorted = [];
    moments.forEach(moment => {
      const momentImages = momentMap.get(moment.id) || [];
      const sortedMomentImages = sortImages(momentImages, 'date', momentSortOrder);
      sorted.push(...sortedMomentImages);
    });
    
    return sorted;
  }, [storeImages, moments, includeArchived, isAuthenticated, momentIdSignature, momentSortOrder]);
  
  // Image viewer grid sync hook - combines grid scrolling, focus after close, and image highlight
  // Must be called after sortedImages is defined
  const { onImageChange: handleImageChangeBase, highlightedIds, registerImageRef, setCurrentImageId } = useImageViewerGridSync({
    gridRef,
    sortedImages,
    imageTileRefs,
    viewerOpen
  });
  
  // Enhanced handleImageChange that also updates PhotoSwipe element reference
  const handleImageChange = useCallback((imageId, index) => {
    // Use the base handler for grid scrolling and tracking
    handleImageChangeBase(imageId, index);
    setCurrentImageId(imageId);
    
    // Update PhotoSwipe element reference for zoom-out animation
    // Use a small timeout to allow the grid to render the image after scrolling
    setTimeout(() => {
      const thumbnailEl = itemsRefs.current.get(imageId);
      if (thumbnailEl) {
        // This will be used by ImageViewer to update PhotoSwipe
        // We'll pass the refs map to ImageViewer
      }
    }, 50);
  }, [handleImageChangeBase, setCurrentImageId]);
  
  // Calculate moment indexes (first index of each moment in sortedImages)
  const momentIndexes = useMemo(() => {
    const indexes = new Map();
    let currentIndex = 0;
    
    moments.forEach(moment => {
      const momentImages = sortedImages.filter(img => img.moment_id === moment.id);
      if (momentImages.length > 0) {
        indexes.set(moment.id, currentIndex);
        currentIndex += momentImages.length;
      }
    });
    
    return indexes;
  }, [moments, sortedImages]);
  
  // Get all images for selection (with moment_id key)
  const allImages = useMemo(() => {
    return sortedImages.map(image => ({
      key: `${image.moment_id}:${image.id}`,
      group: image.moment_id,
      image: image
    }));
  }, [sortedImages]);
  
  // Create items array with headers inserted between moments
  const itemsWithHeaders = useMemo(() => {
    if (sortedImages.length === 0) return [];
    
    const items = [];
    let currentMomentId = null;
    
    sortedImages.forEach((image, index) => {
      // If this is the first image of a new moment, add a header
      if (image.moment_id !== currentMomentId) {
        const moment = moments.find(m => m.id === image.moment_id);
        if (moment) {
          // Use consistent height regardless of selection mode
          // Use larger height on mobile to account for text wrapping
          const headerHeight = isMobile ? 90 : 80;
          items.push({
            id: `header-${moment.id}`,
            isHeader: true,
            headerHeight: headerHeight,
            moment: moment,
            momentId: moment.id
          });
        }
        currentMomentId = image.moment_id;
      }
      items.push(image);
    });
    
    return items;
  }, [sortedImages, moments, isMobile]);
  
  // Update refs array when sortedImages changes
  useEffect(() => {
    imageTileRefs.current = imageTileRefs.current.slice(0, sortedImages.length);
  }, [sortedImages.length]);

  const {
    selectedKeys,
    toggleKey,
    clear: clearGlobalSelection,
    selectAll,
    selectMany,
    deselectMany,
    allKeys
  } = useImageSelection({
    items: allImages,
    getKey: (it) => it.key,
    storageKey: 'moments_selection',
    persist: true,
    enableRange: true,
    groupKey: (it) => it.group,
  });
  
  // Measure header height for carousel positioning
  useEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    return () => window.removeEventListener('resize', updateHeaderHeight);
  }, [carouselVisible]); // Re-measure when carousel visibility changes (header might expand)

  // Detect current visible moment based on scroll position
  useEffect(() => {
    const gridContainer = gridContainerRef.current;
    if (!gridContainer || sortedImages.length === 0) return;
    
    const handleScroll = () => {
      const containerRect = gridContainer.getBoundingClientRect();
      const scrollTop = gridContainer.scrollTop;
      const viewportCenter = scrollTop + containerRect.height / 2;
      
      // Find which moment's images are in the viewport center
      let currentMoment = null;
      for (const moment of moments) {
        const firstIndex = momentIndexes.get(moment.id);
        if (firstIndex === undefined) continue;
        
        const momentImageCount = sortedImages.filter(img => img.moment_id === moment.id).length;
        if (momentImageCount === 0) continue;
        
        // Estimate the position range for this moment's images
        // This is approximate since we don't have exact positions without rendering
        const imageElement = imageTileRefs.current[firstIndex];
        if (imageElement) {
          const imageRect = imageElement.getBoundingClientRect();
          const containerRect = gridContainer.getBoundingClientRect();
          const relativeTop = imageRect.top - containerRect.top + gridContainer.scrollTop;
          
          // If the first image of this moment is in the viewport, consider it current
          if (relativeTop <= viewportCenter && relativeTop >= scrollTop - 200) {
            currentMoment = moment;
            break;
          }
        }
      }
      
      // Fallback: find moment by checking which images are visible
      if (!currentMoment) {
        for (let i = 0; i < imageTileRefs.current.length; i++) {
          const element = imageTileRefs.current[i];
          if (!element) continue;
          
          const rect = element.getBoundingClientRect();
          const containerRect = gridContainer.getBoundingClientRect();
          
          if (rect.top >= containerRect.top && rect.top <= containerRect.bottom) {
            const image = sortedImages[i];
            if (image) {
              currentMoment = moments.find(m => m.id === image.moment_id);
              if (currentMoment) break;
            }
          }
        }
      }
      
      if (currentMoment && currentMoment.id !== currentVisibleMoment?.id) {
        setCurrentVisibleMoment(currentMoment);
      }
    };
    
    gridContainer.addEventListener('scroll', handleScroll, { passive: true });
    // Initial check
    handleScroll();
    
    return () => {
      gridContainer.removeEventListener('scroll', handleScroll);
    };
  }, [sortedImages, moments, momentIndexes, currentVisibleMoment]);

  // Update URL when current visible moment changes
  useEffect(() => {
    if (!currentVisibleMoment || !eventUrl) return;
    
    const searchParams = new URLSearchParams(location.search);
    const currentMomentParam = searchParams.get('moment');
    
    // Use label instead of ID for URL
    const momentLabel = currentVisibleMoment.label || '';
    
    // Only update URL if the moment has changed
    // URLSearchParams.get() already decodes both + and %20 to spaces, so we can compare directly
    const decodedCurrentParam = currentMomentParam || null;
    if (decodedCurrentParam !== momentLabel) {
      // Build query string manually to ensure spaces are encoded as %20, not +
      const pairs = [];
      
      // Keep existing params except 'moment'
      searchParams.forEach((value, key) => {
        if (key !== 'moment') {
          pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      });
      
      // Add moment param with %20 encoding
      if (momentLabel) {
        pairs.unshift(`moment=${encodeURIComponent(momentLabel)}`);
      }
      
      const newSearch = pairs.length ? `?${pairs.join('&')}` : '';
      const newPath = `${location.pathname}${newSearch}`;
      
      // Mark that we're updating the URL programmatically
      isUpdatingUrlRef.current = true;
      
      // Use replace to avoid cluttering browser history
      navigate(newPath, { replace: true });
      
      // Reset the flag after a short delay to allow location to update
      setTimeout(() => {
        isUpdatingUrlRef.current = false;
      }, 100);
    }
  }, [currentVisibleMoment, eventUrl, location.pathname, location.search, navigate]);

  const [showEditMomentsModal, setShowEditMomentsModal] = useState(false);

  // Define fetchMoments and fetchImages before using it in useAuthRefresh
  const fetchMoments = useCallback(async () => {
    if (!eventUrl) return;
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
  }, [eventUrl]);
  
  const fetchImages = useCallback(async () => {
    if (!eventUrl) return;
    try {
      // Fetch all images (they include moment_id field)
      await imagesAPI.getImages(null, eventUrl);
      // Changes are automatically applied by apiService interceptor
    } catch (err) {
      console.error('Failed to load images:', err);
    }
  }, [eventUrl]);
  
  // Fetch images when moments are loaded
  useEffect(() => {
    if (isAuthenticated && moments.length > 0 && storeImages.length === 0) {
      fetchImages();
    }
  }, [isAuthenticated, moments.length, storeImages.length, fetchImages]);
  
  // Handle image load to determine aspect ratio
  const handleImageLoad = useCallback((imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    const current = imageClassesRef.current?.[imageId];
    if (current === imageClass) return;

    pendingClassUpdatesRef.current[imageId] = imageClass;
    if (!flushClassesRafRef.current) {
      try {
        flushClassesRafRef.current = requestAnimationFrame(() => {
          const updates = pendingClassUpdatesRef.current;
          pendingClassUpdatesRef.current = {};
          flushClassesRafRef.current = null;
          setImageClasses(prev => {
            let changed = false;
            const next = { ...prev };
            for (const id in updates) {
              if (Object.prototype.hasOwnProperty.call(updates, id)) {
                if (prev[id] !== updates[id]) {
                  next[id] = updates[id];
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        });
      } catch {
        setImageClasses(prev => {
          let changed = false;
          const next = { ...prev };
          for (const id in pendingClassUpdatesRef.current) {
            if (prev[id] !== pendingClassUpdatesRef.current[id]) {
              next[id] = pendingClassUpdatesRef.current[id];
              changed = true;
            }
          }
          pendingClassUpdatesRef.current = {};
          return changed ? next : prev;
        });
      }
    }
  }, []);

  // Fetch moments data with auto-refresh on auth changes
  useAuthRefresh(fetchMoments, [eventUrl]);

  // Set document title
  useEffect(() => {
    document.title = `${t('moments.timeline')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Note: Timeline elements are automatically registered/unregistered through setMomentRef callback
  // No need to call refreshElements() as it clears all registered elements unnecessarily

  // Initialize moment from URL on first load or when URL changes
  useEffect(() => {
    const currentUrl = location.search;
    
    // If we've already processed this URL, skip
    if (__processedUrlRef.current === currentUrl) {
      return;
    }
    
    const searchParams = new URLSearchParams(location.search);
    const momentLabelFromUrl = searchParams.get('moment');
    
    // Mark this URL as processed
    __processedUrlRef.current = currentUrl;
    
    // Reset restoration state for new URL
    __initialRestorationComplete.current = false;
    
    if (momentLabelFromUrl) {
      // Store the moment label for later restoration when moments are loaded
      __pendingMomentFromUrl.current = momentLabelFromUrl;
    } else {
      // No moment in URL, mark restoration as complete immediately
      __pendingMomentFromUrl.current = null;
      __initialRestorationComplete.current = true;
    }
  }, [location.search]); // Run when URL changes

  // Handle navigation from Face Detail to scroll to specific moment
  useEffect(() => {
    if (moments.length === 0 || sortedImages.length === 0) return;
    
    // Skip if we're programmatically updating the URL (to prevent infinite loops)
    if (isUpdatingUrlRef.current) return;
    
    // Check for moment in location state (from Face Detail navigation)
    if (location.state?.scrollToMoment) {
      const momentId = location.state.scrollToMoment;
      window.history.replaceState({}, document.title);
      // Use gridRef directly to avoid dependency on handleJumpToMoment
      if (gridRef.current && gridRef.current.scrollToMoment) {
        const headerId = `header-${momentId}`;
        gridRef.current.scrollToMoment(headerId);
      }
      return;
    }
  }, [location.state, moments, sortedImages]);

  // Restore moment from URL after moments and grid are ready
  useEffect(() => {
    // Skip if restoration is already complete - this prevents infinite loops
    if (__initialRestorationComplete.current) {
      return;
    }
    
    // Don't wait for perfect conditions - attempt restoration with whatever we have
    if (!__pendingMomentFromUrl.current) {
      // Nothing to restore, mark complete
      __initialRestorationComplete.current = true;
      return;
    }
    
    // If moments aren't loaded yet, wait
    if (moments.length === 0 || sortedImages.length === 0) {
      return;
    }
    
    // If grid isn't ready yet, wait
    if (!gridRef.current || !gridRef.current.scrollToMoment) {
      return;
    }
    
    // Skip if we're programmatically updating the URL (to prevent infinite loops)
    if (isUpdatingUrlRef.current) {
      return;
    }
    
    const momentLabelFromUrl = __pendingMomentFromUrl.current;
    // URLSearchParams.get() already decodes + to spaces, but we need to handle %20 too
    // If the raw URL contains %20, it will be preserved, but if it contains +, it's already decoded
    // So we can use the value directly (URLSearchParams handles both)
    const decodedLabel = momentLabelFromUrl;
    
    // Find moment by label
    const momentFromUrl = moments.find(m => m.label === decodedLabel);
    
    if (momentFromUrl) {
      // Scroll to the moment with retry mechanism (only if not already complete)
      if (__initialRestorationComplete.current) {
        return;
      }
      
      const scrollToMomentWithRetry = (momentId, attempt = 0) => {
        // Stop if restoration was completed (e.g., by carousel click)
        if (__initialRestorationComplete.current) {
          return;
        }
        
        const MAX_ATTEMPTS = 10;
        
        const headerId = `header-${momentId}`;
        
        if (gridRef.current && gridRef.current.scrollToMoment) {
          // Wait a few attempts for layout to be calculated, then try scrolling
          // scrollToMoment uses layout data, not DOM elements, so we don't need to wait for DOM
          if (attempt < 5) {
            setTimeout(() => scrollToMomentWithRetry(momentId, attempt + 1), 400);
            return;
          }
          
          try {
            // Call scrollToMoment - it will return early if layout not ready, but that's OK
            // We'll mark complete anyway to stop retrying
            gridRef.current.scrollToMoment(headerId);
            
            // Mark as complete to stop retrying - even if scroll didn't work, we tried
            __pendingMomentFromUrl.current = null;
            __initialRestorationComplete.current = true;
          } catch (error) {
            __pendingMomentFromUrl.current = null;
            __initialRestorationComplete.current = true;
          }
          return;
        }
        
        if (attempt < MAX_ATTEMPTS) {
          setTimeout(() => scrollToMomentWithRetry(momentId, attempt + 1), 300);
        } else {
          // Give up after max attempts
          __pendingMomentFromUrl.current = null;
          __initialRestorationComplete.current = true;
        }
      };
      
      // Only scroll if we don't already have a current visible moment, or if it's different
      if (!currentVisibleMoment || currentVisibleMoment.id !== momentFromUrl.id) {
        scrollToMomentWithRetry(momentFromUrl.id);
      } else {
        // Already at the right moment, just mark as complete
        __pendingMomentFromUrl.current = null;
        __initialRestorationComplete.current = true;
      }
    } else {
      // Moment not found, mark restoration complete anyway
      __pendingMomentFromUrl.current = null;
      __initialRestorationComplete.current = true;
    }
  }, [moments, sortedImages, currentVisibleMoment]);

  const handleSaveMoments = async (updatedMoment) => {
    try {
      const response = await momentsAPI.update(updatedMoment.id, updatedMoment, eventUrl);
      // Changes are automatically applied by apiService interceptor
      
      // Return the response so the caller knows the operation succeeded
      return response;
    } catch (error) {
      console.error('Error updating moment:', error);
      showToast(formatErrorMessage('update moment', error), 'error');
    }
  };


  const handleDeleteMoment = async (id) => {
    try {
      const response = await momentsAPI.delete(id, eventUrl);
      // Changes are automatically applied by apiService interceptor
    } catch (error) {
      console.error('Error deleting moment:', error);
    }
  };

  const handleImageSelect = (imageId, event) => {
    const image = sortedImages.find(img => img.id === imageId);
    if (image) {
      const key = `${image.moment_id}:${imageId}`;
      toggleKey(key, event);
    }
  };
  
  const toggleImageSelection = (imageId, event) => {
    handleImageSelect(imageId, event);
  };

  const selectAllImages = () => {
    if (allKeys.length === 0) return;
    const allCurrentImages = new Set(allKeys);
    const allCurrentSelected = allCurrentImages.size > 0 && 
      Array.from(allCurrentImages).every(key => selectedKeys.has(key));
    
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
      const momentImages = entities?.[eventId]?.moments?.[currentMoment.id]?.images;
      if (!momentImages || !(momentImages instanceof Set)) return;
      
      const currentMomentImageKeys = Array.from(momentImages)
        .map(imageId => {
          const image = entities?.[eventId]?.images?.[imageId];
          return image && (includeArchived || !image.is_archived) ? `${currentMoment.id}:${imageId}` : null;
        })
        .filter(Boolean);
      
      // Check if all images in current moment are already selected
      const allCurrentMomentSelected = currentMomentImageKeys.length > 0 && 
        currentMomentImageKeys.every(key => selectedKeys.has(key));
      
      if (allCurrentMomentSelected) {
        // Current moment is fully selected, now select all from all moments
        selectMany(Array.from(allKeys));
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
    const momentImageKeys = sortedImages
      .filter(img => img.moment_id === momentId)
      .map(img => `${momentId}:${img.id}`);
    
    if (momentImageKeys.length === 0) return;
    
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
    const momentImageKeys = sortedImages
      .filter(img => img.moment_id === momentId)
      .map(img => `${momentId}:${img.id}`);
    
    deselectMany(momentImageKeys);
  };
  
  // Get selected images count for current moment
  const getCurrentMomentSelectedCount = useMemo(() => {
    if (!currentVisibleMoment) return 0;
    const momentImageKeys = sortedImages
      .filter(img => img.moment_id === currentVisibleMoment.id)
      .map(img => `${currentVisibleMoment.id}:${img.id}`);
    return momentImageKeys.filter(key => selectedKeys.has(key)).length;
  }, [currentVisibleMoment, sortedImages, selectedKeys]);
  
  // Check if all images in current moment are selected
  const allCurrentMomentSelected = useMemo(() => {
    if (!currentVisibleMoment) return false;
    const momentImageKeys = sortedImages
      .filter(img => img.moment_id === currentVisibleMoment.id)
      .map(img => `${currentVisibleMoment.id}:${img.id}`);
    return momentImageKeys.length > 0 && momentImageKeys.every(key => selectedKeys.has(key));
  }, [currentVisibleMoment, sortedImages, selectedKeys]);

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
  }, [moments, selectedKeys, currentVisibleMoment, includeArchived]);

  // Helper function to convert selectedKeys to actual image ids
  const getSelectedImageIds = () => {
    return Array.from(selectedKeys).map(key => {
      const [, imageId] = key.split(':');
      return imageId || null;
    }).filter(Boolean);
  };

  // Helper function to get the moment ID for a single selected image
  const getSelectedImageMomentId = () => {
    if (selectedKeys.size !== 1) return null;
    const key = Array.from(selectedKeys)[0];
    const [momentId] = key.split(':');
    return momentId || null;
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

  const handleMoveComplete = async (result) => {
    // Handle the move completion - toast already shown by modal
    setShowMoveModal(false);
    clearGlobalSelection();
  };




  // Calculate total photo count from sorted images
  const totalPhotoCount = useMemo(() => {
    return sortedImages.length;
  }, [sortedImages]);

  const openImageViewer = (imageId, index) => {
    // Find the image in sortedImages
    const image = sortedImages.find(img => img.id === imageId) || sortedImages[index];
    if (!image) return;
    
    // Find the index in sortedImages
    const currentIndex = sortedImages.findIndex(img => img.id === imageId);
    
    if (currentIndex === -1) return;
    
    // Track the image ID for refocus on close
    setCurrentImageId(imageId);
    
    // Don't pass filteredIds - let ImageViewer construct the list with proper sorting
    // Use a special parent value that signals "all moments"
    openViewer({ 
      index: currentIndex, // Index in all sorted images
      parent: '__all_moments__', // Special value that signals all moments
      entity: 'moment', // Entity type for context
      sortBy: 'date', 
      sortOrder: momentSortOrder, // Use the same sort order as the grid
    });
  };

  const handleJumpToMoment = (momentInfo) => {
    // Use the grid's scrollToMoment method to scroll to the moment header
    if (gridRef.current && gridRef.current.scrollToMoment) {
      const headerId = `header-${momentInfo.id}`;
      gridRef.current.scrollToMoment(headerId);
    }
  };
  
  // Handle carousel navigation to jump to moment header
  const handleCarouselMomentClick = (moment) => {
    // Use the grid's scrollToMoment method to scroll to the moment header
    if (gridRef.current && gridRef.current.scrollToMoment) {
      const headerId = `header-${moment.id}`;
      gridRef.current.scrollToMoment(headerId);
    }
  };

  // Update carousel scroll button visibility
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const updateScrollButtons = () => {
      const scrollLeft = carousel.scrollLeft;
      const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth;
      
      setCanScrollLeft(scrollLeft > 1); // Show left arrow if scrolled right
      setCanScrollRight(scrollLeft < maxScrollLeft - 1); // -1 for floating point precision
    };

    updateScrollButtons();
    carousel.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    
    return () => {
      carousel.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [carouselVisible, moments.length]);

  // Carousel navigation handlers
  const handleCarouselScrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const handleCarouselScrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // Handle click outside carousel to close it
  useEffect(() => {
    if (!carouselVisible) return;

    const handleClickOutside = (event) => {
      if (carouselContainerRef.current && !carouselContainerRef.current.contains(event.target)) {
        // Check if click is on the toggle button in the header (don't close if clicking the button)
        const toggleButton = event.target.closest('button[aria-label*="carousel" i]') || 
                            event.target.closest('button[title*="carousel" i]') ||
                            event.target.closest('button[title*="Hide carousel" i]') ||
                            event.target.closest('button[title*="Show carousel" i]');
        if (!toggleButton) {
          setCarouselVisible(false);
        }
      }
    };

    // Delay to avoid closing immediately when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [carouselVisible]);

  if (storeLoading) return <div className="p-8 text-center" dir={isRTL ? 'rtl' : 'ltr'}>{t('moments.loadingMoments')}</div>;
  if (storeError) return <div className="p-8 text-center text-red-500" dir={isRTL ? 'rtl' : 'ltr'}>{storeError}</div>;

  // Calculate if all current images are selected for the select all button
  const allCurrentImages = new Set(allKeys);
  const allCurrentSelected = allCurrentImages.size > 0 && 
    Array.from(allCurrentImages).every(key => selectedKeys.has(key));

  return (
    <div className="w-full bg-gray-50 min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Toast Notifications */}
      <Toast toast={toast} hideToast={hideToast} />

      <div className="h-[4rem]"></div>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-[4rem] z-30 px-4 sm:px-6 md:px-8 py-3 sm:py-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-4">
          <div className="flex items-center gap-4 sm:gap-6 md:gap-8 flex-wrap">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">{t('moments.timeline')}</h1>
            <div className="flex items-center gap-2 sm:gap-4">
              <p className="text-sm sm:text-base text-gray-600">
                {totalPhotoCount} {t('moments.photos')}
              </p>
            </div>
          </div>
        </div>

        {/* Controls Row */}
        <div className="mt-4 sm:mt-6 md:mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-center divide-x divide-gray-200 flex-wrap">
            {/* Group 1: Edit Moments Button */}
            <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4">
              <PermissionGate requires="canEdit">
                <button
                  onClick={() => setShowEditMomentsModal(true)}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 text-gray-700 flex items-center justify-center"
                  title={t('moments.editMomentsTitle')}
                  aria-label={t('moments.editMomentsTitle')}
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </PermissionGate>
              
              {/* Sort Direction Toggle */}
              <button
                onClick={() => {
                  const newOrder = toggleSortOrder(momentSortOrder);
                  setMomentSortOrder(newOrder);
                }}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 text-gray-700 flex items-center justify-center"
                title={momentSortOrder === 'asc' ? t('moments.sortAscending') : t('moments.sortDescending')}
                aria-label={momentSortOrder === 'asc' ? t('moments.sortAscending') : t('moments.sortDescending')}
              >
                {momentSortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </button>
            </div>
            
            {/* Group 2: View and Size Controls */}
            <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4">
              {storeLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-4 h-4 border-b-2 border-primary-600"></div>
                  <span>{t('moments.loadingPhotos')}</span>
                </div>
              )}
              
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
                title={t('moments.decreaseSize')}
                aria-label={t('moments.decreaseSize')}
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
                    dir={isRTL ? 'rtl' : 'ltr'}
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
                    title={t('moments.increaseSize')}
                    aria-label={t('moments.increaseSize')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
            </div>

            {/* Group 3: Selection Controls */}
            <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4">
              {storeLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                  <span>{t('moments.loadingPhotos')}</span>
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
                    title={selectionMode ? t('moments.cancelSelectionMode') : t('moments.showCheckboxes')}
                    aria-label={selectionMode ? t('moments.cancelSelectionMode') : t('moments.showCheckboxes')}
                  >
                    {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                  
                  {/* Split Carousel Button: Moment Label + Toggle */}
                  <div className="flex items-center border border-gray-200 rounded-md overflow-hidden bg-white shadow-sm">
                    {/* Left part: Current moment label (clickable to jump) */}
                    <button
                      onClick={() => {
                        if (currentVisibleMoment) {
                          handleJumpToMoment({ id: currentVisibleMoment.id });
                        }
                      }}
                      className="px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors flex items-center gap-2 min-w-0 flex-1"
                      title={currentVisibleMoment ? t('moments.jumpToMoment') : t('moments.timeline')}
                      aria-label={currentVisibleMoment ? t('moments.jumpToMoment') : t('moments.timeline')}
                    >
                      <span className="truncate max-w-[120px] sm:max-w-[150px]">
                        {currentVisibleMoment ? currentVisibleMoment.label : t('moments.timeline')}
                      </span>
                    </button>
                    {/* Right part: Narrow toggle button */}
                    <button
                      onClick={() => setCarouselVisible(!carouselVisible)}
                      className="px-2 py-2 border-l border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center flex-shrink-0"
                      title={carouselVisible ? t('moments.hideCarousel') : t('moments.showCarousel')}
                      aria-label={carouselVisible ? t('moments.hideCarousel') : t('moments.showCarousel')}
                    >
                      {carouselVisible ? (
                        <ChevronUp className="w-4 h-4 text-gray-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-600" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Floating Carousel - Below header, triggered from header button */}
      <AnimatePresence>
        {carouselVisible && (
          <motion.div 
            ref={carouselContainerRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`fixed z-40 p-2 ${isRTL ? 'right-4' : 'left-4'}`}
            style={{ top: 'calc(4rem + 9rem)' }} // Position below header (4rem top bar + ~10rem header height)
          >
            <div className="relative bg-white/80 p-2 rounded-lg w-fit max-w-[calc(100vw-2rem)]">
              {/* Left Arrow */}
              {canScrollLeft && (
                <button
                  onClick={handleCarouselScrollLeft}
                  className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-6 h-10 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 rounded-md shadow-md hover:shadow-lg flex items-center justify-center transition-all active:scale-95"
                  aria-label={t('moments.scrollLeft')}
                >
                  <ChevronLeft className="w-4 h-4 text-gray-700 hover:text-gray-900" />
                </button>
              )}
              
              {/* Right Arrow */}
              {canScrollRight && (
                <button
                  onClick={handleCarouselScrollRight}
                  className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-6 h-10 bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 rounded-md shadow-md hover:shadow-lg flex items-center justify-center transition-all active:scale-95"
                  aria-label={t('moments.scrollRight')}
                >
                  <ChevronRight className="w-4 h-4 text-gray-700 hover:text-gray-900" />
                </button>
              )}

              {/* Carousel Container */}
              <div 
                ref={carouselRef}
                className="carousel-container flex items-center gap-0 overflow-x-scroll overflow-y-hidden scrollbar-hide h-32 sm:h-36"
              >
              {moments.length === 0 && (
                <div className="h-32 min-w-[200px] flex items-center justify-center text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  {t('moments.noMomentsYet')}
                </div>
              )}
              {storeLoading && moments.length > 0 && (
                <div className="h-32 min-w-[200px] flex items-center justify-center text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/80"></div>
                    <span>{t('moments.loadingPhotos')}</span>
                  </div>
                </div>
              )}
              {moments.map(moment => (
                <motion.div 
                  key={moment.id} 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                    className="relative flex-shrink-0 min-w-24 sm:min-w-28 md:min-w-28 w-auto h-32 sm:h-36 md:h-36 flex flex-col items-center justify-center p-2 sm:p-3 cursor-pointer transition-all"
                  onClick={() => {
                    handleCarouselMomentClick(moment);
                  }}
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-500/90 to-purple-600/90 rounded-lg overflow-hidden flex items-center justify-center mb-1 sm:mb-2 shadow-lg ring-2 ring-white/20">
                    {ImageComponent(
                      urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('moments', moment.id)}?v=${moment.representative_image || 'none'}` : null,
                      {
                        width: 80,
                        height: 80,
                        className: 'object-cover w-full h-full',
                        alt: moment.label
                      }
                    )}
                  </div>
                    <div className="text-center w-full">
                      <div className="text-sm sm:text-base font-bold text-gray-900 whitespace-nowrap px-1">
                      {moment.label}
                    </div>
                      <div className="text-xs text-gray-700 whitespace-nowrap px-1">
                      {formatTimeOnly(moment.start_date)} - {formatTimeOnly(moment.end_date)}
                    </div>
                  </div>
                </motion.div>
              ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content Area */}
      <div className="px-4 sm:px-8 pt-0 pb-0">
        {moments.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <Calendar className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400" />
            </div>
            <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">{t('moments.noMomentsYet')}</h3>
            <p className="text-sm sm:text-base text-gray-500">{t('moments.createFirstMoment')}</p>
          </div>
        ) : storeLoading ? (
          <div className="text-center py-8 sm:py-12">
            <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-primary-600"></div>
            </div>
            <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">{t('moments.loadingTimeline')}</h3>
            <p className="text-sm sm:text-base text-gray-500">{t('moments.loadingPhotos')}</p>
          </div>
        ) : sortedImages.length === 0 ? (
          <div className="text-center py-12">
            <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">{t('moments.noPhotosYet')}</h3>
            <p className="text-gray-500">{t('moments.noPhotosInMoments')}</p>
          </div>
        ) : (
          <div className="relative">
            {/* Photos Grid */}
            <div className="w-full" style={{ height: `calc(100vh - ${isMobile ? '15rem' : '16rem'})`, marginTop: '1rem' }}>
              <AbsoluteMasonryGrid
                ref={gridRef}
                items={itemsWithHeaders}
                baseSize={Math.max(80, 266 * imageSize)}
                imageClasses={imageClasses}
                containerHeight="100%"
                className="w-full absolute-masonry-grid-container"
                onPinchRef={(node) => {
                  setPinchRef(node);
                  gridContainerRef.current = node;
                }}
                style={{
                  '--grid-scale': 1,
                  '--grid-z-index': 1,
                }}
                renderHeader={(headerData) => {
                  const moment = headerData.moment;
                  if (!moment) return null;
                  
                  const momentImageCount = sortedImages.filter(img => img.moment_id === moment.id).length;
                  const momentImageKeys = sortedImages
                    .filter(img => img.moment_id === moment.id)
                    .map(img => `${moment.id}:${img.id}`);
                  const selectedInMoment = momentImageKeys.filter(key => selectedKeys.has(key));
                  const allSelectedInMoment = momentImageKeys.length > 0 && momentImageKeys.every(key => selectedKeys.has(key));
                  
                  // Use consistent min-height regardless of selection state
                  const headerMinHeight = '4rem';
                  
                  return (
                    <div className="bg-white border-b border-gray-200 px-4 py-3" style={{ minHeight: headerMinHeight }}>
                      <div className="flex items-center gap-3">
                        {/* Representative Image */}
                        <div className="flex-shrink-0">
                          <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shadow-md">
                            {ImageComponent(
                              urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('moments', moment.id)}?v=${moment.representative_image || 'none'}` : null,
                              {
                                width: 48,
                                height: 48,
                                className: 'w-full h-full object-cover',
                                alt: moment.label
                              }
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold text-gray-900 truncate mb-1">{moment.label}</h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 min-h-[1.5rem]">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{formatTimeOnly(moment.start_date)} - {formatTimeOnly(moment.end_date)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>{formatDate(moment.start_date)}</span>
                            </div>
                            {momentImageCount > 0 && (
                              <div className="flex items-center gap-1">
                                <Image className="w-3 h-3" />
                                <span>{momentImageCount} {t('moments.photos')}</span>
                              </div>
                            )}
                            {selectedInMoment.length > 0 && (
                              <span className="text-primary-600 font-medium">
                                • {selectedInMoment.length} {t('moments.selected')}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Selection buttons - square buttons in same row */}
                        {selectionMode && momentImageCount > 0 && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {!allSelectedInMoment && (
                              <button
                                onClick={() => selectAllInMoment(moment.id)}
                                className={`w-8 h-8 rounded-md transition-colors flex items-center justify-center ${
                                  selectedInMoment.length > 0 
                                    ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                                    : 'hover:bg-gray-100 text-gray-700'
                                }`}
                                title={t('moments.selectAll')}
                                aria-label={t('moments.selectAll')}
                              >
                                <CheckCheck className="w-4 h-4" />
                              </button>
                            )}
                            {selectedInMoment.length > 0 && (
                              <button
                                onClick={() => clearMomentSelection(moment.id)}
                                className="w-8 h-8 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors flex items-center justify-center"
                                title={t('moments.clearSelection')}
                                aria-label={t('moments.clearSelection')}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
                onItemRef={(image, index, el) => {
                  if (el && image && !image.isHeader) {
                    registerImageRef(image.id, el);
                    // Store ref for arrow key navigation
                    const actualIndex = sortedImages.findIndex(img => img.id === image.id);
                    if (actualIndex !== -1 && imageTileRefs.current[actualIndex] !== el) {
                      imageTileRefs.current[actualIndex] = el;
                    }
                    // Store ref for PhotoSwipe zoom-out animation
                    handleItemRef(image, index, el);
                  }
                }}
                renderItem={(image, index, isPortrait, setRef) => {
                  // Skip rendering if it's a header (handled by renderHeader)
                  if (image.isHeader) return null;
                  
                  // Find actual index in sortedImages
                  const actualIndex = sortedImages.findIndex(img => img.id === image.id);
                  const momentId = image.moment_id;
                  return (
                    <div
                      className={`photo-card ${imageClasses[image.id] || 'square'}`}
                      style={{ width: '100%', height: '100%' }}
                    >
                      <SingleImageTile
                        ref={setRef}
                        image={image}
                        aspectClass={imageClasses[image.id] || 'square'}
                        thumbSrc={image.isPlaceholder ? null : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                        selectionMode={selectionMode}
                        isSelected={selectedKeys.has(`${momentId}:${image.id}`)}
                        onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                        onOpen={() => {
                          const correctIndex = sortedImages.findIndex(img => img.id === image.id);
                          if (correctIndex !== -1) {
                            openImageViewer(image.id, correctIndex);
                          }
                        }}
                        onImageLoad={(e) => handleImageLoad(image.id, e)}
                        eventUrl={eventUrl}
                        urlHelpers={urlHelpers}
                        isHighlighted={highlightedIds?.has(image.id)}
                        photoIndex={actualIndex !== -1 ? actualIndex : 0}
                        contextType="Moment"
                        contextLabel={moments.find(m => m.id === momentId)?.label || ''}
                      />
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}
      </div>

      {showEditMomentsModal && (
        <EditMomentsModal
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          moments={moments}
          images={allImages.map(item => item.image)}
          onSave={handleSaveMoments}
          onDelete={handleDeleteMoment}
          onToast={showToast}
          onClose={() => setShowEditMomentsModal(false)}
        />
      )}

      {/* Move to Moment Modal */}
      {showMoveModal && (
        <MoveToMomentModal
          isOpen={showMoveModal}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          onClose={() => setShowMoveModal(false)}
          selectedImages={new Set(getSelectedImageIds())}
          onMoveComplete={handleMoveComplete}
        />
      )}

      <AnimatePresence>
        {viewerOpen && (
          <ImageViewer 
            {...viewerProps} 
            onImageChange={handleImageChange}
            itemsRefs={itemsRefs.current}
          />
        )}
      </AnimatePresence>

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
        showRemoveFromMoment={false}
        showMoveToMoment={true}
        showArchive={true}
        showFavorites={true}
        showBucket={true}
        showAlbum={true}
        selectionMode={selectionMode}
        entity="moment"
        entityId={getSelectedImageMomentId()}
      />
    </div>
  );
} 



