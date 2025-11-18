import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Edit, User, ArrowLeft, ArrowRight, Minus, Plus, Archive, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RotateCcw, Eye, EyeOff, Image as ImageIcon, Star, Edit2, Trash2, Key } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TransferFacesModal, SelectFaceForRepModal } from '../groups';
import { MoveToMomentModal } from '../moments';
import { ConfirmDelete } from '../modals';
import { ManageAccessModal } from '../profiles';
import useImageActions from './ImageActions';
import { AlbumQuickAddButton } from '../albums';
import { imagesAPI, handleAPIError, API_BASE, albumsAPI, eventsAPI } from '../../utils/apiService';
import { useDataStore, selectors as storeSelectors, useEventGeneralById } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { getPreference, setPreference } from '../../utils/settings';
import { usePreference } from '../../hooks/useSettings';
import { useModalFocus } from '../../hooks/useModalFocus';
import { sortImages, sortGroups, sortByField, filterImages } from '../../utils/sorting';
import { useModalStore } from '../../utils/modalManager';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';
import { formatErrorMessage } from '../../utils/errorHandler';
import { PermissionGate } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../contexts/authContext';

function formatDateTime(value) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  const seconds = String(parsed.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

const EMPTY_ARRAY = Object.freeze([]);

// ImageViewerActions component - inline component for ImageViewer sidebar
function ImageViewerActions({
  imageId,
  imageInfo,
  eventUrl,
  showToast,
  urlHelpers,
  onImageUpdated,
  entity,
  entityId,
  eventId,
  imageActions,
  isUnassociatedGroup = false
}) {
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [settingEventRepresentative, setSettingEventRepresentative] = useState(false);
  const permissions = usePermissions();
  const eventInfo = useEventGeneralById(eventId);

  const isEventRepresentative = Boolean(eventInfo && imageId && eventInfo.representative_image === imageId);
  const eventRepresentativeTooltip = isEventRepresentative
    ? 'Current event cover photo'
    : 'Set as event cover photo';

  const handleSetEventRepresentative = async () => {
    if (!imageId || !eventUrl || settingEventRepresentative || isEventRepresentative) {
      return;
    }
    try {
      setSettingEventRepresentative(true);
      await eventsAPI.update(eventUrl, { representative_image: imageId });
      showToast('Event cover updated', 'success');
    } catch (error) {
      showToast(formatErrorMessage('set event cover', error), 'error');
    } finally {
      setSettingEventRepresentative(false);
    }
  };

  // Get entity label for modal
  const entityLabel = entity === 'group' 
    ? (useDataStore.getState().entities?.[eventId]?.groups?.[entityId]?.label || 'person')
    : (useDataStore.getState().entities?.[eventId]?.moments?.[entityId]?.label || 'moment');

  // Check if action buttons group has any visible buttons
  const hasActionButtons = true;

  // Check if management buttons exist
  const hasManagementButtons = (
    permissions.canUploadAndDeleteImages ||
    permissions.isProfilesManager
  );

  return (
    <>
      <div className="flex items-center space-x-2">
        {/* Add to album */}
        {permissions.canEdit && (
          <PermissionGate requires="canEdit">
            <AlbumQuickAddButton {...imageActions.albumQuickAddProps} dropdownDirection="down" />
          </PermissionGate>
        )}

        {/* Add to bucket / Remove from bucket */}
        <button
          onClick={imageActions.toggleBucket}
          className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
          title={imageActions.allInBucket ? 'Remove from bucket' : 'Add to bucket'}
        >
          <ShoppingBag className={`w-4 h-4 ${imageActions.allInBucket ? 'fill-blue-400' : ''}`} />
        </button>

        {/* Separator before management buttons - only if action buttons exist AND management buttons exist */}
        {hasActionButtons && hasManagementButtons && <span className="text-gray-300">|</span>}

        {/* Delete image */}
        <PermissionGate requires="canUploadAndDeleteImages">
          <button
            onClick={imageActions.deleteImages}
            className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-100 text-red-600`}
            title="Delete photo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </PermissionGate>

        {/* Manage Access */}
        <PermissionGate requires="isProfilesManager">
          <button
            onClick={() => setShowManageAccessModal(true)}
            className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-blue-100 text-blue-600`}
            title="Manage profile access"
          >
            <Key className="w-4 h-4" />
          </button>
        </PermissionGate>

        {/* Separator before representative button - only if management buttons exist AND can set representative */}
        {hasManagementButtons && imageActions.canSetRepresentative && !isUnassociatedGroup && permissions.canEdit && (
          <span className="text-gray-300">|</span>
        )}

        {/* Set as representative */}
        {imageActions.canSetRepresentative && !isUnassociatedGroup && (
          <PermissionGate requires="canEdit">
            <button
              onClick={() => imageActions.setRepresentative()}
              className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-yellow-50 ${
                imageActions.isRepresentative
                  ? 'text-orange-600'
                  : 'text-yellow-600'
              }`}
              title={imageActions.representativeTooltip}
            >
              <Star className={`w-4 h-4 ${imageActions.isRepresentative ? 'fill-current' : ''}`} />
            </button>
          </PermissionGate>
        )}

        {/* Set as event representative */}
        {imageId && (
          <PermissionGate requires="canManageEvent">
            <button
              onClick={handleSetEventRepresentative}
              className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                isEventRepresentative
                  ? 'bg-gradient-to-br from-red-500 to-rose-500 text-white hover:from-red-500 hover:to-rose-500'
                  : 'text-red-600 hover:bg-red-50'
              } ${settingEventRepresentative ? 'opacity-75 cursor-not-allowed' : ''}`}
              title={eventRepresentativeTooltip}
              aria-pressed={isEventRepresentative}
              disabled={settingEventRepresentative || isEventRepresentative}
            >
              <Star className={`w-4 h-4 ${isEventRepresentative ? 'fill-current' : ''}`} />
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Face selection modal for representative */}
      {imageActions.showFaceSelectionModal && (
        <SelectFaceForRepModal
          isOpen={imageActions.showFaceSelectionModal}
          onClose={imageActions.onCloseFaceSelectionModal}
          faces={imageActions.facesForSelection}
          urlHelpers={urlHelpers}
          groupLabel={entityLabel}
          onSelect={imageActions.onFaceSelected}
        />
      )}

      {/* Delete confirmation modal */}
      {imageActions.showDeleteConfirmModal && (
        <ConfirmDelete
          isOpen={imageActions.showDeleteConfirmModal}
          onClose={imageActions.onCancelDelete}
          onConfirm={imageActions.onConfirmDelete}
          title="Delete Photo"
          message="Are you sure you want to delete this photo?"
          simpleMessage={true}
          images={imageActions.deleteImagesList}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="image"
        entityIds={[imageId]}
        eventUrl={eventUrl}
      />
    </>
  );
}

function ImageViewer({ image, eventUrl, onClose, onNavigate, totalImages, currentIndex, currentGroupId, onJumpToMoment, groups, onTransferComplete, showToast, parent, entity, sortBy, sortOrder, filteredIds, filterByUploadId, urlHelpers, filterGroups, filterMode, onlySelected, includeArchivedOverride = undefined, isUnassociatedGroup = false }) {
  const permissions = usePermissions(); // <-- add this near the top of the component
  const eventId = useEventId(eventUrl);
  const __renderRef = useRef(0); __renderRef.current += 1;
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  // urlHelpers provided by parent, already memoized by eventId
  
  const includeArchivedPreference = usePreference('general.includeArchived', false);
  const includeArchived = includeArchivedOverride !== undefined && includeArchivedOverride !== null
    ? includeArchivedOverride
    : includeArchivedPreference;
  
  
  
  // Use universal util for related images
  const relatedImages = useChilds(eventId, entity + 's', parent, 'images', { filterByUploadId, includeArchived, sortBy, sortOrder });
  
  // Get entities from store for filtering
  const entities = useDataStore((state) => state.entities?.[eventId] || null);
  
  // Apply frontend filtering with same logic as GroupDetailPage
  const filteredImages = useMemo(() => {
    if (!filterGroups || filterGroups.length === 0) {
      return relatedImages;
    }
    
    // Include current group in filtering for OR mode
    const allGroups = [parent, ...filterGroups].filter(Boolean);
    
    // Get all images from all groups (current + filter groups)
    const allImageIds = new Set();
    allGroups.forEach(groupId => {
      const groupImages = entities?.groups?.[groupId]?.images;
      if (groupImages instanceof Set) {
        groupImages.forEach(imageId => allImageIds.add(imageId));
      }
    });
    
    // Convert to image objects and filter by includeArchived
    const allImages = Array.from(allImageIds)
      .map(imageId => entities?.images?.[imageId])
      .filter(Boolean)
      .filter((img) => includeArchived || !img.is_archived);
    
    const filtered = filterImages(allImages, allGroups, filterMode, onlySelected);
    
    // Apply sorting to filtered images
    const sorted = sortImages(filtered, sortBy, sortOrder);
    
    return sorted;
  }, [relatedImages, filterGroups, filterMode, onlySelected, entities, parent, sortBy, sortOrder, includeArchived]);
  
  useEffect(() => {
  }, [filteredImages, entity, parent, includeArchived, sortBy, sortOrder, filterGroups, filterMode, onlySelected]);
  
  // Determine the current image id from store data (clamped index to avoid oscillation)
  const currentImageId = useMemo(() => {
    if (filteredImages.length > 0) {
      const idx = Math.min(Math.max(0, currentIndex), filteredImages.length - 1);
      return filteredImages[idx]?.id || null;
    }
    return typeof image === 'string' ? image : (image?.id || null);
  }, [filteredImages, currentIndex, image]);
  
  const imageId = currentImageId;
  
  // Apply scopes after computing current image id so image.albums updates always pass
  const parentScopeKey = useMemo(() => {
    if (!eventId || !entity || parent === null || parent === undefined) return null;
    return `${eventId}:${entity}:${parent}`;
  }, [eventId, entity, parent]);

  const parentScopeDecisionRef = useRef({ key: null, shouldAdd: false });
  if (parentScopeDecisionRef.current.key !== parentScopeKey) {
    let count = 0;
    if (parentScopeKey) {
      try {
        const store = useDataStore.getState();
        count = store.scopeCounts?.[parentScopeKey] || 0;
      } catch {}
    }
    parentScopeDecisionRef.current = {
      key: parentScopeKey,
      shouldAdd: !!parentScopeKey && count === 0,
    };
  }
  const shouldAddParentScope = parentScopeDecisionRef.current.shouldAdd;

  const appliedScopes = useMemo(() => {
    const scopes = [];
    if (shouldAddParentScope && parent !== null && parent !== undefined && entity) {
      scopes.push({ entity, id: String(parent), eventId });
    }
    if (imageId) {
      scopes.push({ entity: 'image', id: String(imageId), eventId });
    }
    return scopes;
  }, [shouldAddParentScope, parent, entity, eventId, imageId]);

  useApplyScopes(appliedScopes);
  const imageMeta = { id: imageId, label: imageId };
  const displayFilename = imageMeta.label;

  // Diagnostics: track imagesSet ref churn and dependency diffs
  const imagesSetRef = useRef(null);
  useEffect(() => {
    // We no longer read imagesSet directly; rely on useImagesForParent.
    const prev = imagesSetRef.current;
    const signature = `${entity || 'none'}:${parent || 'none'}:${Array.isArray(filteredIds) ? filteredIds.length : 0}`;
    const same = prev === signature;
    imagesSetRef.current = signature;
  }, [entity, parent, filteredIds]);

  const depsSigRef = useRef(null);
  useEffect(() => {
    const sig = {
      imageId,
      currentIndex,
      parent,
      entity,
      sortBy,
      sortOrder,
      filteredLen: Array.isArray(filteredIds) ? filteredIds.length : null,
      includeArchived
    };
    const next = JSON.stringify(sig);
    if (depsSigRef.current && depsSigRef.current !== next) {
      try {
        const prev = JSON.parse(depsSigRef.current);
        const diff = {};
        Object.keys(sig).forEach(k => { if (prev[k] !== sig[k]) diff[k] = { from: prev[k], to: sig[k] }; });
      } catch {}
    }
    depsSigRef.current = next;
  }, [imageId, currentIndex, parent, entity, sortBy, sortOrder, includeArchived]);
  
  // Custom keyboard handler for ImageViewer-specific shortcuts
  const handleImageViewerKeys = (e) => {
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it.
    }
      
    switch (e.key) {
      case 'ArrowLeft':
        if (filteredImages.length > 1) {
          handleNavigate('prev');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case 'ArrowRight':
        if (filteredImages.length > 1) {
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
  // Use universal placeholder components instead of hardcoded data URI
  const [showRectangles, setShowRectangles] = useState(false);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState(null);
  const [zoomInputValue, setZoomInputValue] = useState();
  const [editIndexValue, setEditIndexValue] = useState();
  const [isEditingIndex, setIsEditingIndex] = useState(false);
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [rectangleKey, setRectangleKey] = useState(0);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedFaceForTransfer, setSelectedFaceForTransfer] = useState(null);
  const [transferImageId, setTransferImageId] = useState(null); // Store image ID before transfer
  const [showMoveToMomentModal, setShowMoveToMomentModal] = useState(false);
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
  // Track initial values to avoid persisting unchanged preferences
  const initialValuesRef = useRef({
    albumsOpen: getPreference('ImageViewer.albumsOpen', false),
    facesOpen: getPreference('ImageViewer.facesOpen', false),
    albumsHeight: getPreference('ImageViewer.albumsHeight', 200),
    sidebarVisible: getPreference('ImageViewer.sidebarOpen', false)
  });
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
        // Avoid triggering re-renders from unused state; log once if changed
        if (dynamicHeight !== newHeight) {
        }
        // setDynamicHeight(prev => (prev !== newHeight ? newHeight : prev));
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
    // Register once on mount (scopes are managed via useApplyScopes)
    const { registerModal, unregisterModal } = useModalStore.getState();
    try {
      registerModal({ id: imageViewerModalId, type: 'popup', allowOutsideScroll: true });
    } catch {}
    return () => { try { unregisterModal(imageViewerModalId); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll lock and focus trapping handled by useModalFocus (popup)

  // Force re-render of face rectangles when zoom/rotation changes
  useEffect(() => {
    if (imageLoaded && showRectangles) {
      setRectangleKey(prev => prev + 1);
    }
  }, [zoom, pan, imageLoaded, showRectangles]);

  // Respect user choice; do not auto-open on image change

  // Persist UI state (only when values actually change from initial to avoid unnecessary API calls on mount)
  useEffect(() => {
    if (albumsOpen !== initialValuesRef.current.albumsOpen) {
      initialValuesRef.current.albumsOpen = albumsOpen;
      setPreference('ImageViewer.albumsOpen', albumsOpen);
    }
  }, [albumsOpen]);
  useEffect(() => {
    if (facesOpen !== initialValuesRef.current.facesOpen) {
      initialValuesRef.current.facesOpen = facesOpen;
      setPreference('ImageViewer.facesOpen', facesOpen);
    }
  }, [facesOpen]);
  useEffect(() => {
    if (albumsHeight !== initialValuesRef.current.albumsHeight) {
      initialValuesRef.current.albumsHeight = albumsHeight;
      setPreference('ImageViewer.albumsHeight', albumsHeight);
    }
  }, [albumsHeight]);
  useEffect(() => {
    if (sidebarVisible !== initialValuesRef.current.sidebarVisible) {
      initialValuesRef.current.sidebarVisible = sidebarVisible;
      setPreference('ImageViewer.sidebarOpen', sidebarVisible);
    }
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
      showToast(formatErrorMessage('remove from album', e), 'error');
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

  const imageActions = useImageActions({
    imageIds: imageId,
    eventUrl,
    urlHelpers,
    placeholderDataUrl: null,
    onImageUpdated: handleImageUpdated,
    onAlbumAdded: handleAlbumAdded,
    entity,
    entityId: parent
  });

  // Circular navigation
  const handleNavigate = (direction, index) => {
    if (!onNavigate) return;
    if (direction === 'prev') {
      if (effectiveIndex === 0) {
        onNavigate('jump', filteredImages.length - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (effectiveIndex === filteredImages.length - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    } else if (direction === 'jump' && typeof index === 'number') {
      const clamped = Math.min(Math.max(0, index), Math.max(0, filteredImages.length - 1));
      onNavigate('jump', clamped);
    }
  };


  // Subscribe to current image info from store
  const storeImageInfo = useDataStore(state => imageId ? state.entities?.[eventId]?.images?.[imageId] : null);
  
  // Subscribe to moments entities for reactive updates
  // Avoid subscribing to entire moments map; read on demand
  
  const momentInfo = useMemo(() => {
    if (!isAuthenticated) return null; // No moment info when not authenticated
    const mid = storeImageInfo?.moment_id;
    if (!mid) return null;
    const m = (useDataStore.getState().entities?.[eventId]?.moments || {})[mid];
    if (m) return m;
    return { id: mid, label: storeImageInfo?.moment_label };
  }, [storeImageInfo?.moment_id, storeImageInfo?.moment_label, isAuthenticated, eventId]);


  const storeFacesList = useChilds(eventId, 'images', imageId, 'faces');
  const storeAlbumsList = useChilds(eventId, 'images', imageId, 'albums');
  
  // Create placeholder lists when not authenticated
  const placeholderFaces = useMemo(() => {
    if (isAuthenticated) return EMPTY_ARRAY;
    return [
      { id: 'placeholder-face-1', group_id: 'placeholder-1', groupId: 'placeholder-1', isPlaceholder: true },
      { id: 'placeholder-face-2', group_id: 'placeholder-2', groupId: 'placeholder-2', isPlaceholder: true }
    ];
  }, [isAuthenticated]);
  
  const placeholderAlbums = useMemo(() => {
    if (isAuthenticated) return EMPTY_ARRAY;
    return [
      { id: 'placeholder-album-1', label: '', isPlaceholder: true },
      { id: 'placeholder-album-2', label: '', isPlaceholder: true }
    ];
  }, [isAuthenticated]);
  
  // Return stable arrays or placeholders
  const facesList = isAuthenticated ? storeFacesList : placeholderFaces;
  const albumsList = isAuthenticated ? storeAlbumsList : placeholderAlbums;
  
  useEffect(() => {
  }, [facesList, albumsList]);
  // If albums list seems stale after an add/remove, refresh image info once
  const prevAlbumsCountRef = useRef(null);
  useEffect(() => {
    const count = Array.isArray(albumsList) ? albumsList.length : 0;
    if (prevAlbumsCountRef.current !== null && count === prevAlbumsCountRef.current && imageId) {
      // Trigger a lightweight info refresh to ensure relations are hydrated
      // Scope is already managed by useApplyScopes
      imagesAPI.getImage(imageId, eventUrl).catch(() => {});
    }
    prevAlbumsCountRef.current = count;
  }, [albumsList, imageId, eventUrl]);

  // Find the current image index in the store data
  const currentImageIndex = useMemo(() => {
    if (!imageId || !filteredImages.length) return 0;
    const foundIndex = filteredImages.findIndex(img => img.id === imageId);
    const result = foundIndex >= 0 ? foundIndex : Math.min(currentIndex, filteredImages.length - 1);
    
    return result;
  }, [imageId, filteredImages, currentIndex]);

  // Use the store-based index for navigation
  const effectiveIndex = currentImageIndex;

  // Fetch image info when image changes
  useEffect(() => {
    if (!imageId) return;
    setImageError(false); // Reset error state on image change
    setImageLoaded(false);
    fetchImageInfo();
    
    // Listen for logout to clear image data
    const handleAuthLogout = () => {
      setImageInfo(null);
      setLoading(false);
    };
    
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => window.removeEventListener('auth:logout', handleAuthLogout);
  }, [imageId]);

  const fetchImageInfo = async () => {
    // Skip fetching if not authenticated
    if (!isAuthenticated) {
      setImageInfo(null);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(prev => (prev === true ? prev : true));
      if (imageId && eventUrl) {
        // Request details using new getImage API
        // Scope is already managed by useApplyScopes
        const response = await imagesAPI.getImage(imageId, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        
        const entities = useDataStore.getState().entities?.[eventId] || {};
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
              const faceEntities = store.entities?.[eventId]?.faces || {};
              
              faceIds.forEach((faceId) => {
                const face = faceEntities[faceId];
                if (!face) return;
                
                const gid = face.groupId || face.group_id;
                if (!gid || seen.has(gid)) return;
                seen.add(gid);
                
                const groups = store.entities?.[eventId]?.groups || {};
                const label = face.group_label || (groups[gid] && groups[gid].label) || undefined;
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
      setLoading(prev => (prev === false ? prev : false));
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
      setZoom(prev => {
        const next = Math.max(0.5, Math.min(3, prev + delta));
        return next === prev ? prev : next;
      });
    } else {
      // Pan with wheel
      setPan(prev => {
        const next = { x: prev.x - e.deltaX * 0.5, y: prev.y - e.deltaY * 0.5 };
        return (next.x === prev.x && next.y === prev.y) ? prev : next;
      });
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
    const label = gid ? ((useDataStore.getState().entities?.[eventId]?.groups || {})[gid]?.label || '') : '';
    if (label) {
      navigate(`/${eventUrl}/people/${encodeURIComponent(label)}`, {
        state: { highlightImages: [imageId] }
      });
      onClose();
    }
  };

  const handleJumpToMoment = () => {
    if (momentInfo && eventUrl) {
      // Always use direct navigation when we have eventUrl for proper routing
      const targetUrl = `/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`;
      navigate(targetUrl, {
        state: {
          highlightImages: [imageId],
          highlightMoment: momentInfo.label
        }
      });
      // Close the modal after a short delay to let navigation complete
      setTimeout(() => onClose(), 50);
    } else if (momentInfo && onJumpToMoment) {
      // Fallback to callback if no eventUrl
      onJumpToMoment(momentInfo);
      onClose();
    }
  };

  const handleMomentLinkClick = (e) => {
    if (shouldLetBrowserHandle(e)) return; // Let browser handle
    e.stopPropagation();
    e.preventDefault();
    
    // Navigate first, then close modal
    if (momentInfo && eventUrl) {
      // Always use direct navigation when we have eventUrl for proper routing
      const targetUrl = `/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`;
      navigate(targetUrl, {
        state: {
          highlightImages: [imageId],
          highlightMoment: momentInfo.label
        }
      });
      // Close the modal after a short delay to let navigation complete
      setTimeout(() => onClose(), 50);
    } else if (momentInfo && onJumpToMoment) {
      // Fallback to callback if no eventUrl
      onJumpToMoment(momentInfo);
      onClose();
    }
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
    navigate(`/${eventUrl}/albums/${encodeURIComponent(album.label)}`, {
      state: { highlightImages: [imageId] }
    });
    onClose();
  };

  const handlePersonLinkClick = (e, face) => {
    if (shouldLetBrowserHandle(e)) return; // Let browser handle
    e.stopPropagation();
    e.preventDefault();
    const groupLabel = getGroupLabel(face);
    if (!groupLabel) return;
    navigate(`/${eventUrl}/people/${encodeURIComponent(groupLabel)}`, {
      state: { highlightImages: [imageId] }
    });
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
          const entities = useDataStore.getState().entities?.[eventId] || {};
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

  const handleMoveToMomentComplete = async (result) => {
    // Handle move completion - toast already shown by modal
    setShowMoveToMomentModal(false);
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
      if (!controlsVisible) setControlsVisible(true);
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
    } catch {}
    if (isDragging && zoom > 1) {
      setPan(prev => {
        const next = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
        return (next.x === prev.x && next.y === prev.y) ? prev : next;
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };



  // Face rectangle calculation accounting for object-contain and portrait/landscape
  const getFaceRectangleStyle = (face) => {
    if (imageRef.current && imageLoaded) {
      const img = imageRef.current;
      const container = img.parentElement; // relative positioning context
      const containerRect = container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;
      const naturalW = img.naturalWidth || (storeImageInfo?.width || 1);
      const naturalH = img.naturalHeight || (storeImageInfo?.height || 1);

      // object-contain sizing math (independent of transforms)
      const scale = Math.min(containerW / naturalW, containerH / naturalH);
      const displayedW = naturalW * scale;
      const displayedH = naturalH * scale;
      const offsetXpx = (containerW - displayedW) / 2; // letterbox left
      const offsetYpx = (containerH - displayedH) / 2; // letterbox top

      // Faces may be normalized (0..1) or absolute in original pixels. Detect heuristically.
      const isNormalized = face.left <= 1 && face.top <= 1 && face.width <= 1 && face.height <= 1;
      const toPx = (value, axis) => {
        if (isNormalized) {
          return value * (axis === 'x' ? displayedW : displayedH);
        }
        const base = axis === 'x' ? (storeImageInfo?.width || naturalW) : (storeImageInfo?.height || naturalH);
        return (value / base) * (axis === 'x' ? displayedW : displayedH);
      };

      const leftPx = offsetXpx + toPx(face.left, 'x');
      const topPx = offsetYpx + toPx(face.top, 'y');
      const widthPx = toPx(face.width, 'x');
      const heightPx = toPx(face.height, 'y');
      
      return {
        left: `${(leftPx / containerW) * 100}%`,
        top: `${(topPx / containerH) * 100}%`,
        width: `${(widthPx / containerW) * 100}%`,
        height: `${(heightPx / containerH) * 100}%`,
      };
    }

    // Fallback when not loaded: assume normalized coords
    return {
      left: `${face.left * 100}%`,
      top: `${face.top * 100}%`,
      width: `${face.width * 100}%`,
      height: `${face.height * 100}%`,
    };
  };

  const getImageSrc = () => {
    if (!isAuthenticated) return null; // Show placeholder when not authenticated
    const id = storeImageInfo?.id;
    if (!id) return null;
    if (!urlHelpers) return null;
    return urlHelpers.getDisplayImageUrl(id);
  };

  // Render main image directly with stable element type to avoid remount loops
  const mainImageSrc = getImageSrc();

  const getFaceImageSrc = (face) => {
    const fid = face?.id || face?.face_id;
    if (!fid || !urlHelpers) return null;
    return urlHelpers.getFaceCropUrl(fid);
  };

  const getGroupLabel = (face) => {
    if (face?.isPlaceholder) return ''; // Placeholder faces have no label
    const gid = face?.groupId || face?.group_id;
    if (!gid) return '';
    return (useDataStore.getState().entities?.[eventId]?.groups || {})[gid]?.label || '';
  };

  const getGroupRepresentativeFace = (face) => {
    const gid = face?.groupId || face?.group_id;
    if (!gid) return 'none';
    return (useDataStore.getState().entities?.[eventId]?.groups || {})[gid]?.representative_face || 'none';
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
          className="bg-transparent border-2 border-white/30 rounded-lg shadow-xl w-full mx-4 my-4 overflow-hidden min-h-0 image-viewer-modal"
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
                    {mainImageSrc && !imageError ? (
                      <img
                        ref={imageRef}
                        src={mainImageSrc}
                        alt={imageId}
                        className="max-w-full max-h-full object-contain select-none"
                        width={1050}
                        height={700}
                        draggable={false}
                        onLoad={(e) => {
                          setImageLoaded(true);
                          setImageError(false);
                          if (imageRef.current) {
                            setImageDimensions({
                              width: imageRef.current.naturalWidth,
                              height: imageRef.current.naturalHeight
                            });
                          }
                        }}
                        onError={() => {
                          setImageError(true);
                          setImageLoaded(false);
                        }}
                        style={{ display: 'block' }}
                      />
                    ) : (
                      ImageComponent(mainImageSrc, {
                        width: 200,
                        height: 200,
                        className: 'w-full h-full object-contain select-none',
                        alt: imageId
                      })
                    )}
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
                          <PermissionGate requires="canEdit">
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
                          </PermissionGate>
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

                  {/* Favorites / Archive controls - bottom-left */}
                  <div className="absolute bottom-5 left-4 pointer-events-auto flex items-center space-x-4">
                    {(() => {
                      const favoriteTooltip = imageActions.isFavorite
                        ? (permissions.canEdit ? 'Remove from Favorites' : 'In Favorites')
                        : (permissions.canEdit ? 'Add to Favorites' : 'Favorites');
                      const archiveTooltip = imageActions.isArchived
                        ? (permissions.canEdit ? 'Remove from Archive' : 'In Archive')
                        : (permissions.canEdit ? 'Move to Archive' : 'Archive');
                      
                      return (
                        <>
                        <PermissionGate requires="hasFavoritesAlbum">
                          {(permissions.canEdit || imageActions.isFavorite) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!permissions.canEdit) return;
                                imageActions.toggleFavorite();
                              }}
                              className={`transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                                permissions.canEdit ? 'opacity-100 hover:opacity-100' : 'opacity-80 cursor-default'
                              }`}
                              title={favoriteTooltip}
                              aria-pressed={imageActions.isFavorite}
                              disabled={!permissions.canEdit}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={`w-6 h-6 ${imageActions.isFavorite ? 'text-red-500' : 'text-white'}`}
                                fill={imageActions.isFavorite ? 'currentColor' : 'none'}
                                stroke={imageActions.isFavorite ? 'currentColor' : 'white'}
                                strokeWidth="2"
                                role="img"
                                focusable="false"
                                style={{ color: imageActions.isFavorite ? '#ef4444' : '#ffffff' }}
                              >
                                <title>{favoriteTooltip}</title>
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                              </svg>
                            </button>
                          )}
                        </PermissionGate>

                        <PermissionGate requires="hasArchiveAlbum">
                          {(permissions.canEdit || imageActions.isArchived) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!permissions.canEdit) return;
                                imageActions.toggleArchive();
                              }}
                              className={`transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                                permissions.canEdit ? 'opacity-100 hover:opacity-100' : 'opacity-80 cursor-default'
                              }`}
                              title={archiveTooltip}
                              aria-pressed={imageActions.isArchived}
                              disabled={!permissions.canEdit}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={`w-6 h-6 ${imageActions.isArchived ? 'text-white' : 'text-gray-500'}`}
                                fill="none"
                                stroke={imageActions.isArchived ? 'white' : '#6b7280'}
                                strokeWidth="2"
                                role="img"
                                focusable="false"
                              >
                                <title>{archiveTooltip}</title>
                                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"></path>
                              </svg>
                            </button>
                          )}
                        </PermissionGate>
                        </>
                      );
                    })()}
                  </div>

                  {/* Navigation - top-center */}
                  {filteredImages.length > 1 && (
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
                              val = Math.max(1, Math.min(filteredImages.length, val));
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
                        <span>{filteredImages.length}</span>
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
                  onImageUpdated={handleImageUpdated}
                  entity={entity}
                  entityId={parent}
                  eventId={eventId}
                  imageActions={imageActions}
                  isUnassociatedGroup={isUnassociatedGroup}
                />

                {/* Details Section */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-1">Photo Details</h4>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className="font-semibold">Name:</span> {storeImageInfo?.label || imageMeta.label}</div>
                    <div><span className="font-semibold">Date:</span> {formatDateTime(storeImageInfo?.date_taken)}</div>
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
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500 flex-1 min-w-0">
                        <span className="font-semibold">Moment:</span>
                        {momentInfo ? (
                          <a
                            href={`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`}
                            onClick={handleMomentLinkClick}
                            className="ml-1 text-primary-600 hover:text-primary-700 hover:underline cursor-pointer"
                            title="Jump to moment"
                          >
                            {momentInfo.label}
                          </a>
                        ) : (
                          <span className="ml-1 text-gray-400">None</span>
                        )}
                      </div>
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => setShowMoveToMomentModal(true)}
                          className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center flex-shrink-0 ml-2"
                          title="Edit moment"
                        >
                          <Edit2 className="w-3 h-3 text-gray-600" />
                        </button>
                      </PermissionGate>
                    </div>
                  </div>
                </div>
              </div>

              {/* Albums and Faces Info with resizable split */}
              <div ref={sectionsRef} className="flex flex-col flex-1 min-h-0 overflow-hidden gap-2">
                {/* Albums Panel */}
                {(permissions.has_albums || permissions.canEdit) && albumsList && albumsList.length > 0 && (
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
                        className={`albums-list-container overflow-y-auto ${facesOpen ? '' : 'flex-1 min-h-0'}`}
                        style={facesOpen ? { height: albumsHeight } : {}}
                      >
                        <div className="px-4">
                          {albumsList.map((album, index) => (
                            <div
                              key={album.id || `${album.label || 'album'}-${index}`}
                              className={`flex items-center p-2 rounded-lg bg-gray-50 ${album.isPlaceholder ? '' : 'hover:bg-gray-100'} transition-colors mb-1 last:mb-0`}
                            >
                              {album.isPlaceholder ? (
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  {ImageComponent(null, {
                                    width: 40,
                                    height: 40,
                                    className: 'w-10 h-10 object-cover rounded-lg flex-shrink-0',
                                    alt: ''
                                  })}
                                  <span className="font-medium text-gray-900 truncate">\u00A0</span>
                                </div>
                              ) : (
                                <>
                                  <a
                                    href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`}
                                    onClick={(e) => handleAlbumLinkClick(e, album)}
                                    className="flex items-center space-x-3 flex-1 min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    title={album.label}
                                  >
                                    {ImageComponent(
                                      urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}` : null,
                                      {
                                        width: 40,
                                        height: 40,
                                        className: 'w-10 h-10 object-cover rounded-lg flex-shrink-0',
                                        alt: ''
                                      }
                                    )}
                                    <span className="font-medium text-gray-900 truncate">{album.label}</span>
                                  </a>
                                  <PermissionGate requires="canEdit">
                                    <button
                                      onClick={() => handleRemoveFromAlbum(album)}
                                      className="ml-3 p-1.5 hover:bg-red-100 rounded-lg transition-colors"
                                      title={`Remove from ${album.label}`}
                                    >
                                      <Minus className="w-4 h-4 text-red-600" />
                                    </button>
                                  </PermissionGate>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Resizer */}
                {(permissions.has_albums || permissions.canEdit) && permissions.has_groups && albumsList && albumsList.length > 0 && albumsOpen && facesOpen && (
                  <div
                    className="h-2 bg-gray-100 hover:bg-gray-200 rounded cursor-row-resize mx-4 flex-shrink-0"
                    onMouseDown={startResize}
                    title="Drag to resize"
                  />
                )}

                {/* Faces Panel */}
                {permissions.has_groups && (
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
                      <div className="faces-list-container overflow-y-auto">
                        <div className="px-4">
                          {facesList.length === 0 ? (
                            <p className="text-gray-500 text-sm">No faces detected in this photo.</p>
                          ) : (
                            <div className="space-y-2">
                              {facesList.map((face, index) => (
                                <div
                                  key={`face-list-${(face.id || face.face_id || `index-${index}`)}-${(face.groupId || face.group_id || 'unknown')}-${index}-${imageId}`}
                                  className={`flex items-center space-x-3 p-2 rounded-lg ${face.isPlaceholder ? '' : 'cursor-pointer'} transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                                  onClick={face.isPlaceholder ? undefined : () => handleFaceClick(index)}
                                >
                                  {ImageComponent(
                                    face.isPlaceholder ? null : (urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('groups', face.groupId || face.group_id)}?v=${getGroupRepresentativeFace(face)}` : null),
                                    {
                                      width: 40,
                                      height: 40,
                                      className: 'w-10 h-10 object-cover rounded-full',
                                      alt: getGroupLabel(face),
                                      iconType: 'person'
                                    }
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 truncate">
                                      {getGroupLabel(face) || '\u00A0'}
                                    </p>
                                  </div>
                                  {!face.isPlaceholder && (
                                    <a
                                      href={`/${eventUrl}/people/${encodeURIComponent(getGroupLabel(face))}`}
                                      onClick={(e) => handlePersonLinkClick(e, face)}
                                      className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                                      title="Go to person page"
                                    >
                                      <User className="w-4 h-4 text-gray-600" />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
          urlHelpers={urlHelpers}
          onClose={() => {
            setShowTransferModal(false);
            setSelectedFaceForTransfer(null);
          }}
          currentGroup={selectedFaceForTransfer ? (() => {
            const gid = selectedFaceForTransfer.groupId || selectedFaceForTransfer.group_id;
            if (!gid) return null;
            return (useDataStore.getState().entities?.[eventId]?.groups || {})[gid] || null;
          })() : null}
          selectedFaces={selectedFaceForTransfer?.all_faces_in_image || (selectedFaceForTransfer ? [selectedFaceForTransfer] : [])}
          onTransferComplete={handleTransferComplete}
          sourceGroupId={selectedFaceForTransfer ? (selectedFaceForTransfer.groupId || selectedFaceForTransfer.group_id) : null}
        />
      )}

      {/* Move to Moment Modal */}
      {showMoveToMomentModal && (
        <MoveToMomentModal
          key="move-to-moment-modal"
          isOpen={showMoveToMomentModal}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          onClose={() => setShowMoveToMomentModal(false)}
          selectedImages={imageId ? new Set([imageId]) : new Set()}
          onMoveComplete={handleMoveToMomentComplete}
        />
      )}
    </AnimatePresence>
  );
}

function arePropsEqual(prev, next) {
  // Shallow compare key props that affect rendering; functions by ref
  if (prev.eventUrl !== next.eventUrl) { return false; }
  if (prev.currentIndex !== next.currentIndex) { return false; }
  if (prev.currentGroupId !== next.currentGroupId) { return false; }
  if (prev.parent !== next.parent) { return false; }
  if (prev.entity !== next.entity) { return false; }
  if (prev.sortBy !== next.sortBy) { return false; }
  if (prev.sortOrder !== next.sortOrder) { return false; }
  if (prev.image !== next.image) { return false; }
  if (prev.urlHelpers !== next.urlHelpers) { return false; }
  if (prev.isUnassociatedGroup !== next.isUnassociatedGroup) { return false; }
  const prevFilteredLen = Array.isArray(prev.filteredIds) ? prev.filteredIds.length : prev.filteredIds;
  const nextFilteredLen = Array.isArray(next.filteredIds) ? next.filteredIds.length : next.filteredIds;
  if (prevFilteredLen !== nextFilteredLen) { return false; }
  // Ignore function identity differences
  return true;
}

export default memo(ImageViewer, arePropsEqual);


