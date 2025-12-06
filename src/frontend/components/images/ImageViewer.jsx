import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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
import { useRTL } from '../../hooks/useRTL';
import { formatDateTime } from '../../utils/dateUtils';

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
  isUnassociatedGroup = false,
  isMobile = false
}) {
  const { t } = useTranslation();
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [settingEventRepresentative, setSettingEventRepresentative] = useState(false);
  const permissions = usePermissions();
  const eventInfo = useEventGeneralById(eventId);

  const isEventRepresentative = Boolean(eventInfo && imageId && eventInfo.representative_image === imageId);
  const eventRepresentativeTooltip = isEventRepresentative
    ? t('imageViewer.currentEventCoverPhoto')
    : t('imageViewer.setAsEventCoverPhoto');

  const handleSetEventRepresentative = async () => {
    if (!imageId || !eventUrl || settingEventRepresentative || isEventRepresentative) {
      return;
    }
    try {
      setSettingEventRepresentative(true);
      await eventsAPI.update(eventUrl, { representative_image: imageId });
      showToast(t('imageViewer.eventCoverUpdated'), 'success');
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
      <div className="flex items-center gap-2">
        {/* Add to album */}
        {permissions.canEdit && (
          <PermissionGate requires="canEdit">
            <AlbumQuickAddButton {...imageActions.albumQuickAddProps} dropdownDirection="down" />
          </PermissionGate>
        )}

        {/* Add to bucket / Remove from bucket */}
        <button
          onClick={imageActions.toggleBucket}
          className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
          title={imageActions.allInBucket ? t('imageViewer.removeFromBucket') : t('imageViewer.addToBucket')}
          aria-label={imageActions.allInBucket ? t('imageViewer.removeFromBucket') : t('imageViewer.addToBucket')}
        >
          <ShoppingBag className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${imageActions.allInBucket ? 'fill-blue-400' : ''}`} />
        </button>

        {/* Separator before management buttons - only if action buttons exist AND management buttons exist */}
        {hasActionButtons && hasManagementButtons && <span className="text-gray-300">|</span>}

        {/* Delete image */}
        <PermissionGate requires="canUploadAndDeleteImages">
          <button
            onClick={imageActions.deleteImages}
            className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-100 text-red-600`}
            title={t('imageViewer.deletePhoto')}
            aria-label={t('imageViewer.deletePhoto')}
          >
            <Trash2 className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
        </PermissionGate>

        {/* Manage Access */}
        <PermissionGate requires="isProfilesManager">
          <button
            onClick={() => setShowManageAccessModal(true)}
            className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-blue-100 text-blue-600`}
            title={t('imageViewer.manageProfileAccess')}
            aria-label={t('imageViewer.manageProfileAccess')}
          >
            <Key className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
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
              className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-yellow-50 ${
                imageActions.isRepresentative
                  ? 'text-orange-600'
                  : 'text-yellow-600'
              }`}
              title={imageActions.representativeTooltip}
            >
              <Star className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${imageActions.isRepresentative ? 'fill-current' : ''}`} />
            </button>
          </PermissionGate>
        )}

        {/* Set as event representative */}
        {imageId && (
          <PermissionGate requires="canManageEvent">
            <button
              onClick={handleSetEventRepresentative}
              className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center ${
                isEventRepresentative
                  ? 'bg-gradient-to-br from-red-500 to-rose-500 text-white hover:from-red-500 hover:to-rose-500'
                  : 'text-red-600 hover:bg-red-50'
              } ${settingEventRepresentative ? 'opacity-75 cursor-not-allowed' : ''}`}
              title={eventRepresentativeTooltip}
              aria-pressed={isEventRepresentative}
              disabled={settingEventRepresentative || isEventRepresentative}
            >
              <Star className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isEventRepresentative ? 'fill-current' : ''}`} />
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
          title={t('imageViewer.deletePhoto')}
          message={t('imageViewer.areYouSureYouWantToDeleteThisPhoto')}
          simpleMessage={true}
          images={imageActions.deleteImagesList}
          confirmText={t('imageViewer.delete')}
          cancelText={t('imageViewer.cancel')}
          caption={t('imageViewer.thisActionCannotBeUndone')}
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
  const { t } = useTranslation();
  const permissions = usePermissions(); // <-- add this near the top of the component
  const { isRTL, ms, me, startClass, endClass } = useRTL();
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
          handleNavigate(isRTL ? 'next' : 'prev');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case 'ArrowRight':
        if (filteredImages.length > 1) {
          handleNavigate(isRTL ? 'prev' : 'next');
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
  const initialMousePanRef = useRef({ x: 0, y: 0 });
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
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [splitHeights, setSplitHeights] = useState({ albums: 150, faces: 0 });
  const [albumsOpen, setAlbumsOpen] = useState(() => getPreference('ImageViewer.albumsOpen', false));
  const [facesOpen, setFacesOpen] = useState(() => getPreference('ImageViewer.facesOpen', false));
  const [albumsHeight, setAlbumsHeight] = useState(() => getPreference('ImageViewer.albumsHeight', 200));
  const [isResizing, setIsResizing] = useState(false);
  const sectionsRef = useRef(null);
  const startResizeYRef = useRef(0);
  const startAlbumsHeightRef = useRef(0);
  
  // Detect mobile - hide sidebar by default on mobile
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
  
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    // Hide sidebar by default on mobile
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return false;
    }
    return getPreference('ImageViewer.sidebarOpen', false);
  });
  // Keep controls visible on mobile, auto-hide on desktop
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

  // Calculate modal dimensions for mobile to maintain landscape aspect ratio
  const [mobileModalStyle, setMobileModalStyle] = useState({});
  
  useEffect(() => {
    if (!isMobile) {
      setMobileModalStyle({});
      return;
    }
    
    const calculateMobileDimensions = () => {
      if (!modalRef.current) return;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Leave space for buttons (top and bottom controls)
      const availableHeight = viewportHeight - 5 * 16; // 5rem for buttons/margins
      const availableWidth = viewportWidth; // Full width, no margins
      
      // Calculate height based on 3:2 aspect ratio (width * 0.67 = height)
      const aspectRatioHeight = availableWidth * 0.67;
      
      // Use the smaller of: aspect ratio height or available viewport height
      const finalHeight = Math.min(aspectRatioHeight, availableHeight);
      const finalWidth = finalHeight / 0.67; // Reverse calculate width from height
      
      setMobileModalStyle({
        width: `${Math.min(finalWidth, availableWidth)}px`,
        height: `${finalHeight}px`,
        maxWidth: `${availableWidth}px`,
        maxHeight: `${availableHeight}px`
      });
    };
    
    calculateMobileDimensions();
    const resizeHandler = () => calculateMobileDimensions();
    window.addEventListener('resize', resizeHandler);
    const timerId = setTimeout(calculateMobileDimensions, 50);
    
    return () => {
      clearTimeout(timerId);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [isMobile, sidebarVisible]);
  
  useEffect(() => {
    let rafId = 0;
    const calculateAndSetHeight = () => {
      if (isMobile) return; // Skip desktop calculation on mobile
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
  }, [sidebarVisible, isMobile]);

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
    // Only persist sidebar preference on desktop
    if (!isMobile && sidebarVisible !== initialValuesRef.current.sidebarVisible) {
      initialValuesRef.current.sidebarVisible = sidebarVisible;
      setPreference('ImageViewer.sidebarOpen', sidebarVisible);
    }
  }, [sidebarVisible, isMobile]);

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
          {t('imageViewer.removedFromAlbum', { count })} {' '}
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
    if (!onNavigate || !filteredImages || filteredImages.length === 0) return;
    if (direction === 'prev') {
      if (effectiveIndex === 0 && filteredImages.length > 1) {
        // Wrap from first to last
        onNavigate('jump', filteredImages.length - 1);
      } else if (effectiveIndex > 0) {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (effectiveIndex === filteredImages.length - 1 && filteredImages.length > 1) {
        // Wrap from last to first
        onNavigate('jump', 0);
      } else if (effectiveIndex < filteredImages.length - 1) {
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

  // Generate alt text for the main image
  const imageAltText = useMemo(() => {
    if (!entity || !parent) {
      return storeImageInfo?.label || imageId || 'Photo';
    }
    
    // Get context type and label
    let contextType = '';
    let contextLabel = '';
    
    const store = useDataStore.getState();
    const entities = store.entities?.[eventId] || {};
    
    if (entity === 'group') {
      contextType = 'Person';
      contextLabel = entities.groups?.[parent]?.label || '';
    } else if (entity === 'moment') {
      contextType = 'Moment';
      contextLabel = entities.moments?.[parent]?.label || '';
    } else if (entity === 'album') {
      contextType = 'Album';
      contextLabel = entities.albums?.[parent]?.label || '';
    } else if (entity === 'upload') {
      contextType = 'Upload';
      contextLabel = entities.uploads?.[parent]?.profile_label || parent;
    }
    
    const photoNumber = effectiveIndex + 1;
    const contextPart = contextLabel ? `${contextType} ${contextLabel}` : contextType;
    const baseText = `Display size of Photo #${photoNumber} in ${contextPart}`;
    const description = storeImageInfo?.description?.trim();
    
    return description ? `${baseText}: ${description}` : baseText;
  }, [entity, parent, effectiveIndex, storeImageInfo?.description, eventId, imageId]);

  // Update description value when image changes
  useEffect(() => {
    if (storeImageInfo) {
      setDescriptionValue(storeImageInfo.description || '');
      setIsEditingDescription(false);
    }
  }, [storeImageInfo?.description, imageId]);
  
  // Update sidebar visibility when mobile state changes
  useEffect(() => {
    if (isMobile && sidebarVisible) {
      // Auto-hide sidebar when switching to mobile to save space
      setSidebarVisible(false);
    }
  }, [isMobile]);

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
    const newPercent = Math.min(1000, Math.min(add25, next25));
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
        const next = Math.max(0.5, Math.min(10, prev + delta));
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

  const handleDescriptionClick = () => {
    if (permissions.canEdit && !isEditingDescription) {
      setIsEditingDescription(true);
    }
  };

  const handleDescriptionSave = async () => {
    if (!imageId || !permissions.canEdit || isSavingDescription) return;
    
    try {
      setIsSavingDescription(true);
      const currentDescription = storeImageInfo?.description || '';
      const newDescription = descriptionValue.trim();
      
      // Only save if changed
      if (newDescription !== currentDescription) {
        await imagesAPI.update(imageId, { description: newDescription }, eventUrl);
        // Changes are automatically applied by apiService interceptor
        showToast(t('imageViewer.descriptionUpdated', { defaultValue: 'Description updated' }), 'success');
      }
      
      setIsEditingDescription(false);
    } catch (error) {
      showToast(formatErrorMessage('update description', error), 'error');
      // Reset to original value on error
      setDescriptionValue(storeImageInfo?.description || '');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleDescriptionCancel = () => {
    setDescriptionValue(storeImageInfo?.description || '');
    setIsEditingDescription(false);
  };

  const handleDescriptionKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleDescriptionSave();
    } else if (e.key === 'Escape') {
      handleDescriptionCancel();
    }
  };



  // Touch gesture support for mobile: pinch-to-zoom, pan, and swipe navigation
  const touchStartRef = useRef(null);
  const touchStartTimeRef = useRef(null);
  const initialPinchDistanceRef = useRef(null);
  const initialZoomRef = useRef(null);
  const initialPanRef = useRef(null);
  const isPinchingRef = useRef(false);
  const isPanningRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const rafIdRef = useRef(null);
  // Velocity tracking for throw gesture
  const lastPinchDistanceRef = useRef(null);
  const lastPinchTimeRef = useRef(null);
  const pinchVelocityRef = useRef(0);
  // Double tap detection
  const lastTapTimeRef = useRef(0);
  const lastTapPositionRef = useRef({ x: 0, y: 0 });
  const doubleTapTimerRef = useRef(null);
  
  // Keep refs in sync with state
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  
  const handleTouchStart = (e) => {
    // Cancel any pending animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Pinch-to-zoom detection (two touches)
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      initialPinchDistanceRef.current = distance;
      initialZoomRef.current = zoomRef.current;
      initialPanRef.current = { ...panRef.current };
      isPinchingRef.current = true;
      isPanningRef.current = false;
      // Initialize velocity tracking
      lastPinchDistanceRef.current = distance;
      lastPinchTimeRef.current = Date.now();
      pinchVelocityRef.current = 0;
      e.preventDefault();
      return;
    }
    
    // Single touch for swipe gestures or panning when zoomed
    if (e.touches.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchStartTimeRef.current = Date.now();
      initialPanRef.current = { ...panRef.current };
      // Don't immediately set panning - wait to see if user moves (panning) or swipes quickly (navigation)
      isPanningRef.current = false;
      isPinchingRef.current = false;
      // Reset velocity tracking for single touch
      lastPinchDistanceRef.current = null;
      lastPinchTimeRef.current = null;
      pinchVelocityRef.current = 0;
    }
  };
  
  const handleTouchMove = (e) => {
    // Handle pinch-to-zoom
    if (e.touches.length === 2 && initialPinchDistanceRef.current !== null) {
      e.preventDefault();
      e.stopPropagation();
      
      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      
      // Use requestAnimationFrame for smooth updates
      rafIdRef.current = requestAnimationFrame(() => {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
        
        // Calculate velocity for throw gesture detection
        const now = Date.now();
        if (lastPinchDistanceRef.current !== null && lastPinchTimeRef.current !== null) {
          const timeDelta = Math.max(1, now - lastPinchTimeRef.current); // Avoid division by zero
          const distanceDelta = currentDistance - lastPinchDistanceRef.current;
          pinchVelocityRef.current = distanceDelta / timeDelta; // pixels per ms
        }
        lastPinchDistanceRef.current = currentDistance;
        lastPinchTimeRef.current = now;
      
      const scale = currentDistance / initialPinchDistanceRef.current;
        const newZoom = Math.max(0.5, Math.min(10, initialZoomRef.current * scale));
      
      // Center the pinch point
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
          const containerW = containerRect.width;
          const containerH = containerRect.height;
          const relativeX = centerX - containerRect.left - containerW / 2;
          const relativeY = centerY - containerRect.top - containerH / 2;
          
          // Calculate new pan position centered on pinch point
          const newPanX = initialPanRef.current.x + (relativeX * (newZoom - initialZoomRef.current)) / newZoom;
          const newPanY = initialPanRef.current.y + (relativeY * (newZoom - initialZoomRef.current)) / newZoom;
          
          // Apply boundaries
          const maxPanX = (containerW * (newZoom - 1)) / 2;
          const maxPanY = (containerH * (newZoom - 1)) / 2;
          
          setZoom(newZoom);
        setPan({
            x: Math.max(-maxPanX, Math.min(maxPanX, newPanX)),
            y: Math.max(-maxPanY, Math.min(maxPanY, newPanY))
        });
        } else {
          setZoom(newZoom);
      }
        rafIdRef.current = null;
      });
      return;
    }
    
    // Handle panning when zoomed in (single touch drag)
    // Detect panning intent: if zoomed in and user moves finger slowly, treat as panning
    // Fast movements are likely swipes, not panning
    if (e.touches.length === 1 && zoomRef.current > 1 && touchStartRef.current) {
      const currentTouch = e.touches[0];
      const deltaX = Math.abs(currentTouch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(currentTouch.clientY - touchStartRef.current.y);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const deltaTime = Date.now() - touchStartTimeRef.current;
      
      // Only treat as panning if movement is slow (deliberate pan) not fast (swipe)
      // Fast swipes have high velocity, slow pans have low velocity
      const velocity = distance / Math.max(deltaTime, 1); // pixels per ms
      const isSlowMovement = velocity < 0.5; // Slow movement threshold
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 2; // Mostly horizontal
      
      // If user has moved significantly and it's a slow movement (not a fast horizontal swipe), treat as panning
      if (distance > 10 && isSlowMovement && !isHorizontalSwipe) {
        isPanningRef.current = true;
      } else if (isHorizontalSwipe && velocity > 0.5) {
        // Fast horizontal movement - likely a swipe, not panning
        isPanningRef.current = false;
      }
    }
    
    if (e.touches.length === 1 && isPanningRef.current && zoomRef.current > 1) {
      e.preventDefault();
      e.stopPropagation();
      
      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      
      // Use requestAnimationFrame for smooth updates
      rafIdRef.current = requestAnimationFrame(() => {
        if (touchStartRef.current && containerRef.current) {
        const currentTouch = e.touches[0];
          const rawDeltaX = currentTouch.clientX - touchStartRef.current.x;
          const rawDeltaY = currentTouch.clientY - touchStartRef.current.y;
        
          // Make panning proportional to zoom level but smoother
          // Use square root to make it less aggressive - feels more natural
          const zoomFactor = Math.sqrt(zoomRef.current);
          const deltaX = rawDeltaX / zoomFactor;
          const deltaY = rawDeltaY / zoomFactor;
          
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerW = containerRect.width;
          const containerH = containerRect.height;
          
          // Calculate pan boundaries based on zoom level
          // When zoomed, the image is larger than container, so we can pan
          const maxPanX = (containerW * (zoomRef.current - 1)) / 2;
          const maxPanY = (containerH * (zoomRef.current - 1)) / 2;
          
          const newPanX = initialPanRef.current.x + deltaX;
          const newPanY = initialPanRef.current.y + deltaY;
          
          // Clamp pan values to boundaries
        setPan({
            x: Math.max(-maxPanX, Math.min(maxPanX, newPanX)),
            y: Math.max(-maxPanY, Math.min(maxPanY, newPanY))
        });
      }
        rafIdRef.current = null;
      });
      return;
    }
  };
  
  const handleTouchEnd = (e) => {
    // Cancel any pending animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Reset pinch state and check for throw gesture
    if (e.touches.length < 2) {
      // Check if this was a "throw" gesture (quick release with high velocity)
      const wasPinching = isPinchingRef.current;
      const currentVelocity = Math.abs(pinchVelocityRef.current);
      const throwThreshold = 0.5; // pixels per ms - adjust for sensitivity
      
      if (wasPinching && currentVelocity > throwThreshold) {
        // Animate back to default zoom (1.0) and reset pan
        handleReset();
      }
      
      initialPinchDistanceRef.current = null;
      initialZoomRef.current = null;
      isPinchingRef.current = false;
      lastPinchDistanceRef.current = null;
      lastPinchTimeRef.current = null;
      pinchVelocityRef.current = 0;
    }
    
    // Handle swipe and double tap gestures (only if not pinching)
    // Allow swipe even if panning was detected, as long as it's a fast horizontal movement
    if (!isPinchingRef.current && touchStartRef.current && e.changedTouches.length === 1) {
      const touchEnd = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      const deltaX = touchEnd.x - touchStartRef.current.x;
      const deltaY = touchEnd.y - touchStartRef.current.y;
      const deltaTime = Date.now() - touchStartTimeRef.current;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const velocity = distance / Math.max(deltaTime, 1);
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 2;
      const isFastHorizontalMovement = isHorizontalSwipe && velocity > 0.3;
      
      // Double tap detection: small movement (< 10px) and quick tap (< 300ms)
      const isTap = distance < 10 && deltaTime < 300;
      const currentTime = Date.now();
      const timeSinceLastTap = currentTime - lastTapTimeRef.current;
      const tapDistance = Math.sqrt(
        Math.pow(touchEnd.x - lastTapPositionRef.current.x, 2) +
        Math.pow(touchEnd.y - lastTapPositionRef.current.y, 2)
      );
      
      // Check for double tap first (only for small movements)
      if (isTap && timeSinceLastTap < 300 && tapDistance < 50) {
        // Clear any pending single tap timer
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        
        // Prevent navigation if user was interacting with controls or sidebar
        if (!e.target.closest('[data-face-rectangle]') && 
            !e.target.closest('button') && 
            !e.target.closest('input') &&
            !e.target.closest('.image-viewer-sidebar')) {
          
          // If already at zoom 1, zoom in to touch point; otherwise reset
          if (zoomRef.current <= 1.0) {
            // Zoom in to 2x centered on touch point
            const targetZoom = 2.0;
            const container = containerRef.current;
            if (container) {
              const containerRect = container.getBoundingClientRect();
              const containerW = containerRect.width;
              const containerH = containerRect.height;
              
              // Calculate touch position relative to container center
              const relativeX = touchEnd.x - containerRect.left - containerW / 2;
              const relativeY = touchEnd.y - containerRect.top - containerH / 2;
              
              // Calculate pan to center zoom on touch point
              // When zooming in, we need to offset by the relative position
              const newPanX = -relativeX * (targetZoom - 1) / targetZoom;
              const newPanY = -relativeY * (targetZoom - 1) / targetZoom;
              
              // Apply boundaries
              const maxPanX = (containerW * (targetZoom - 1)) / 2;
              const maxPanY = (containerH * (targetZoom - 1)) / 2;
              
              setZoom(targetZoom);
              setPan({
                x: Math.max(-maxPanX, Math.min(maxPanX, newPanX)),
                y: Math.max(-maxPanY, Math.min(maxPanY, newPanY))
              });
            } else {
              // Fallback: just zoom in without centering
              setZoom(targetZoom);
            }
          } else {
            // Already zoomed in - reset zoom
            handleReset();
          }
          
          // Reset tap tracking
          lastTapTimeRef.current = 0;
          lastTapPositionRef.current = { x: 0, y: 0 };
          touchStartRef.current = null;
          touchStartTimeRef.current = null;
          return;
        }
      } else if (isTap) {
        // First tap - store position and time, set timer for single tap
        lastTapTimeRef.current = currentTime;
        lastTapPositionRef.current = { x: touchEnd.x, y: touchEnd.y };
        
        // Clear any existing timer
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
        }
        
        // Set timer - if no second tap within 300ms, it was a single tap
        doubleTapTimerRef.current = setTimeout(() => {
          lastTapTimeRef.current = 0;
          lastTapPositionRef.current = { x: 0, y: 0 };
          doubleTapTimerRef.current = null;
        }, 300);
        // Don't return - allow swipe detection to run if it's not a tap
      }
      
      // Swipe detection: horizontal swipe > 50px, < 300ms, and mostly horizontal (ratio > 2:1)
      // If zoomed in, require faster/more deliberate swipe to avoid accidental navigation while panning
      const minDistance = zoomRef.current > 1 ? 80 : 50; // Higher threshold when zoomed
      const maxTime = zoomRef.current > 1 ? 250 : 300; // Faster swipe when zoomed
      
      // Check for swipe if it's not a tap and is a fast horizontal movement
      // Allow swipe even if panning was detected, as long as it's fast and horizontal
      // This ensures swipes work reliably even when zoomed in
      if (!isTap && distance > minDistance && deltaTime < maxTime && isFastHorizontalMovement) {
        // Prevent navigation if user was interacting with controls or sidebar
        if (e.target.closest('[data-face-rectangle]') || 
            e.target.closest('button') || 
            e.target.closest('input') ||
            e.target.closest('.image-viewer-sidebar')) {
          touchStartRef.current = null;
          touchStartTimeRef.current = null;
          isPanningRef.current = false;
          return;
        }
        
        // Navigate without resetting zoom - zoom level will be preserved
        // Reset panning flag since this was a swipe, not panning
        isPanningRef.current = false;
        
        // Use simple prev/next navigation (was working before)
        if (deltaX > 0) {
          // Swipe right = previous (LTR) or next (RTL)
          handleNavigate(isRTL ? 'next' : 'prev');
        } else {
          // Swipe left = next (LTR) or previous (RTL)
          handleNavigate(isRTL ? 'prev' : 'next');
        }
      }
    }
    
    touchStartRef.current = null;
    touchStartTimeRef.current = null;
    initialPanRef.current = null;
    isPanningRef.current = false;
  };
  
  // Mouse wheel handler for zoom
  const handleMouseDown = (e) => {
    // Prevent dragging when clicking on face rectangles
    if (e.target.closest('[data-face-rectangle]')) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    initialMousePanRef.current = { ...pan };
  };

  const handleMouseMove = (e) => {
    // Show overlay controls on any mouse movement (desktop only)
    if (!isMobile) {
      try {
        if (!controlsVisible) setControlsVisible(true);
        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
      } catch {}
    }
    if (isDragging && zoom > 1 && containerRef.current) {
      setPan(prev => {
        const rawDeltaX = e.clientX - dragStart.x;
        const rawDeltaY = e.clientY - dragStart.y;
        // Make panning proportional to zoom level but smoother
        // Use square root to make it less aggressive - feels more natural
        const zoomFactor = Math.sqrt(zoom);
        const deltaX = rawDeltaX / zoomFactor;
        const deltaY = rawDeltaY / zoomFactor;
        
        const containerRect = containerRef.current.getBoundingClientRect();
        const containerW = containerRect.width;
        const containerH = containerRect.height;
        
        // Calculate pan boundaries based on zoom level
        const maxPanX = (containerW * (zoom - 1)) / 2;
        const maxPanY = (containerH * (zoom - 1)) / 2;
        
        const next = { 
          x: Math.max(-maxPanX, Math.min(maxPanX, initialMousePanRef.current.x + deltaX)), 
          y: Math.max(-maxPanY, Math.min(maxPanY, initialMousePanRef.current.y + deltaY))
        };
        return (next.x === prev.x && next.y === prev.y) ? prev : next;
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };



  // Face rectangle calculation accounting for object-contain and portrait/landscape
  // This works the same on mobile and desktop because it uses actual rendered dimensions
  const getFaceRectangleStyle = (face) => {
    if (imageRef.current && imageLoaded) {
      const img = imageRef.current;
      // Get the actual rendered container (the div with relative positioning)
      const container = img.parentElement; // relative positioning context
      if (!container) {
        // Fallback if container not found
        return {
          left: `${face.face_left * 100}%`,
          top: `${face.face_top * 100}%`,
          width: `${face.face_width * 100}%`,
          height: `${face.face_height * 100}%`,
        };
      }
      
      const containerRect = container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;
      const naturalW = img.naturalWidth || (storeImageInfo?.width || 1);
      const naturalH = img.naturalHeight || (storeImageInfo?.height || 1);

      // object-contain sizing math (independent of transforms and screen size)
      // This ensures face rectangles match exactly on mobile and desktop
      const scale = Math.min(containerW / naturalW, containerH / naturalH);
      const displayedW = naturalW * scale;
      const displayedH = naturalH * scale;
      const offsetXpx = (containerW - displayedW) / 2; // letterbox left
      const offsetYpx = (containerH - displayedH) / 2; // letterbox top

      // Faces may be normalized (0..1) or absolute in original pixels. Detect heuristically.
      const isNormalized = face.face_left <= 1 && face.face_top <= 1 && face.face_width <= 1 && face.face_height <= 1;
      const toPx = (value, axis) => {
        if (isNormalized) {
          return value * (axis === 'x' ? displayedW : displayedH);
        }
        const base = axis === 'x' ? (storeImageInfo?.width || naturalW) : (storeImageInfo?.height || naturalH);
        return (value / base) * (axis === 'x' ? displayedW : displayedH);
      };

      const leftPx = offsetXpx + toPx(face.face_left, 'x');
      const topPx = offsetYpx + toPx(face.face_top, 'y');
      const widthPx = toPx(face.face_width, 'x');
      const heightPx = toPx(face.face_height, 'y');
      
      // Return as percentages relative to container for consistent positioning
      return {
        left: `${(leftPx / containerW) * 100}%`,
        top: `${(topPx / containerH) * 100}%`,
        width: `${(widthPx / containerW) * 100}%`,
        height: `${(heightPx / containerH) * 100}%`,
      };
    }

    // Fallback when not loaded: assume normalized coords
    return {
      left: `${face.face_left * 100}%`,
      top: `${face.face_top * 100}%`,
      width: `${face.face_width * 100}%`,
      height: `${face.face_height * 100}%`,
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
    // Initial auto-hide schedule for controls (desktop only)
    if (!isMobile) {
      try {
        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
      } catch {}
    } else {
      // Keep controls visible on mobile
      setControlsVisible(true);
    }
    return () => {
      try { if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current); } catch {}
    };
  }, [isMobile]);

  // Cleanup animation frame and timers on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
    };
  }, []);

  // Prevent background scrolling/zooming when touching anywhere in the modal
  const handleOverlayTouchStart = useCallback((e) => {
    // Only prevent if touching the overlay itself, not the modal content
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleOverlayTouchMove = useCallback((e) => {
    // Prevent background scrolling when touching overlay
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleOverlayTouchEnd = useCallback((e) => {
    // Prevent any default behavior on overlay
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Attach touch event listeners directly for better control (passive: false)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Attach listeners with passive: false to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []); // Empty deps - handlers use refs

  // Prevent background scrolling/zooming when modal is open
  useEffect(() => {
    // Track touches that started within the modal
    const touchesInModal = new Set();

    const handleDocumentTouchStart = (e) => {
      const modal = modalRef.current;
      if (modal) {
        // Check if any touch point is within the modal
        Array.from(e.touches).forEach((touch, index) => {
          const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);
          if (elementAtPoint && modal.contains(elementAtPoint)) {
            touchesInModal.add(touch.identifier);
            // Prevent default to stop background scrolling/zooming
            e.preventDefault();
          }
        });
      }
    };

    const handleDocumentTouchMove = (e) => {
      // Prevent background scrolling if any touch started in modal
      let hasModalTouch = false;
      Array.from(e.touches).forEach((touch) => {
        if (touchesInModal.has(touch.identifier)) {
          hasModalTouch = true;
        }
      });

      if (hasModalTouch) {
        // Our gesture handlers already call preventDefault for their gestures
        // This prevents any unhandled touchmove from scrolling background
        e.preventDefault();
      }
    };

    const handleDocumentTouchEnd = (e) => {
      // Remove ended touches from tracking
      Array.from(e.changedTouches).forEach((touch) => {
        touchesInModal.delete(touch.identifier);
      });
    };

    // Use capture phase to catch events early
    document.addEventListener('touchstart', handleDocumentTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', handleDocumentTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleDocumentTouchEnd, { passive: false, capture: true });
    document.addEventListener('touchcancel', handleDocumentTouchEnd, { passive: false, capture: true });

    return () => {
      document.removeEventListener('touchstart', handleDocumentTouchStart, { capture: true });
      document.removeEventListener('touchmove', handleDocumentTouchMove, { capture: true });
      document.removeEventListener('touchend', handleDocumentTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', handleDocumentTouchEnd, { capture: true });
      touchesInModal.clear();
    };
  }, []);

  return (
    <AnimatePresence>
      <div 
        key="image-viewer-modal" 
        className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 modal-overlay ${
          zoom !== 1 ? 'overflow-visible' : 'overflow-hidden'
        }`}
      >
        <motion.div
          ref={modalRef}
          className={`bg-transparent border-2 border-white/30 rounded-lg shadow-xl min-h-0 image-viewer-modal ${
            zoom !== 1 ? 'overflow-visible' : 'overflow-hidden'
          } ${isMobile ? 'mx-0 my-2 rounded-none' : 'mx-4 my-4 w-full'}`}
          style={isMobile ? {
            ...mobileModalStyle,
            width: mobileModalStyle.width || '100vw',
            maxWidth: mobileModalStyle.maxWidth || '100vw',
            maxHeight: mobileModalStyle.maxHeight || 'calc(100vh - 5rem)'
          } : { 
            maxHeight: 'calc(100vh - 3rem)',
            height: 'calc(min(100vw - 2rem, 1024px) * 0.67)',
            maxWidth: sidebarVisible ? '1344px' : '1024px'
          }}
          initial={{ opacity: 0, scale: isMobile ? 1 : 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: isMobile ? 1 : 0.95 }}
          tabIndex={-1}
        >

          {/* Content */}
          <div dir={isRTL ? 'rtl' : 'ltr'} className={`flex h-full min-h-0 ${
            zoom !== 1 ? 'overflow-visible' : 'overflow-hidden'
          }`}>
            {/* Image Viewer */}
            <div 
              ref={containerRef}
              className={`flex items-center justify-center bg-gray-900 relative ${
                zoom !== 1 ? 'overflow-visible' : 'overflow-hidden'
              } ${isMobile ? '' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ 
                width: zoom !== 1 ? '100vw' : (isMobile ? '100%' : 'calc(min(100vw - 2rem, 1024px))'),
                height: zoom !== 1 ? '100vh' : '100%',
                position: zoom !== 1 ? 'fixed' : 'relative',
                top: zoom !== 1 ? 0 : 'auto',
                left: zoom !== 1 ? 0 : 'auto',
                zIndex: zoom !== 1 ? 60 : 'auto',
                order: isRTL ? 2 : 2
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {loading ? (
                <div className="text-white">{t('imageViewer.loading')}</div>
              ) : (
                <motion.div
                  className="relative"
                  style={{
                    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                    width: '100%',
                    height: '100%',
                    transformOrigin: 'center center', // Ensure rotation happens from center
                    overflow: zoom !== 1 ? 'visible' : 'hidden'
                  }}
                >
                  <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: zoom !== 1 ? 'visible' : 'hidden' }}>
                    {mainImageSrc && !imageError ? (
                      <img
                        ref={imageRef}
                        src={mainImageSrc}
                        alt={imageAltText}
                        className="select-none object-contain max-w-full max-h-full"
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
                        className: "select-none object-contain w-full h-full",
                        alt: imageAltText
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
                          <div className={`absolute -top-6 ${isRTL ? 'right-0' : 'left-0'} ${labelBgColor} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                            {getGroupLabel(face)}
                          </div>
                          <PermissionGate requires="canEdit">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTransferFace(face);
                              }}
                              className={`absolute -bottom-4 ${isRTL ? '-right-1' : '-left-1'} ${bgColor} text-white p-0.5 rounded hover:bg-opacity-80 transition-colors`}
                              title={t('imageViewer.transferFaceToAnotherGroup')}
                              aria-label={t('imageViewer.transferFaceToAnotherGroup')}
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
                <div 
                  className={`absolute inset-0 z-30 transition-opacity duration-200 ${
                    isMobile ? 'opacity-100' : (controlsVisible ? 'opacity-100' : 'opacity-0')
                  } pointer-events-none`}
                  onMouseMove={() => {
                    if (!isMobile) {
                      try {
                        setControlsVisible(true);
                        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
                        hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
                      } catch {}
                    }
                  }}
                  onMouseLeave={() => {
                    if (!isMobile) {
                      try {
                        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
                      } catch {}
                      setControlsVisible(false);
                    }
                  }}
                  onTouchStart={() => {
                    // Show controls on touch (mobile)
                    if (isMobile) {
                      setControlsVisible(true);
                    }
                  }}
                >
                  {/* Close button - top-right in LTR, top-left in RTL */}
                  <button
                    onClick={onClose}
                    className={`absolute ${isMobile ? 'top-2' : 'top-4'} pointer-events-auto bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                      isMobile ? 'w-10 h-10' : 'w-8 h-8'
                    } flex items-center justify-center shadow ${endClass(isMobile ? '2' : '4')}`}
                    title={t('imageViewer.close')}
                    aria-label={t('imageViewer.close')}
                  >
                    <X className={isMobile ? 'w-6 h-6' : 'w-5 h-5'} />
                  </button>

                  {/* Favorites / Archive controls - bottom-right in LTR, bottom-left in RTL */}
                  <div className={`absolute ${isMobile ? 'bottom-3' : 'bottom-5'} pointer-events-auto flex items-center ${isMobile ? 'gap-3' : 'gap-4'} ${endClass(isMobile ? '2' : '4')}`}>
                    {(() => {
                      const favoriteTooltip = imageActions.isFavorite
                        ? (permissions.canEdit ? t('imageViewer.removeFromFavorites') : t('imageViewer.inFavorites'))
                        : (permissions.canEdit ? t('imageViewer.addToFavorites') : t('imageViewer.favorites'));
                      const archiveTooltip = imageActions.isArchived
                        ? (permissions.canEdit ? t('imageViewer.removeFromArchive') : t('imageViewer.inArchive'))
                        : (permissions.canEdit ? t('imageViewer.moveToArchive') : t('imageViewer.archive'));
                      
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
                              aria-label={favoriteTooltip}
                              aria-pressed={imageActions.isFavorite}
                              disabled={!permissions.canEdit}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={`${isMobile ? 'w-7 h-7' : 'w-6 h-6'} ${imageActions.isFavorite ? 'text-red-500' : 'text-white'}`}
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
                              aria-label={archiveTooltip}
                              aria-pressed={imageActions.isArchived}
                              disabled={!permissions.canEdit}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={`${isMobile ? 'w-7 h-7' : 'w-6 h-6'} ${imageActions.isArchived ? 'text-white' : 'text-gray-500'}`}
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
                    <div className={`absolute ${isMobile ? 'top-2' : 'top-4'} left-1/2 -translate-x-1/2 flex items-center ${isMobile ? 'gap-1.5' : 'gap-2'} pointer-events-auto`}>
                      <button
                        onClick={() => handleNavigate('prev')}
                        className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                          isMobile ? 'w-10 h-10' : 'w-8 h-8'
                        } flex items-center justify-center shadow`}
                        title={t('imageViewer.previous')}
                        aria-label={t('imageViewer.previous')}
                      >
                        {isRTL ? <ArrowRight className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} /> : <ArrowLeft className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />}
                      </button>
                      <div dir="ltr" className={`bg-white/80 text-gray-800 rounded-md ${isMobile ? 'px-1.5' : 'px-2'} ${isMobile ? 'h-10' : 'h-8'} shadow flex items-center ${isMobile ? 'text-sm' : ''}`}>
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
                            title={t('imageViewer.clickToEdit')}
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
                        className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                          isMobile ? 'w-10 h-10' : 'w-8 h-8'
                        } flex items-center justify-center shadow`}
                        title={t('imageViewer.next')}
                        aria-label={t('imageViewer.next')}
                      >
                        {isRTL ? <ArrowLeft className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} /> : <ArrowRight className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />}
                      </button>
                    </div>
                  )}

                  {/* Zoom - bottom-center */}
                  <div className={`absolute ${isMobile ? 'bottom-2' : 'bottom-4'} left-1/2 -translate-x-1/2 flex items-center ${isMobile ? 'gap-1' : 'gap-2'} pointer-events-auto ${isMobile ? 'scale-90' : ''}`}>
                    {isRTL ? (
                      <>
                        <button
                          onClick={handleReset}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.resetZoom')}
                          aria-label={t('imageViewer.resetZoom')}
                        >
                          <RotateCcw className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                        <button
                          onClick={handleZoomIn}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.zoomIn')}
                          aria-label={t('imageViewer.zoomIn')}
                        >
                          <Plus className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                        <div className={`bg-white/80 text-gray-800 rounded-md ${isMobile ? 'px-1.5' : 'px-2'} ${isMobile ? 'h-9' : 'h-8'} shadow flex items-center ${isMobile ? 'gap-0.5' : 'gap-1'}`}>
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
                              val = Math.max(50, Math.min(1000, val));
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
                            className={`${isMobile ? 'w-12' : 'w-10'} text-center bg-transparent focus:outline-none ${isMobile ? 'text-base' : ''}`}
                            style={{width: isMobile ? '3rem' : '2.5rem'}}
                          />
                        </div>
                        <button
                          onClick={handleZoomOut}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.zoomOut')}
                          aria-label={t('imageViewer.zoomOut')}
                        >
                          <Minus className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={handleZoomOut}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.zoomOut')}
                          aria-label={t('imageViewer.zoomOut')}
                        >
                          <Minus className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                        <div className={`bg-white/80 text-gray-800 rounded-md ${isMobile ? 'px-1.5' : 'px-2'} ${isMobile ? 'h-9' : 'h-8'} shadow flex items-center ${isMobile ? 'gap-0.5' : 'gap-1'}`}>
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
                              val = Math.max(50, Math.min(1000, val));
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
                            className={`${isMobile ? 'w-12' : 'w-10'} text-center bg-transparent focus:outline-none ${isMobile ? 'text-base' : ''}`}
                            style={{width: isMobile ? '3rem' : '2.5rem'}}
                          />
                        </div>
                        <button
                          onClick={handleZoomIn}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.zoomIn')}
                          aria-label={t('imageViewer.zoomIn')}
                        >
                          <Plus className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                        <button
                          onClick={handleReset}
                          className={`bg-white/80 hover:bg-white text-gray-800 rounded-md ${
                            isMobile ? 'w-9 h-9' : 'w-8 h-8'
                          } flex items-center justify-center shadow`}
                          title={t('imageViewer.resetZoom')}
                          aria-label={t('imageViewer.resetZoom')}
                        >
                          <RotateCcw className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
                        </button>
                      </>
                    )}
                  </div>


                  {/* Sidebar toggle - top-left in LTR (when sidebar on left), top-right in RTL (when sidebar on right) */}
                  <button
                    onClick={() => setSidebarVisible(v => !v)}
                    className={`absolute ${isMobile ? 'top-2' : 'top-4'} pointer-events-auto bg-white/90 hover:bg-white text-gray-800 rounded-md ${
                      isMobile ? 'w-10 h-10' : 'w-8 h-8'
                    } flex items-center justify-center shadow-lg z-40 ${startClass(isMobile ? '2' : '4')}`}
                    title={sidebarVisible ? t('imageViewer.hideSidebar') : t('imageViewer.showSidebar')}
                    aria-label={sidebarVisible ? t('imageViewer.hideSidebar') : t('imageViewer.showSidebar')}
                  >
                    {sidebarVisible ? (
                      // When visible, point in direction to close (left in RTL, right in LTR)
                      isRTL ? <ChevronLeft className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} /> : <ChevronRight className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
                    ) : (
                      // When hidden, point in direction to open (right in RTL, left in LTR)
                      isRTL ? <ChevronRight className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} /> : <ChevronLeft className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
                    )}
                  </button>
                </div>
              )}
              
            </div>

                    {/* Mobile sidebar backdrop */}
        {isMobile && sidebarVisible && (
          <div
            className="fixed inset-0 bg-black/50"
            style={{ zIndex: 35 }}
            onClick={() => setSidebarVisible(false)}
            aria-hidden="true"
          />
        )}
        
        {/* Sidebar */}
        {sidebarVisible && (
        <div className={`${isMobile ? 'w-full fixed inset-y-0 z-40' : 'w-80'} bg-white flex flex-col h-full min-h-0 image-viewer-sidebar ${
          isMobile ? '' : (isRTL ? 'border-l border-gray-200' : 'border-r border-gray-200')
        } ${isMobile ? (isRTL ? 'right-0' : 'left-0') : ''}`} style={{ order: isRTL ? 1 : 1 }}>
          {/* Controls */}
          <div className={`${isMobile ? 'p-2' : 'p-3'} border-b border-gray-200 image-viewer-controls flex-none relative`}>
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
                  isMobile={isMobile}
                />

                    {/* Details Section */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-1">{t('imageViewer.photoDetails')}</h4>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.name')}</span> {storeImageInfo?.label || imageMeta.label}</div>
                    <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.date')}</span> <span dir="ltr">{formatDateTime(storeImageInfo?.date_taken)}</span></div>
                    <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.originalSize')}</span> <span dir="ltr">{(() => {
                      const size = storeImageInfo?.file_size;
                      if (!size) return t('imageViewer.unknown');
                      if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                      if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
                      return (size / 1024).toFixed(1) + ' KB';
                    })()}</span></div>
                    <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.originalResolution')}</span> <span dir="ltr">{storeImageInfo?.width && storeImageInfo?.height ? `${storeImageInfo.width} x ${storeImageInfo.height}` : t('imageViewer.unknown')}</span></div>
                    <div className={`mt-2 transition-all duration-200 ${isEditingDescription ? 'p-2 bg-gray-50 rounded-lg border border-gray-200' : ''}`}>
                      <div className="flex items-start">
                        <span className={`font-semibold flex-shrink-0 ${me('2')}`}>{t('imageViewer.description')}</span>
                        {isEditingDescription && permissions.canEdit ? (
                          <div className="flex-1 min-w-0">
                            <textarea
                              value={descriptionValue}
                              onChange={(e) => setDescriptionValue(e.target.value)}
                              onBlur={handleDescriptionSave}
                              onKeyDown={handleDescriptionKeyDown}
                              className="w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none shadow-sm"
                              rows={4}
                              autoFocus
                              disabled={isSavingDescription}
                              style={{ minHeight: '4rem' }}
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <button
                                onClick={handleDescriptionCancel}
                                className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                                disabled={isSavingDescription}
                              >
                                {t('imageViewer.cancel')}
                              </button>
                              <button
                                onClick={handleDescriptionSave}
                                className="text-xs text-primary-600 hover:text-primary-800 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                                disabled={isSavingDescription}
                              >
                                {isSavingDescription ? t('imageViewer.saving') : t('imageViewer.save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={handleDescriptionClick}
                            className={`flex-1 min-w-0 text-gray-500 ${permissions.canEdit ? 'cursor-text hover:text-gray-700' : ''} transition-colors`}
                            title={permissions.canEdit ? t('imageViewer.clickToEditDescription') : ''}
                          >
                            {storeImageInfo?.description ? (
                              <span className="whitespace-pre-wrap break-words">{storeImageInfo.description}</span>
                            ) : (
                              <span className="text-gray-400 italic">{permissions.canEdit ? t('imageViewer.clickToAddDescription') : t('imageViewer.noDescription')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Moment Information */}
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500 flex-1 min-w-0">
                        <span className={`font-semibold ${me('2')}`}>{t('imageViewer.moment')}</span>
                        {momentInfo ? (
                          <a
                            href={`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`}
                            onClick={handleMomentLinkClick}
                            className={`${ms('1')} text-primary-600 hover:text-primary-700 hover:underline cursor-pointer`}
                            title={t('imageViewer.jumpToMoment')}
                          >
                            {momentInfo.label}
                          </a>
                        ) : (
                          <span className={ms('1')}>{t('imageViewer.none')}</span>
                        )}
                      </div>
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => setShowMoveToMomentModal(true)}
                          className={`w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center flex-shrink-0 ${ms('2')}`}
                          title={t('imageViewer.editMoment')}
                          aria-label={t('imageViewer.editMoment')}
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
                      <h3 className="font-semibold text-gray-900">{t('imageViewer.albums')} ({albumsList.length})</h3>
                      <button
                        onClick={() => setAlbumsOpen(v => !v)}
                        className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                        title={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
                        aria-label={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
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
                                <div className="flex items-center gap-3 flex-1 min-w-0">
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
                                    className="flex items-center gap-3 flex-1 min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                                      className={`${ms('3')} p-1.5 hover:bg-red-100 rounded-lg transition-colors`}
                                      title={t('imageViewer.removeFromAlbum', { album: album.label })}
                                      aria-label={t('imageViewer.removeFromAlbum', { album: album.label })}
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
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{t('imageViewer.faces')} ({facesList.length})</h3>
                        <button
                          onClick={() => {
                            if (showRectangles) {
                              setSelectedFaceIndex(null);
                            }
                            setShowRectangles(v => !v);
                          }}
                          className={`w-7 h-7 border border-transparent rounded-md transition-colors flex items-center justify-center ${showRectangles ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-700'}`}
                          title={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                          aria-label={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                        >
                          {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => setFacesOpen(v => !v)}
                        className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                        title={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
                        aria-label={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
                      >
                        {facesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                    {facesOpen && (
                      <div className="faces-list-container overflow-y-auto">
                        <div className="px-4">
                          {facesList.length === 0 ? (
                            <p className="text-gray-500 text-sm">{t('imageViewer.noFacesDetected')}</p>
                          ) : (
                            <div className="space-y-2">
                              {facesList.map((face, index) => (
                                <div
                                  key={`face-list-${(face.id || face.face_id || `index-${index}`)}-${(face.groupId || face.group_id || 'unknown')}-${index}-${imageId}`}
                                  className={`flex items-center gap-3 p-2 rounded-lg ${face.isPlaceholder ? '' : 'cursor-pointer'} transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
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
                                      title={t('imageViewer.goToPersonPage')}
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


