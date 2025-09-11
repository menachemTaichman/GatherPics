import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Edit, User, ArrowLeft, ArrowRight, Minus, Plus, Archive, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import TransferFacesModal from './TransferFacesModal';
import { imagesAPI, handleAPIError, API_BASE, albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { useDataStore } from '../utils/dataManager';
import { getSetting, setSetting } from '../utils/settings';
import { useModalFocus } from '../utils/useModalFocus';
import { clearTransferredImagesFromCache } from '../utils/selection';
import timelineManager from '../utils/timeline';
import useBucketStore from '../utils/bucketStore';

function AlbumQuickAddButton({ imageId, eventUrl, showToast, urlHelpers, placeholderDataUrl, onAlbumAdded }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [albums, setAlbums] = useState([]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await albumsAPI.getAll(eventUrl, { exclude_defaults: true });
        if (mounted) setAlbums(res.albums || []);
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, eventUrl]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
        title="Add photo to album"
      >
        <Plus className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 w-64 max-h-72 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg z-20">
          {loading ? (
            <div className="p-3 text-sm text-gray-500">Loading albums...</div>
          ) : (albums.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">No albums</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {albums.map(album => (
                <li key={album.albumID}>
                  <button
                    className="w-full flex items-center space-x-3 p-2 hover:bg-gray-50"
                    onClick={async () => {
                      try {
                        const res = await albumsAPI.addImages(album.albumID, [imageId], eventUrl);
                        const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
                        if (added > 0) {
                          // Update local state immediately
                          if (onAlbumAdded) {
                            onAlbumAdded(album);
                          }
                        }
                        showToast(
                          <span>
                            {added} added to{' '}
                            <Link to={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="underline hover:text-gray-100">{album.label}</Link>
                          </span>,
                          'success'
                        );
                      } catch (e) {
                        showToast('Failed to add to album', 'error');
                      } finally {
                        setOpen(false);
                      }
                    }}
                  >
                    <img src={album.representative_image ? (urlHelpers?.getThumbnailUrl ? urlHelpers.getThumbnailUrl(album.representative_image) : `/api/events/${eventUrl}/thumb/${album.representative_image}.webp`) : (placeholderDataUrl || '')} alt="" className="w-8 h-8 rounded object-cover" />
                    <span className="text-sm text-gray-700 truncate">{album.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImageViewer({ image, eventUrl, onClose, onNavigate, totalImages, currentIndex, currentGroupId, onJumpToMoment, groups, onTransferComplete, showToast }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { urlHelpers } = useEventUrls(eventUrl);
  const lastTransferResult = useDataStore(state => state.lastTransferResult);
  const clearLastTransferResult = useDataStore(state => state.clearLastTransferResult);
  
  // Custom keyboard handler for ImageViewer-specific shortcuts
  const handleImageViewerKeys = (e) => {
    // If the event is coming from one of our specific inputs, let it be handled locally.
    const targetId = e.target.id;
    if ((targetId === 'image-viewer-index' || targetId === 'image-viewer-zoom') && e.key === 'Enter') {
        return true; // Signal that we're handling this, preventing useModalFocus from stopping it.
    }
      
    switch (e.key) {
      case 'ArrowLeft':
        if (totalImages > 1) {
          handleNavigate('prev');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case 'ArrowRight':
        if (totalImages > 1) {
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
  
  // Use modal focus hook
  const { modalRef } = useModalFocus(true, onClose, {
    customKeyHandler: handleImageViewerKeys,
    allowOutsideScroll: true
  });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [faces, setFaces] = useState([]);
  const [imageInfo, setImageInfo] = useState(null);
  const [momentInfo, setMomentInfo] = useState(null);
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
  const [imageAlbums, setImageAlbums] = useState([]);
  const [splitHeights, setSplitHeights] = useState({ albums: 150, faces: 0 });
  const { addImages, removeFromQueue, queue, open } = useBucketStore();
  const [albumsOpen, setAlbumsOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('iv_albumsOpen') || 'false'); } catch { return false; }
  });
  const [facesOpen, setFacesOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('iv_facesOpen') || 'true'); } catch { return true; }
  });
  const [albumsHeight, setAlbumsHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('iv_albumsHeight') || '160', 10); } catch { return 160; }
  });
  const [isResizing, setIsResizing] = useState(false);
  const sectionsRef = useRef(null);
  const startResizeYRef = useRef(0);
  const startAlbumsHeightRef = useRef(0);
  
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    try { return JSON.parse(localStorage.getItem('iv_sidebarVisible') || 'true'); } catch { return true; }
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef(null);
  const [dynamicHeight, setDynamicHeight] = useState(null);

  useEffect(() => {
    const calculateAndSetHeight = () => {
      if (modalRef.current) {
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
        
        setDynamicHeight(newHeight);
      }
    };

    // Recalculate when sidebar visibility changes or window is resized
    calculateAndSetHeight(); // Initial calculation
    
    // Delay to allow DOM to update after sidebar visibility changes
    const timerId = setTimeout(calculateAndSetHeight, 50);

    window.addEventListener('resize', calculateAndSetHeight);

    return () => {
      clearTimeout(timerId);
      window.removeEventListener('resize', calculateAndSetHeight);
    };
  }, [sidebarVisible]);

  // Force re-render of face rectangles when zoom/rotation changes
  useEffect(() => {
    if (imageLoaded && showRectangles) {
      setRectangleKey(prev => prev + 1);
    }
  }, [zoom, pan, imageLoaded, showRectangles]);

  // Respect user choice; do not auto-open on image change

  // Persist UI state
  useEffect(() => {
    try { localStorage.setItem('iv_albumsOpen', JSON.stringify(albumsOpen)); } catch {}
  }, [albumsOpen]);
  useEffect(() => {
    try { localStorage.setItem('iv_facesOpen', JSON.stringify(facesOpen)); } catch {}
  }, [facesOpen]);
  useEffect(() => {
    try { localStorage.setItem('iv_albumsHeight', String(albumsHeight)); } catch {}
  }, [albumsHeight]);
  useEffect(() => {
    try { localStorage.setItem('iv_sidebarVisible', JSON.stringify(sidebarVisible)); } catch {}
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
    if (!imageInfo) return;
    try {
      await albumsAPI.removeImages(album.albumID, [imageInfo.id], eventUrl);
      setImageAlbums(prev => prev.filter(a => a.albumID !== album.albumID));
      const lbl = (album.label || '').toLowerCase();
      if (lbl === 'favorites') {
        setImageInfo(prev => ({ ...prev, is_favorite: false }));
      }
      if (lbl === 'archive') {
        setImageInfo(prev => ({ ...prev, is_archived: false }));
      }
      showToast(
        <span>
          Removed from{' '}
          <a href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="underline hover:text-gray-100">{album.label}</a>
        </span>,
        'success'
      );
    } catch (e) {
      showToast('Failed to remove from album', 'error');
    }
  };

  const handleToggleFavorite = async () => {
    if (!imageInfo) return;
    try {
      const currentFavorite = !!(imageInfo.is_favorite ?? imageInfo.is_favorites);
      const result = await albumsAPI.toggleFavorite([imageInfo.id], currentFavorite, eventUrl);
      if (result) {
        setImageInfo(prev => ({ ...prev, is_favorite: !currentFavorite }));
        showToast(currentFavorite ? 'Removed from favorites' : 'Added to favorites', 'success');
      }
    } catch (e) {
      showToast('Failed to update favorites', 'error');
    }
  };

  const handleAddToArchive = async () => {
    if (!imageInfo) return;
    try {
      const result = await albumsAPI.addToArchive([imageInfo.id], eventUrl);
      if (result) {
        setImageInfo(prev => ({ ...prev, is_archived: true }));
        showToast('Moved to archive', 'success');
      }
    } catch (e) {
      showToast('Failed to move to archive', 'error');
    }
  };

  const handleRemoveFromArchive = async () => {
    if (!imageInfo) return;
    try {
      const result = await albumsAPI.toggleArchive([imageInfo.id], true, eventUrl);
      if (result) {
        setImageInfo(prev => ({ ...prev, is_archived: false }));
        showToast('Removed from archive', 'success');
      }
    } catch (e) {
      showToast('Failed to remove from archive', 'error');
    }
  };

  const handleAlbumAdded = (album) => {
    // Add the album to the local imageAlbums state immediately
    setImageAlbums(prev => {
      // Check if album is already in the list to avoid duplicates
      if (prev.some(a => a.albumID === album.albumID)) {
        return prev;
      }
      return [...prev, album];
    });
    
    // Update imageInfo if it's a special album
    const lbl = (album.label || '').toLowerCase();
    if (lbl === 'favorites') {
      setImageInfo(prev => ({ ...prev, is_favorite: true }));
    }
    if (lbl === 'archive') {
      setImageInfo(prev => ({ ...prev, is_archived: true }));
    }
  };

  // Circular navigation
  const handleNavigate = (direction, index) => {
    if (!onNavigate) return;
    if (direction === 'prev') {
      if (currentIndex === 0) {
        onNavigate('jump', totalImages - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (currentIndex === totalImages - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    } else if (direction === 'jump' && typeof index === 'number') {
      onNavigate('jump', index);
    }
  };

  // Handle both image objects and image IDs
  let imageMeta = image;
  let imageId = null;
  
  if (typeof image === 'string') {
    // If image is a string, treat it as an image ID
    imageId = image;
    imageMeta = { id: image, label: image };
  } else if (image && typeof image === 'object') {
    // If image is an object, extract the ID
    imageId = image.id || image.label || image.name;
  }
  
  // Use the image data directly
  const displayFilename = imageMeta.display_path || imageMeta.thumb_path || imageMeta.original_path || imageMeta.label || imageMeta.id || imageMeta.name;

  // Fetch image info when image changes
  useEffect(() => {
    if (image) {
      fetchImageInfo();
    }
  }, [image]);

  const fetchImageInfo = async () => {
    try {
      setLoading(true);
      // Fetch real image info
      if (imageId && eventUrl) {
        try {
          const info = await imagesAPI.getComplete(imageId, eventUrl, { sort: true });
          setImageInfo(info);
          setFaces(info.faces || []);
          setMomentInfo(info.moment || null);
          setImageAlbums(info.albums || []);
        } catch (err) {
          // Fallback: try basic info
          const info = await imagesAPI.getInfo(imageId, eventUrl);
          setImageInfo(info);
          setFaces(info.faces || []);
          setMomentInfo(info.moment || null);
        }
      } else {
        setImageInfo(null);
        setFaces([]);
        setMomentInfo(null);
      }
    } catch (error) {
      console.error('Error fetching image info:', error);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to data store changes to update face data when transfers happen
  useEffect(() => {
    if (lastTransferResult && lastTransferResult.transferred_images_data && imageId) {
      // Check if the current image was affected by the transfer
      const updatedImageData = lastTransferResult.transferred_images_data.find(
        imageData => imageData.id === imageId || imageData.label === imageId
      );
      
      if (updatedImageData) {
        // Update face data without reloading
        setFaces(updatedImageData.faces || []);
        setImageInfo(updatedImageData);
        setMomentInfo(updatedImageData.moment || null);
        setImageAlbums(updatedImageData.albums || []);
        
        // Important: Clear the result after processing to prevent re-triggering
        setTimeout(() => clearLastTransferResult(), 0);
      } else if (lastTransferResult) {
        // If the current image was not affected, but there was a transfer,
        // still clear the result to prevent it being processed stale later.
        setTimeout(() => clearLastTransferResult(), 0);
      }
    }
  }, [lastTransferResult, imageId, clearLastTransferResult]);

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
    if (face.group_id && groups) {
      const group = groups.find(g => g.groupID === face.group_id);
      if (group) {
        navigate(`/persons/${encodeURIComponent(group.label)}`);
        onClose();
      }
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
    if (!face?.group_label) return;
    navigate(`/${eventUrl}/persons/${encodeURIComponent(face.group_label)}`);
    onClose();
  };

  const handleTransferFace = (face) => {
    setSelectedFaceForTransfer(face);
    setShowTransferModal(true);
  };

  const handleTransferComplete = async (result) => {
    // The API response now triggers a zustand update via an interceptor.
    // The useEffect hook that subscribes to `useDataStore` will handle all UI updates.
    // We only need to show a toast message here and handle parent notifications.
    const transferData = result.changes && result.changes.length > 0 ? result.changes[0].data : null;

    if (transferData) {
      clearTransferredImagesFromCache(transferData.old_group_id, transferData.images_to_remove_from_source);

      // Show a generic success toast if the parent isn't GroupDetail handling its own.
      if (!onTransferComplete || (selectedFaceForTransfer && selectedFaceForTransfer.group_id !== currentGroupId)) {
        const targetGroup = transferData.updated_target_group || 
                              (transferData.target_group_id && groups.find(g => g.groupID === transferData.target_group_id));
        
        if (targetGroup) {
          const link = `/${eventUrl}/persons/${encodeURIComponent(targetGroup.label)}`;
          showToast(
            <span>
              Transferred to <Link to={link} className="underline hover:text-gray-100">{targetGroup.label}</Link>
            </span>, 'success'
          );
        } else {
          showToast('Transfer complete!', 'success');
        }
      }
    }
    
    // The parent component (GroupDetail) is responsible for grid/navigation updates.
    // Only trigger if the transferred face belongs to the currently viewed group.
    if (onTransferComplete && selectedFaceForTransfer && selectedFaceForTransfer.group_id === currentGroupId) {
      onTransferComplete(result);
    }

    setShowTransferModal(false);
    setSelectedFaceForTransfer(null);
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
      const left = offsetX + (face.face_coords.Left * imageWidthPercent);
      const top = offsetY + (face.face_coords.Top * imageHeightPercent);
      const width = face.face_coords.Width * imageWidthPercent;
      const height = face.face_coords.Height * imageHeightPercent;
      
      return {
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      };
    }
    
    // Fallback to simple calculation only when image is not loaded
    return {
      left: `${face.face_coords.Left * 100}%`,
      top: `${face.face_coords.Top * 100}%`,
      width: `${face.face_coords.Width * 100}%`,
      height: `${face.face_coords.Height * 100}%`,
    };
  };

  const getImageSrc = () => {
    if (!imageInfo?.id) return PLACEHOLDER_DATA_URL;
    if (!urlHelpers) return PLACEHOLDER_DATA_URL;
    return urlHelpers.getDisplayImageUrl(imageInfo.id);
  };

  const getFaceImageSrc = (face) => {
    if (!face?.face_id || !urlHelpers) return PLACEHOLDER_DATA_URL;
    return urlHelpers.getFaceCropUrl(face.face_id);
  };

  const isFavorite = !!(imageInfo?.is_favorite ?? imageInfo?.is_favorites);
  const isArchived = !!imageInfo?.is_archived;
  const isInBucket = imageId ? queue.includes(imageId) : false;

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
                    {showRectangles && imageLoaded && faces.map((face, index) => {
                      let borderColor, bgColor, labelBgColor;
                      if (selectedFaceIndex === index) {
                        borderColor = 'border-red-500';
                        bgColor = 'bg-red-500';
                        labelBgColor = 'bg-red-500';
                      } else if (face.group_id === currentGroupId) {
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
                          key={`face-rect-${face.face_id || `index-${index}`}-${rectangleKey}-${index}-${imageId}`}
                          data-face-rectangle="true" // Marker to prevent dragging conflicts
                          className={`absolute border-2 ${borderColor} ${bgColor} bg-opacity-20 cursor-pointer hover:bg-opacity-30 transition-colors`}
                          style={{
                            ...getFaceRectangleStyle(face),
                            pointerEvents: 'auto',
                          }}
                          title={`${face.group_label}`}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering drag
                            handleFaceClick(index);
                          }}
                        >
                          <div className={`absolute -top-6 left-0 ${labelBgColor} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                            {face.group_label}
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
                  {totalImages > 1 && (
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
                            value={editIndexValue !== undefined ? editIndexValue : currentIndex + 1}
                            onChange={e => setEditIndexValue(e.target.value.replace(/[^0-9]/g, ''))}
                            onBlur={e => {
                              let val = parseInt(e.target.value, 10);
                              if (isNaN(val)) val = currentIndex + 1;
                              val = Math.max(1, Math.min(totalImages, val));
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
                            {currentIndex + 1}
                          </span>
                        )}
                        <span className="mx-1">/</span>
                        <span>{totalImages}</span>
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
                <div className="flex items-center space-x-2">
                  {/* Favorites */}
                  <button
                    onClick={handleToggleFavorite}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-50 ${isFavorite ? 'text-red-600' : 'text-gray-700'}`}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={isFavorite}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                  </button>
                  {/* Add to album */}
                  <AlbumQuickAddButton
                    imageId={imageId}
                    eventUrl={eventUrl}
                    showToast={showToast}
                    urlHelpers={urlHelpers}
                    placeholderDataUrl={PLACEHOLDER_DATA_URL}
                    onAlbumAdded={handleAlbumAdded}
                  />
                  {/* Add to bucket / Remove from bucket */}
                  <button
                    onClick={() => {
                      if (imageId) {
                        if (isInBucket) {
                          removeFromQueue(imageId);
                          showToast('Removed from bucket', 'success');
                        } else {
                          addImages([imageId]);
                          open();
                        }
                      }
                    }}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 ${isInBucket ? 'text-gray-700' : 'text-gray-700'}`}
                    title={isInBucket ? 'Remove from bucket' : 'Add to bucket'}
                  >
                    <ShoppingBag className="w-4 h-4" fill={isInBucket ? '#60a5fa' : 'none'} stroke="currentColor" strokeWidth="2" />
                  </button>
                  {/* Archive toggle */}
                  <button
                    onClick={async () => {
                      if (isArchived) {
                        await handleRemoveFromArchive();
                      } else {
                        await handleAddToArchive();
                      }
                    }}
                    className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
                    title={isArchived ? 'Remove from archive' : 'Move to archive'}
                    aria-pressed={isArchived}
                  >
                    <Archive className="w-4 h-4" fill={isArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2" />
                  </button>
                </div>
                {/* Details Section */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-1">Photo Details</h4>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className="font-semibold">Name:</span> {imageInfo?.label || imageMeta.label}</div>
                    <div><span className="font-semibold">Date:</span> {imageInfo?.date_taken || 'Unknown'}</div>
                    <div><span className="font-semibold">Original size:</span> {(() => {
                      const size = imageInfo?.file_size;
                      if (!size) return 'Unknown';
                      if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                      if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
                      return (size / 1024).toFixed(1) + ' KB';
                    })()}</div>
                    <div><span className="font-semibold">Original resolution:</span> {imageInfo?.width && imageInfo?.height ? `${imageInfo.width} x ${imageInfo.height}` : 'Unknown'}</div>
                  </div>
                  
                                     {/* Moment Information */}
                   {momentInfo && (
                     <div className="mt-3 pt-3 border-t border-gray-200">
                       <div className="text-xs text-gray-500">
                         <span className="font-semibold">Moment:</span> 
                         <a
                           href={`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.title)}`}
                           onClick={handleMomentLinkClick}
                           className="ml-1 text-primary-600 hover:text-primary-700 hover:underline cursor-pointer"
                           title="Jump to moment"
                         >
                           {momentInfo.title}
                         </a>
                       </div>
                     </div>
                   )}
                </div>
              </div>

              {/* Albums and Faces Info with resizable split */}
              <div ref={sectionsRef} className="flex flex-col flex-1 min-h-0 overflow-hidden gap-2">
                {/* Albums Panel */}
                {imageAlbums && imageAlbums.length > 0 && (
                  <div className="flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-4 pt-4">
                      <h3 className="font-semibold text-gray-900">Albums ({imageAlbums.length})</h3>
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
                          {imageAlbums.map(album => (
                            <div
                              key={album.albumID}
                              className="flex items-center p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors mb-1 last:mb-0"
                            >
                              <a
                                href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`}
                                onClick={(e) => handleAlbumLinkClick(e, album)}
                                className="flex items-center space-x-3 flex-1 min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                title={album.label}
                              >
                                <img
                                  src={album.representative_image ? (urlHelpers?.getThumbnailUrl ? urlHelpers.getThumbnailUrl(album.representative_image) : `/api/events/${eventUrl}/thumb/${album.representative_image}.webp`) : PLACEHOLDER_DATA_URL}
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
                {imageAlbums && imageAlbums.length > 0 && albumsOpen && facesOpen && (
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
                      <h3 className="font-semibold text-gray-900">Faces ({faces.length})</h3>
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
                        <User className="w-4 h-4" />
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
                        {faces.length === 0 ? (
                          <p className="text-gray-500 text-sm">No faces detected in this photo.</p>
                        ) : (
                          <div className="space-y-2">
                            {faces.map((face, index) => (
                              <div
                                key={`face-list-${face.face_id || `index-${index}`}-${face.group_id || 'unknown'}-${index}-${imageId}`}
                                className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                                onClick={() => handleFaceClick(index)}
                              >
                                <img
                                  src={getFaceImageSrc(face)}
                                  alt={face.group_label}
                                  className="w-10 h-10 object-cover rounded-full"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = PLACEHOLDER_DATA_URL;
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 truncate">
                                    {face.group_label}
                                  </p>
                                </div>
                                <a
                                  href={`/${eventUrl}/persons/${encodeURIComponent(face.group_label)}`}
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
          currentGroup={groups && selectedFaceForTransfer?.group_id ? groups.find(g => g.groupID === selectedFaceForTransfer.group_id) : null}
          selectedFaces={selectedFaceForTransfer?.all_faces_in_image || (selectedFaceForTransfer?.face_id ? [selectedFaceForTransfer.face_id] : [])}
          onTransferComplete={handleTransferComplete}
          showToast={showToast}
          sourceGroupId={selectedFaceForTransfer?.group_id}
        />
      )}
    </AnimatePresence>
  );
}