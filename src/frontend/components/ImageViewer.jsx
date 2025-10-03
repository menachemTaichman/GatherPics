import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Edit, User, ArrowLeft, ArrowRight, Minus, Plus, Archive, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RotateCcw, Eye, EyeOff, Image as ImageIcon } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import TransferFacesModal from './TransferFacesModal';
import useImageActions from './ImageActions';
import AlbumQuickAddButton from './AlbumQuickAddButton';
import { imagesAPI, handleAPIError, API_BASE, albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { useDataStore, selectors as storeSelectors } from '../utils/dataManager';
import { getPreference, setPreference } from '../utils/settings';
import { usePreference } from '../utils/useSettings';
import { useModalFocus } from '../utils/useModalFocus';
import { sortImages, sortGroups, sortByField } from '../utils/sorting';
import { useModalStore } from '../utils/modalManager';

// ImageViewerActions component - inline component for ImageViewer sidebar
function ImageViewerActions({
  imageId,
  imageInfo,
  eventUrl,
  showToast,
  urlHelpers,
  placeholderDataUrl,
  onImageUpdated
}) {
  const imageActions = useImageActions({
    imageIds: imageId,
    eventUrl,
    urlHelpers,
    placeholderDataUrl,
    onImageUpdated,
    onAlbumAdded: (album) => {
      if (onImageUpdated) {
        onImageUpdated({ album_added: album });
      }
    }
  });

  return (
    <div className="flex items-center space-x-2">
      {/* Favorites */}
      <button
        onClick={imageActions.toggleFavorite}
        className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-50 ${imageActions.isFavorite ? 'text-red-600' : 'text-gray-700'}`}
        title={imageActions.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={imageActions.isFavorite}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill={imageActions.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
      </button>

      {/* Add to album */}
      <AlbumQuickAddButton 
        {...imageActions.albumQuickAddProps}
        dropdownDirection="down"
      />

      {/* Add to bucket / Remove from bucket */}
      <button
        onClick={imageActions.toggleBucket}
        className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 ${imageActions.allInBucket ? 'text-gray-700' : 'text-gray-700'}`}
        title={imageActions.allInBucket ? 'Remove from bucket' : 'Add to bucket'}
      >
        <ShoppingBag className="w-4 h-4" fill={imageActions.allInBucket ? '#60a5fa' : 'none'} stroke="currentColor" strokeWidth="2" />
      </button>

      {/* Archive toggle */}
      <button
        onClick={imageActions.toggleArchive}
        className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
        title={imageActions.isArchived ? 'Remove from archive' : 'Move to archive'}
        aria-pressed={imageActions.isArchived}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill={imageActions.isArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
        </svg>
      </button>
    </div>
  );
}

export default function ImageViewer({ image, eventUrl, onClose, onNavigate, totalImages, currentIndex, currentGroupId, onJumpToMoment, groups, onTransferComplete, showToast, parent, entity, sortBy, sortOrder, filteredIds }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { urlHelpers } = useEventUrls(eventUrl);
  const groupsMap = useDataStore(state => state.entities?.groups || {});
  
  // Subscribe to embedded relation Set only (stable reference) and derive ids locally
  const imagesSet = useDataStore(state => {
    if (!parent || !entity) return null;
    const key = entity === 'group' ? 'groups' : (entity === 'album' ? 'albums' : (entity === 'moment' ? 'moments' : null));
    if (!key) return null;
    return state.entities?.[key]?.[parent]?.images || null;
  });
  const images = useDataStore(state => state.entities.images);
  const includeArchived = usePreference('general.includeArchived', false);
  
  
  const relatedImages = useMemo(() => {
    let ids;
    if (filteredIds && entity === 'group') {
      // Use filtered_ids when available for group entities
      ids = Array.isArray(filteredIds) ? filteredIds : [];
    } else {
      // Use relation Set from store
      ids = imagesSet instanceof Set ? Array.from(imagesSet) : [];
    }
    let unsortedImages = ids.map(id => images[id]).filter(Boolean);
    
    // Filter out archived images if includeArchived is false
    if (!includeArchived) {
      unsortedImages = unsortedImages.filter(img => !img.is_archived);
    }
    
    const sorted = sortImages(unsortedImages, sortBy || 'date', sortOrder || 'asc');
    
    return sorted;
  }, [imagesSet, images, sortBy, sortOrder, filteredIds, entity, includeArchived]);
  
  // Determine the current image id from store data (clamped index to avoid oscillation)
  const currentImageId = useMemo(() => {
    if (relatedImages.length > 0) {
      const idx = Math.min(Math.max(0, currentIndex), relatedImages.length - 1);
      return relatedImages[idx]?.id || null;
    }
    return typeof image === 'string' ? image : (image?.id || null);
  }, [relatedImages, currentIndex, image]);
  
  const imageId = currentImageId;
  const imageMeta = { id: imageId, label: imageId };
  const displayFilename = imageMeta.label;
  
  // Custom keyboard handler for ImageViewer-specific shortcuts
  const handleImageViewerKeys = (e) => {
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it.
    }
      
    switch (e.key) {
      case 'ArrowLeft':
        if (relatedImages.length > 1) {
          handleNavigate('prev');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case 'ArrowRight':
        if (relatedImages.length > 1) {
          handleNavigate('next');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case '+':
      case '=':
        handleZoomIn();
        return true; // Mark as handled
      case '-':
        handleZoomOut();
        return true; // Mark as handled
      case '0':
        handleReset();
        return true; // Mark as handled
    }
    return false; // Not handled
  };
  
  // Stable modal id (must be defined before using useModalFocus)
  const imageViewerModalIdRef = useRef(null);
  if (!imageViewerModalIdRef.current) {
    imageViewerModalIdRef.current = `image-viewer-${Math.random().toString(36).slice(2)}`;
  }
  const imageViewerModalId = imageViewerModalIdRef.current;

  // Use modal focus hook
  const { modalRef } = useModalFocus(true, onClose, {
    customKeyHandler: handleImageViewerKeys,
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: imageViewerModalId
  });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imageInfo, setImageInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
  const [showRectangles, setShowRectangles] = useState(false);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState(null);
  const [zoomInputValue, setZoomInputValue] = useState();
  const [editIndexValue, setEditIndexValue] = useState();
  const [isEditingIndex, setIsEditingIndex] = useState(false);
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [rectangleKey, setRectangleKey] = useState(0);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedFaceForTransfer, setSelectedFaceForTransfer] = useState(null);
  const [transferImageId, setTransferImageId] = useState(null); // Store image ID before transfer
  const [splitHeights, setSplitHeights] = useState({ albums: 150, faces: 0 });
  const [albumsOpen, setAlbumsOpen] = useState(() => getPreference('ImageViewer.albumsOpen', false));
  const [facesOpen, setFacesOpen] = useState(() => getPreference('ImageViewer.facesOpen', false));
  const [albumsHeight, setAlbumsHeight] = useState(() => getPreference('ImageViewer.albumsHeight', 200));
  const [isResizing, setIsResizing] = useState(false);
  const sectionsRef = useRef(null);
  const startResizeYRef = useRef(0);
  const startAlbumsHeightRef = useRef(0);
  
  const [sidebarVisible, setSidebarVisible] = useState(() => getPreference('ImageViewer.sidebarOpen', false));
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef(null);
  const [dynamicHeight, setDynamicHeight] = useState(null);
  // Modal registration for scope lifecycle tied to actual modal open/close (no subscription to modal store)

  useEffect(() => {
    let rafId = 0;
    const calculateAndSetHeight = () => {
      if (!modalRef.current) return;
      rafId = requestAnimationFrame(() => {
        if (!modalRef.current) return;
        const modalElement = modalRef.current;
        const modalWidth = modalElement.offsetWidth;
        const sidebarElement = modalElement.querySelector('.image-viewer-sidebar');
        const sidebarWidth = sidebarVisible && sidebarElement ? sidebarElement.offsetWidth : 0;
        const imageContainerWidth = modalWidth - sidebarWidth;
        let newHeight = Math.round((2 / 3) * imageContainerWidth);
        const verticalMarginRem = 3;
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const verticalMarginPx = verticalMarginRem * rootFontSize;
        const maxHeight = window.innerHeight - verticalMarginPx;
        newHeight = Math.min(newHeight, maxHeight);
        setDynamicHeight(prev => (prev !== newHeight ? newHeight : prev));
      });
    };

    calculateAndSetHeight();
    const resizeHandler = () => calculateAndSetHeight();
    window.addEventListener('resize', resizeHandler);
    const timerId = setTimeout(calculateAndSetHeight, 50);
    return () => {
      try { cancelAnimationFrame(rafId); } catch {}
      clearTimeout(timerId);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [sidebarVisible]);

  // Register modal on mount and keep scopes in sync with current image id
  useEffect(() => {
    // Register once on mount (actions fetched without subscribing)
    const { registerModal, unregisterModal } = useModalStore.getState();
    try {
      registerModal({ id: imageViewerModalId, type: 'popup', scopes: imageId ? [{ entity: 'image', id: String(imageId) }] : [], allowOutsideScroll: true });
    } catch {}
    return () => { try { unregisterModal(imageViewerModalId); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevScopedImageIdRef = useRef(null);
  useEffect(() => {
    if (prevScopedImageIdRef.current === imageId) return;
    prevScopedImageIdRef.current = imageId;
    const { updateModalScopes } = useModalStore.getState();
    try {
      updateModalScopes(imageViewerModalId, imageId ? [{ entity: 'image', id: String(imageId) }] : []);
    } catch {}
  }, [imageId, imageViewerModalId]);

  // Scroll lock and focus trapping handled by useModalFocus (popup)

  // Force re-render of face rectangles when zoom/rotation changes
  useEffect(() => {
    if (imageLoaded && showRectangles) {
      setRectangleKey(prev => prev + 1);
    }
  }, [zoom, pan, imageLoaded, showRectangles]);

  // Respect user choice; do not auto-open on image change

  // Persist UI state
  useEffect(() => {
    setPreference('ImageViewer.albumsOpen', albumsOpen);
  }, [albumsOpen]);
  useEffect(() => {
    setPreference('ImageViewer.facesOpen', facesOpen);
  }, [facesOpen]);
  useEffect(() => {
    setPreference('ImageViewer.albumsHeight', albumsHeight);
  }, [albumsHeight]);
  useEffect(() => {
    setPreference('ImageViewer.sidebarOpen', sidebarVisible);
  }, [sidebarVisible]);

  // Global mouse handlers for resizer
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !sectionsRef.current) return;
      const rect = sectionsRef.current.getBoundingClientRect();
      const delta = e.clientY - startResizeYRef.current;
      const minAlbum = 16;
      const minFaces = 100;
      const maxAlbum = Math.max(minAlbum, rect.height - minFaces);
      const proposed = startAlbumsHeightRef.current + delta;
      const next = Math.max(minAlbum, Math.min(proposed, maxAlbum));
      setAlbumsHeight(next);
    };
    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        try { document.body.style.cursor = ''; document.body.style.userSelect = ''; } catch {}
      }
    };
    if (isResizing) {
      try { document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; } catch {}
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try { document.body.style.cursor = ''; document.body.style.userSelect = ''; } catch {}
    };
  }, [isResizing]);


  const startResize = (e) => {
    startResizeYRef.current = e.clientY;
    startAlbumsHeightRef.current = albumsHeight;
    setIsResizing(true);
  };

  const handleRemoveFromAlbum = async (album) => {
    if (!storeImageInfo) return;
    try {
      const result = await albumsAPI.removeImages(album.id, [storeImageInfo.id], eventUrl);
      
      // Changes are automatically applied by apiService interceptor
      
      const count = result?.len_added ?? 1;
      showToast(
        <span>
          Removed {count} {count === 1 ? 'photo' : 'photos'} from{' '}
          <a href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="underline hover:text-gray-100">{album.label}</a>
        </span>,
        'success'
      );
    } catch (e) {
      showToast('Failed to remove from album', 'error');
    }
  };

  const handleImageUpdated = (updates) => {
    // No need to manually update state - the store is automatically updated by the response interceptor
    // The component will re-render when the store changes due to our subscriptions
  };

  const handleAlbumAdded = (album) => {
    // No need to manually update state - the store is automatically updated by the response interceptor
    // The component will re-render when the store changes due to our subscriptions
  };

  // Circular navigation
  const handleNavigate = (direction, index) => {
    if (!onNavigate) return;
    if (direction === 'prev') {
      if (effectiveIndex === 0) {
        onNavigate('jump', relatedImages.length - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (effectiveIndex === relatedImages.length - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    } else if (direction === 'jump' && typeof index === 'number') {
      const clamped = Math.min(Math.max(0, index), Math.max(0, relatedImages.length - 1));
      onNavigate('jump', clamped);
    }
  };


  // Subscribe to current image info from store
  const storeImageInfo = useDataStore(state => imageId ? state.entities?.images?.[imageId] : null);
  
  // Subscribe to moments entities for reactive updates
  const momentsEntities = useDataStore(state => state.entities?.moments || {});
  
  const momentInfo = useMemo(() => {
    const mid = storeImageInfo?.moment_id;
    if (!mid) return null;
    const m = momentsEntities[mid];
    if (m) return m;
    return { id: mid, label: storeImageInfo?.moment_label };
  }, [storeImageInfo?.moment_id, storeImageInfo?.moment_label, momentsEntities]);


  // Subscribe to embedded relation Sets for the current image (like groups.images)
  const imageFacesSet = useDataStore(state => {
    if (!imageId) return null;
    return state.entities?.images?.[imageId]?.faces || null;
  });
  const imageAlbumsSet = useDataStore(state => {
    if (!imageId) return null;
    return state.entities?.images?.[imageId]?.albums || null;
  });

  // Subscribe to faces and groups entities for reactive updates
  const facesEntities = useDataStore(state => state.entities?.faces || {});
  const groupsEntities = useDataStore(state => state.entities?.groups || {});
  const albumsEntities = useDataStore(state => state.entities?.albums || {});
  
  // Derived lists from embedded Sets
  const facesList = useMemo(() => {
    if (!imageFacesSet) return [];
    const ids = Array.from(imageFacesSet);
    const faces = ids.map(fid => facesEntities[fid]).filter(Boolean);
    
    // Sort faces by group label (person name)
    const sorted = sortByField(faces, 'group_label', 'asc', (face) => {
      const gid = face?.groupId || face?.group_id;
      if (!gid) return '';
      return groupsEntities[gid]?.label || '';
    });
    
    return sorted;
  }, [imageFacesSet, facesEntities, groupsEntities]);
  
  const albumsList = useMemo(() => {
    if (!imageAlbumsSet) return [];
    const ids = Array.from(imageAlbumsSet);
    const albums = ids.map(aid => albumsEntities[aid]).filter(Boolean);
    return sortGroups(albums, 'name', 'asc');
  }, [imageAlbumsSet, albumsEntities]);

  // Find the current image index in the store data
  const currentImageIndex = useMemo(() => {
    if (!imageId || !relatedImages.length) return 0;
    const foundIndex = relatedImages.findIndex(img => img.id === imageId);
    const result = foundIndex >= 0 ? foundIndex : Math.min(currentIndex, relatedImages.length - 1);
    
    return result;
  }, [imageId, relatedImages, currentIndex]);

  // Use the store-based index for navigation
  const effectiveIndex = currentImageIndex;

  // Fetch image info when image changes
  useEffect(() => {
    if (!imageId) return;
    fetchImageInfo();
  }, [imageId]);

  const fetchImageInfo = async () => {
    try {
      setLoading(true);
      if (imageId && eventUrl) {
        // Request details using new getImage API
        const response = await imagesAPI.getImage(imageId, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        
        const entities = useDataStore.getState().entities || {};
        const info = entities.images?.[imageId] || null;
        
        if (info) {
          setImageInfo(info);
          // faces, albums, moment are derived from entities
          try {
            const store = useDataStore.getState();
            const seen = new Set();
            const items = [];
            
            // Get face IDs from the Set and look up face data
            if (info.faces instanceof Set) {
              const faceIds = Array.from(info.faces);
              const faceEntities = store.entities?.faces || {};
              
              faceIds.forEach((faceId) => {
                const face = faceEntities[faceId];
                if (!face) return;
                
                const gid = face.groupId || face.group_id;
                if (!gid || seen.has(gid)) return;
                seen.add(gid);
                
                const label = face.group_label || (groupsMap[gid] && groupsMap[gid].label) || undefined;
                items.push(label ? { id: gid, label } : { id: gid });
              });
            }
            
          } catch {}
        } else {
          setImageInfo(null);
          // derived lists will be empty
        }
      } else {
        setImageInfo(null);
        setFaces([]);
        // derived lists will be empty
      }
    } catch (error) {
      console.error('Error fetching image info:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleZoomIn = () => {
    const currentPercent = Math.round(zoom * 100);
    const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
    const add25 = currentPercent + 25;
    const newPercent = Math.min(300, Math.min(add25, next25));
    setZoom(newPercent / 100);
  };
  const handleZoomOut = () => {
    const currentPercent = Math.round(zoom * 100);
    const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
    const subtract25 = currentPercent - 25;
    const newPercent = Math.max(50, Math.max(subtract25, prev25));
    setZoom(newPercent / 100);
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = useCallback((e) => {
    // Prevent default scroll behavior to avoid scrolling the page behind the modal.
    // The modal focus system allows scroll events to pass through from within the modal
    // to support naturally scrollable content. Since this component uses the wheel
    // for custom actions (zoom/pan), we must explicitly prevent default.
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom with Ctrl/Cmd + wheel
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      setZoom(prev => Math.max(0.5, Math.min(3, prev + delta)));
    } else {
      // Pan with wheel
      setPan(prev => ({
        x: prev.x - e.deltaX * 0.5,
        y: prev.y - e.deltaY * 0.5
      }));
    }
  }, []);

  // Manually attach wheel event listener to ensure it's not passive
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);



  const handleFaceClick = (index) => {
    if (selectedFaceIndex === index) {
      setSelectedFaceIndex(null);
    } else {
      setSelectedFaceIndex(index);
    }
  };

  const handleFaceNavigation = (face) => {
    const gid = face?.groupId || face?.group_id;
    const label = gid ? groupsMap[gid]?.label : '';
    if (label) {
      navigate(`/persons/${encodeURIComponent(label)}`);
      onClose();
    }
  };

  const handleJumpToMoment = () => {
    if (momentInfo && onJumpToMoment) {
      onJumpToMoment(momentInfo);
    } else if (momentInfo) {
      // Navigate to timeline page with moment parameter (scoped to event)
      navigate(`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.title)}`);
    }
    // Close the modal when navigating to moment
    onClose();
  };

  const handleMomentLinkClick = (e) => {
    e.stopPropagation();
    // Navigate first, then close modal
    if (momentInfo && onJumpToMoment) {
      onJumpToMoment(momentInfo);
    } else if (momentInfo) {
      // Navigate to timeline page with moment parameter (scoped to event)
      navigate(`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.title)}`);
    }
    // Close the modal after navigation
    onClose();
  };

  const shouldLetBrowserHandle = (e) => {
    // Allow default for modifier/middle/double click so new tab/window works
    return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1 || (e.detail && e.detail > 1);
  };

  const handleAlbumLinkClick = (e, album) => {
    if (shouldLetBrowserHandle(e)) return; // Let browser handle
    e.stopPropagation();
    e.preventDefault();
    if (!album) return;
    navigate(`/${eventUrl}/albums/${encodeURIComponent(album.label)}`);
    onClose();
  };

  const handlePersonLinkClick = (e, face) => {
    if (shouldLetBrowserHandle(e)) return; // Let browser handle
    e.stopPropagation();
    e.preventDefault();
    const groupLabel = getGroupLabel(face);
    if (!groupLabel) return;
    navigate(`/${eventUrl}/persons/${encodeURIComponent(groupLabel)}`);
    onClose();
  };

  const handleTransferFace = (face) => {
    setSelectedFaceForTransfer(face);
    setTransferImageId(imageId); // Store current image ID before transfer
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    // Modal already showed the toast, we just handle UI state
    // Store will be updated automatically by the API response changes
    
    // Close the transfer modal
    setShowTransferModal(false);
    setSelectedFaceForTransfer(null);
    
    // The parent component (GroupDetail) is responsible for grid/navigation updates.
    // Pass through the result if the transferred face belongs to the currently viewed group.
    if (onTransferComplete && selectedFaceForTransfer && selectedFaceForTransfer.group_id === currentGroupId) {
      onTransferComplete(result);
    }

    // If the transfer resulted in the source group being deleted (a merge),
    // navigate to the same image in the target group
    if (result?.source_deleted && transferImageId) {
      // Wait for GroupDetail to handle group navigation first
      setTimeout(() => {
        // Find the image in the new group's images
        const targetGroupId = result.target_group_id;
        if (targetGroupId) {
          const entities = useDataStore.getState().entities || {};
          const targetGroupImages = entities.groups?.[targetGroupId]?.images;

          if (targetGroupImages instanceof Set) {
            const imageIds = Array.from(targetGroupImages);
            const newIndex = imageIds.findIndex(id => id === transferImageId);
            if (newIndex >= 0) {
              // Navigate to the same image in the target group
              onNavigate('jump', newIndex);
            }
          }
        }
        setTransferImageId(null); // Clear stored image ID
      }, 100); // Small delay to ensure GroupDetail navigation completes first
    } else {
      setTransferImageId(null); // Clear stored image ID
    }
  };



  // Mouse wheel handler for zoom
  const handleMouseDown = (e) => {
    // Prevent dragging when clicking on face rectangles
    if (e.target.closest('[data-face-rectangle]')) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    // Show overlay controls on any mouse movement
    try {
      setControlsVisible(true);
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
    } catch {}
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };



  // Fixed face rectangle style calculation - accounts for object-contain image scaling
  const getFaceRectangleStyle = (face) => {
    // Always use the complex calculation when image is loaded
    if (imageRef.current && imageLoaded) {
      const img = imageRef.current;
      const container = img.parentElement;
      
      // Get the actual displayed image dimensions
      const imgRect = img.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      // Calculate the offset of the image within the container
      const offsetX = (imgRect.left - containerRect.left) / containerRect.width * 100;
      const offsetY = (imgRect.top - containerRect.top) / containerRect.height * 100;
      
      // Calculate the scaled dimensions of the image as percentages of the container
      const imageWidthPercent = (imgRect.width / containerRect.width) * 100;
      const imageHeightPercent = (imgRect.height / containerRect.height) * 100;
      
      // Calculate the face rectangle position and size
      const left = offsetX + (face.left * imageWidthPercent);
      const top = offsetY + (face.top * imageHeightPercent);
      const width = face.width * imageWidthPercent;
      const height = face.height * imageHeightPercent;
      
      return {
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      };
    }
    
    // Fallback to simple calculation only when image is not loaded
    return {
      left: `${face.left * 100}%`,
      top: `${face.top * 100}%`,
      width: `${face.width * 100}%`,
      height: `${face.height * 100}%`,
    };
  };

  const getImageSrc = () => {
    const id = storeImageInfo?.id;
    if (!id) return PLACEHOLDER_DATA_URL;
    if (!urlHelpers) return PLACEHOLDER_DATA_URL;
    return urlHelpers.getDisplayImageUrl(id);
  };

  const getFaceImageSrc = (face) => {
    const fid = face?.id || face?.face_id;
    if (!fid || !urlHelpers) return PLACEHOLDER_DATA_URL;
    return urlHelpers.getFaceCropUrl(fid);
  };

  const getGroupLabel = (face) => {
    const gid = face?.groupId || face?.group_id;
    if (!gid) return '';
    return groupsEntities[gid]?.label || '';
  };


  useEffect(() => {
    // Initial auto-hide schedule for controls
    try {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
    } catch {}
    return () => {
      try { if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current); } catch {}
    };
  }, []);

  return (
    <AnimatePresence>
      <div key="image-viewer-modal" className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-hidden modal-overlay">
        <motion.div
          ref={modalRef}
          className="bg-transparent border-2 border-white/30 rounded-lg shadow-xl w-full mx-4 my-4 overflow-hidden overscroll-contain min-h-0 image-viewer-modal"
          style={{ 
            maxHeight: 'calc(100vh - 3rem)',
            height: 'calc(min(100vw - 2rem, 1024px) * 0.67)', // Always use base modal width for consistent image container
            maxWidth: sidebarVisible ? '1344px' : '1024px' // 1024px + 320px for sidebar
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          tabIndex={-1}
        >

          {/* Content */}
          <div className="flex h-full overflow-hidden min-h-0">
            {/* Image Viewer */}
            <div 
              ref={containerRef}
              className="flex items-center justify-center bg-gray-900 relative overflow-hidden cursor-grab active:cursor-grabbing"
              style={{ 
                width: 'calc(min(100vw - 2rem, 1024px))' // Always use base modal width for consistent image container
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {loading ? (
                <div className="text-white">Loading...</div>
              ) : (
                <motion.div
                  className="relative"
                  style={{
                    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                    width: '100%',
                    height: '100%',
                    transformOrigin: 'center center', // Ensure rotation happens from center
                  }}
                >
                  <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img
                      src={getImageSrc()}
                      alt={imageId}
                      className="max-w-full max-h-full object-contain select-none"
                      draggable={false}
                      loading="lazy"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = PLACEHOLDER_DATA_URL;
                      }}
                      ref={imageRef}
                      onLoad={() => {
                        setImageLoaded(true);
                        if (imageRef.current) {
                          setImageDimensions({
                            width: imageRef.current.naturalWidth,
                            height: imageRef.current.naturalHeight
                          });
                        }
                      }}
                      style={{display: 'block'}}
                    />
                    {/* Overlays: show unarchive when archived */}
                    {/* No image overlay actions */}
                    
                    {/* Face rectangles - now inside the transformed container */}
                    {showRectangles && imageLoaded && facesList.map((face, index) => {
                      let borderColor, bgColor, labelBgColor;
                      if (selectedFaceIndex === index) {
                        borderColor = 'border-red-500';
                        bgColor = 'bg-red-500';
                        labelBgColor = 'bg-red-500';
                      } else if ((face.groupId || face.group_id) === currentGroupId) {
                        borderColor = 'border-green-500';
                        bgColor = 'bg-green-500';
                        labelBgColor = 'bg-green-500';
                      } else {
                        borderColor = 'border-blue-500';
                        bgColor = 'bg-blue-500';
                        labelBgColor = 'bg-blue-500';
                      }
                      return (
                        <div
                          key={`face-rect-${(face.id || face.face_id || `index-${index}`)}-${rectangleKey}-${index}-${imageId}`}
                          data-face-rectangle="true" // Marker to prevent dragging conflicts
                          className={`absolute border-2 ${borderColor} ${bgColor} bg-opacity-20 cursor-pointer hover:bg-opacity-30 transition-colors`}
                          style={{
                            ...getFaceRectangleStyle(face),
                            pointerEvents: 'auto',
                          }}
                          title={`${getGroupLabel(face)}`}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering drag
                            handleFaceClick(index);
                          }}
                        >
                          <div className={`absolute -top-6 left-0 ${labelBgColor} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                            {getGroupLabel(face)}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTransferFace(face);
                            }}
                            className={`absolute -bottom-4 -left-1 ${bgColor} text-white p-0.5 rounded hover:bg-opacity-80 transition-colors`}
                            title="Transfer face to another group"
                          >
                            <Edit className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* On-image overlay controls */}
              {!loading && (
                <div className={`absolute inset-0 z-30 transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0'} pointer-events-none`}
                     onMouseMove={() => {
                       try {
                         setControlsVisible(true);
                         if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
                         hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
                       } catch {}
                     }}
                     onMouseLeave={() => {
                       try {
                         if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
                       } catch {}
                       setControlsVisible(false);
                     }}
                >
                  {/* Close button - top-left */}
                  <button
                    onClick={onClose}
                    className="absolute top-4 left-4 pointer-events-auto bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                    title="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  {/* Navigation - top-center */}
                  {relatedImages.length > 1 && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center space-x-2 pointer-events-auto">
                      <button
                        onClick={() => handleNavigate('prev')}
                        className="bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                        title="Previous"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="bg-white/80 text-gray-800 rounded-md px-2 h-8 shadow flex items-center">
                        {isEditingIndex ? (
                          <input
                            type="text"
                            id="image-viewer-index"
                            name="image-viewer-index"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={editIndexValue !== undefined ? editIndexValue : effectiveIndex + 1}
                            onChange={e => setEditIndexValue(e.target.value.replace(/[^0-9]/g, ''))}
                            onBlur={e => {
                              let val = parseInt(e.target.value, 10);
                              if (isNaN(val)) val = effectiveIndex + 1;
                              val = Math.max(1, Math.min(relatedImages.length, val));
                              handleNavigate('jump', val - 1);
                              setIsEditingIndex(false);
                              setEditIndexValue(undefined);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.target.blur();
                              } else if (e.key === 'Escape') {
                                setIsEditingIndex(false);
                                setEditIndexValue(undefined);
                              }
                            }}
                            className="w-8 text-center bg-transparent focus:outline-none"
                            style={{width: '2rem'}}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="w-8 inline-block text-center cursor-text"
                            style={{width: '2rem'}}
                            title="Click to edit"
                            onClick={() => setIsEditingIndex(true)}
                          >
                            {effectiveIndex + 1}
                          </span>
                        )}
                        <span className="mx-1">/</span>
                        <span>{relatedImages.length}</span>
                      </div>
                      <button
                        onClick={() => handleNavigate('next')}
                        className="bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                        title="Next"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Zoom - bottom-center */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center space-x-2 pointer-events-auto">
                    <button
                      onClick={handleZoomOut}
                      className="bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                      title="Zoom out"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="bg-white/80 text-gray-800 rounded-md px-2 h-8 shadow flex items-center space-x-1">
                      <input
                        type="text"
                        id="image-viewer-zoom"
                        name="image-viewer-zoom"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={zoomInputValue !== undefined ? zoomInputValue : Math.round(zoom * 100)}
                        onChange={e => setZoomInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                        onBlur={e => {
                          let val = parseInt(e.target.value, 10);
                          if (isNaN(val)) val = 100;
                          val = Math.max(50, Math.min(300, val));
                          setZoom(val / 100);
                          setZoomInputValue(undefined);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.target.blur();
                          } else if (e.key === 'Escape') {
                            setZoomInputValue(undefined);
                          }
                        }}
                        className="w-10 text-center bg-transparent focus:outline-none"
                        style={{width: '2.5rem'}}
                      />
                    </div>
                    <button
                      onClick={handleZoomIn}
                      className="bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                      title="Zoom in"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleReset}
                      className="bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                      title="Reset zoom"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>


                  {/* Sidebar toggle - top-right */}
                  <button
                    onClick={() => setSidebarVisible(v => !v)}
                    className="absolute top-4 right-4 pointer-events-auto bg-white/80 hover:bg-white text-gray-800 rounded-md w-8 h-8 flex items-center justify-center shadow"
                    title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
                  >
                    {sidebarVisible ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  </button>
                </div>
              )}
              
            </div>

                    {/* Sidebar */}
        {sidebarVisible && (
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full min-h-0 image-viewer-sidebar">
          {/* Controls */}
          <div className="p-3 border-b border-gray-200 image-viewer-controls flex-none relative">
                <ImageViewerActions
                  imageId={imageId}
                  imageInfo={storeImageInfo}
                  eventUrl={eventUrl}
                  showToast={showToast}
                  urlHelpers={urlHelpers}
                  placeholderDataUrl={PLACEHOLDER_DATA_URL}
                  onImageUpdated={handleImageUpdated}
                />

                {/* Details Section */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-1">Photo Details</h4>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className="font-semibold">Name:</span> {storeImageInfo?.label || imageMeta.label}</div>
                    <div><span className="font-semibold">Date:</span> {storeImageInfo?.date_taken || 'Unknown'}</div>
                    <div><span className="font-semibold">Original size:</span> {(() => {
                      const size = storeImageInfo?.file_size;
                      if (!size) return 'Unknown';
                      if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                      if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
                      return (size / 1024).toFixed(1) + ' KB';
                    })()}</div>
                    <div><span className="font-semibold">Original resolution:</span> {storeImageInfo?.width && storeImageInfo?.height ? `${storeImageInfo.width} x ${storeImageInfo.height}` : 'Unknown'}</div>
                  </div>
                  
                                     {/* Moment Information */}
                   {momentInfo && (
                     <div className="mt-3 pt-3 border-t border-gray-200">
                       <div className="text-xs text-gray-500">
                         <span className="font-semibold">Moment:</span> 
                         <a
                           href={`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`}
                           onClick={handleMomentLinkClick}
                           className="ml-1 text-primary-600 hover:text-primary-700 hover:underline cursor-pointer"
                           title="Jump to moment"
                         >
                           {momentInfo.label}
                         </a>
                       </div>
                     </div>
                   )}
                </div>
              </div>

              {/* Albums and Faces Info with resizable split */}
              <div ref={sectionsRef} className="flex flex-col flex-1 min-h-0 overflow-hidden gap-2">
                {/* Albums Panel */}
                {albumsList && albumsList.length > 0 && (
                  <div className="flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-4 pt-4">
                      <h3 className="font-semibold text-gray-900">Albums ({albumsList.length})</h3>
                      <button
                        onClick={() => setAlbumsOpen(v => !v)}
                        className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                        title={albumsOpen ? 'Hide albums' : 'Show albums'}
                      >
                        {albumsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                    {albumsOpen && (
                      <div
                        className={`albums-list-container overflow-y-auto overscroll-contain ${facesOpen ? '' : 'flex-1 min-h-0'}`}
                        style={facesOpen ? { height: albumsHeight } : {}}
                      >
                        <div className="px-4">
                          {albumsList.map((album, index) => (
                            <div
                              key={album.id || `${album.label || 'album'}-${index}`}
                              className="flex items-center p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors mb-1 last:mb-0"
                            >
                              <a
                                href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`}
                                onClick={(e) => handleAlbumLinkClick(e, album)}
                                className="flex items-center space-x-3 flex-1 min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                title={album.label}
                              >
                                <img
                                  src={urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl('albums', album.id) : PLACEHOLDER_DATA_URL}
                                  alt=""
                                  className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = PLACEHOLDER_DATA_URL;
                                  }}
                                />
                                <span className="font-medium text-gray-900 truncate">{album.label}</span>
                              </a>
                              <button
                                onClick={() => handleRemoveFromAlbum(album)}
                                className="ml-3 p-1.5 hover:bg-red-100 rounded-lg transition-colors"
                                title={`Remove from ${album.label}`}
                              >
                                <Minus className="w-4 h-4 text-red-600" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Resizer */}
                {albumsList && albumsList.length > 0 && albumsOpen && facesOpen && (
                  <div
                    className="h-2 bg-gray-100 hover:bg-gray-200 rounded cursor-row-resize mx-4 flex-shrink-0"
                    onMouseDown={startResize}
                    title="Drag to resize"
                  />
                )}

                {/* Faces Panel */}
                <div className="flex flex-col flex-1 min-h-0 image-viewer-faces">
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold text-gray-900">Faces ({facesList.length})</h3>
                      <button
                        onClick={() => {
                          if (showRectangles) {
                            setSelectedFaceIndex(null);
                          }
                          setShowRectangles(v => !v);
                        }}
                        className={`w-7 h-7 border border-transparent rounded-md transition-colors flex items-center justify-center ${showRectangles ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-700'}`}
                        title={showRectangles ? 'Hide face tags' : 'Show face tags'}
                      >
                        {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={() => setFacesOpen(v => !v)}
                      className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                      title={facesOpen ? 'Hide faces' : 'Show faces'}
                    >
                      {facesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                  {facesOpen && (
                    <div className="faces-list-container overflow-y-auto overscroll-contain">
                      <div className="px-4">
                        {facesList.length === 0 ? (
                          <p className="text-gray-500 text-sm">No faces detected in this photo.</p>
                        ) : (
                          <div className="space-y-2">
                            {facesList.map((face, index) => (
                              <div
                                key={`face-list-${(face.id || face.face_id || `index-${index}`)}-${(face.groupId || face.group_id || 'unknown')}-${index}-${imageId}`}
                                className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                                onClick={() => handleFaceClick(index)}
                              >
                                <img
                                  src={urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl('groups', face.groupId || face.group_id) : PLACEHOLDER_DATA_URL}
                                  alt={getGroupLabel(face)}
                                  className="w-10 h-10 object-cover rounded-full"
                                  loading="lazy"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 truncate">
                                    {getGroupLabel(face)}
                                  </p>
                                </div>
                                <a
                                  href={`/${eventUrl}/persons/${encodeURIComponent(getGroupLabel(face))}`}
                                  onClick={(e) => handlePersonLinkClick(e, face)}
                                  className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                                  title="Go to person page"
                                >
                                  <User className="w-4 h-4 text-gray-600" />
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
        )}
          </div>
        </motion.div>
      </div>

      {/* Transfer Faces Modal */}
      {showTransferModal && selectedFaceForTransfer && (
        <TransferFacesModal
          key="transfer-faces-modal"
          isOpen={showTransferModal}
          eventUrl={eventUrl}
          onClose={() => {
            setShowTransferModal(false);
            setSelectedFaceForTransfer(null);
          }}
          currentGroup={groupsMap && selectedFaceForTransfer ? (() => {
            const gid = selectedFaceForTransfer.groupId || selectedFaceForTransfer.group_id;
            return gid ? Object.values(groupsMap).find(g => (g.id || g.group_id) === gid) : null;
          })() : null}
          selectedFaces={selectedFaceForTransfer?.all_faces_in_image || (selectedFaceForTransfer ? [selectedFaceForTransfer] : [])}
          onTransferComplete={handleTransferComplete}
          sourceGroupId={selectedFaceForTransfer ? (selectedFaceForTransfer.groupId || selectedFaceForTransfer.group_id) : null}
        />
      )}
    </AnimatePresence>
  );
}