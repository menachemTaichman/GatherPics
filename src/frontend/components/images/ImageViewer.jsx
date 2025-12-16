import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, ShoppingBag, User, ArrowLeft, ArrowRight, Minus, Plus, Archive, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RotateCcw, Eye, EyeOff, Image as ImageIcon, Star, Edit2, Trash2, Key, Info } from 'lucide-react';
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
import PhotoSwipe from 'photoswipe';
import 'photoswipe/dist/photoswipe.css';
import { Drawer } from 'vaul';

const EMPTY_ARRAY = Object.freeze([]);

// ImageViewerActions component - inline component for ImageViewer drawer
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
  isMobile = false,
  portalContainer = null,
  onOpenManageAccess
}) {
  const { t } = useTranslation();
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
            <AlbumQuickAddButton {...imageActions.albumQuickAddProps} dropdownDirection="down" portalContainer={portalContainer} />
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
            onClick={() => onOpenManageAccess && onOpenManageAccess()}
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
  
  // Close modal when all images are deleted/removed/moved
  useEffect(() => {
    if (filteredImages.length === 0) {
      // Small delay to allow any animations or state updates to complete
      const timeoutId = setTimeout(() => {
        onClose();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [filteredImages.length, onClose]);
  
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
  
  // Refs to track values for use in callback defined earlier
  const anyChildModalOpenRef = useRef(false);
  const modalRefForKeys = useRef(null);
  
  // Stable modal id (must be defined before using useModalFocus)
  const imageViewerModalIdRef = useRef(null);
  if (!imageViewerModalIdRef.current) {
    imageViewerModalIdRef.current = `image-viewer-${Math.random().toString(36).slice(2)}`;
  }
  const imageViewerModalId = imageViewerModalIdRef.current;

  // Drawer state - must be defined before useModalFocus to prevent closing while drawer is open
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(drawerOpen);
  const drawerContentRef = useRef(null);
  const [drawerContentElement, setDrawerContentElement] = useState(null);
  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  // Modal state variables - must be defined before useMemo that uses them
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showMoveToMomentModal, setShowMoveToMomentModal] = useState(false);
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Wrapped close handler - only closes modal if drawer is not open
  // ESC key is handled separately in handleImageViewerKeys
  const handleModalClose = useCallback(() => {
    // Don't close modal if drawer is open - let ESC handler close drawer first
    if (drawerOpenRef.current) {
      return;
    }
    onClose();
  }, [onClose]);

  // Separate handler for PhotoSwipe close - always closes both drawer and modal
  const handlePhotoSwipeClose = useCallback(() => {
    // When PhotoSwipe closes, close drawer if open, then close modal
    if (drawerOpenRef.current) {
      setDrawerOpen(false);
    }
    onClose();
  }, [onClose]);

  // Subscribe to modal store to track other modals
  const modalStack = useModalStore(state => state.stack);
  const modalRegistry = useModalStore(state => state.registry);
  
  // Check if any child modal is open
  const anyChildModalOpen = useMemo(() => {
    // Check state variables for modals opened from ImageViewer
    const stateModalsOpen = showTransferModal || showMoveToMomentModal || showManageAccessModal || deleteModalOpen;
    
    // Check modal store for other registered modals (excluding ImageViewer itself)
    const otherModals = modalStack ? modalStack.filter(id => id !== imageViewerModalId) : [];
    const hasOtherModals = otherModals.length > 0;
    
    const result = stateModalsOpen || hasOtherModals;
    console.log('[ImageViewer] anyChildModalOpen calculated:', {
      showTransferModal,
      showMoveToMomentModal,
      showManageAccessModal,
      deleteModalOpen,
      stateModalsOpen,
      otherModals,
      hasOtherModals,
      result,
      modalStack,
      imageViewerModalId
    });
    return result;
  }, [showTransferModal, showMoveToMomentModal, showManageAccessModal, deleteModalOpen, imageViewerModalId, modalStack]);

  // Update ref when anyChildModalOpen changes
  useEffect(() => {
    console.log('[ImageViewer] Updating anyChildModalOpenRef:', anyChildModalOpen);
    anyChildModalOpenRef.current = anyChildModalOpen;
  }, [anyChildModalOpen]);

  // Custom keyboard handler for ImageViewer-specific shortcuts
  // Defined here so it can access anyChildModalOpen and modalRef
  const handleImageViewerKeys = useCallback((e) => {
    console.log('[ImageViewer] Key handler called:', {
      key: e.key,
      target: e.target,
      targetTag: e.target.tagName,
      anyChildModalOpen: anyChildModalOpenRef.current,
      modalRefForKeys: modalRefForKeys.current
    });
    
    const target = e.target;
    const imageViewerModal = modalRefForKeys.current;
    
    // First check: if target is NOT inside ImageViewer modal, it must be in a child modal
    if (imageViewerModal && !imageViewerModal.contains(target)) {
      console.log('[ImageViewer] Target is NOT in ImageViewer modal, must be in child modal', {
        targetTag: target.tagName,
        targetType: target.type,
        isInput: target.tagName === 'INPUT' || target.tagName === 'TEXTAREA',
        key: e.key
      });
      // Mark the event to prevent useModalFocus from calling stopPropagation
      e._allowPropagation = true;
      // For input/textarea elements, we definitely want to allow the event through
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        console.log('[ImageViewer] Target is input element in child modal - allowing event');
      }
      // Return false so useModalFocus doesn't treat it as handled, but we've marked it to allow propagation
      return false;
    }
    
    // Check if child modals are open and if the event target is inside a child modal
    if (anyChildModalOpenRef.current) {
      console.log('[ImageViewer] Child modal is open, checking target');
      // Check if target is inside a modal that's not ImageViewer by checking z-index or parent structure
      // Child modals typically have higher z-index (100010) than ImageViewer
      const targetZIndex = window.getComputedStyle(target).zIndex;
      const parentWithHighZ = target.closest('[style*="z-index"]');
      if (parentWithHighZ) {
        const parentZIndex = window.getComputedStyle(parentWithHighZ).zIndex;
        console.log('[ImageViewer] Found parent with z-index:', parentZIndex, 'target z-index:', targetZIndex);
        // Child modals have z-index 100010
        if (parseInt(parentZIndex) >= 100010 && imageViewerModal && !imageViewerModal.contains(target)) {
          console.log('[ImageViewer] Target is in child modal (high z-index), returning true to prevent stopPropagation');
          return true;
        }
      }
    }
    
    // Always allow normal input behavior for input, textarea, and select elements INSIDE ImageViewer
    const targetTagName = e.target.tagName?.toLowerCase();
    console.log('[ImageViewer] Target tag name:', targetTagName);
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      console.log('[ImageViewer] Target is input element, returning true');
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it.
    }
      
    switch (e.key) {
      case 'Escape':
        // If child modals are open, let them handle ESC
        if (anyChildModalOpenRef.current) {
          return false;
        }
        // If drawer is open, close it only (don't close modal)
        if (drawerOpenRef.current) {
          setDrawerOpen(false);
          return true; // Mark as handled
        }
        // If drawer is closed, let useModalFocus handle closing the modal
        return false;
      case 'ArrowLeft':
        if (filteredImages.length > 1 && handleNavigateRef.current) {
          handleNavigateRef.current(isRTL ? 'next' : 'prev');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
      case 'ArrowRight':
        if (filteredImages.length > 1 && handleNavigateRef.current) {
          handleNavigateRef.current(isRTL ? 'prev' : 'next');
          return true; // Mark as handled (circular via handleNavigate)
        }
        break;
    }
    return false; // Not handled
  }, [filteredImages, isRTL]);

  // Use modal focus hook
  // Back button handling is automatically included, but only when imageId is set
  const enableFocusTrappingValue = !drawerOpen && !anyChildModalOpen;
  console.log('[ImageViewer] useModalFocus called with:', {
    drawerOpen,
    anyChildModalOpen,
    enableFocusTrapping: enableFocusTrappingValue
  });
  const { modalRef } = useModalFocus(true, handleModalClose, {
    customKeyHandler: handleImageViewerKeys,
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: imageViewerModalId,
    // Disable focus trapping when drawer is open or when child modals are open
    enableFocusTrapping: enableFocusTrappingValue,
    // Use custom state key for ImageViewer
    backButtonStateKey: 'imageViewerOpen',
    // Only enable back button when imageId is set (viewer is actually ready)
    enableBackButton: !!imageId
  });

  // Update modalRefForKeys when modalRef is available
  useEffect(() => {
    console.log('[ImageViewer] Updating modalRefForKeys:', modalRef.current);
    modalRefForKeys.current = modalRef.current;
  }, [modalRef]);
  const [imageInfo, setImageInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const pswpRef = useRef(null);
  const pswpInstanceRef = useRef(null);
  const skipPswpCloseRef = useRef(false);
  // Use universal placeholder components instead of hardcoded data URI
  const [showRectangles, setShowRectangles] = useState(false);
  const showRectanglesRef = useRef(showRectangles);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState(null);
  const selectedFaceIndexRef = useRef(selectedFaceIndex);
  const facesListRef = useRef(EMPTY_ARRAY);
  const handleFaceClickRef = useRef(null);
  const handleTransferFaceRef = useRef(null);
  const [selectedFaceForTransfer, setSelectedFaceForTransfer] = useState(null);
  const [transferImageId, setTransferImageId] = useState(null); // Store image ID before transfer
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(() => getPreference('ImageViewer.albumsOpen', false));
  const [facesOpen, setFacesOpen] = useState(() => getPreference('ImageViewer.facesOpen', false));
  const [albumsHeight, setAlbumsHeight] = useState(() => getPreference('ImageViewer.albumsHeight', 200));
  
  // Drawer swipe logic
  const drawerTouchStartRef = useRef({ x: 0, y: 0 });
  const handleDrawerTouchStart = (e) => {
    drawerTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  // Toggle helpers for collapsible sections
  const handleToggleAlbumsOpen = useCallback(() => setAlbumsOpen(v => !v), []);
  const handleToggleFacesOpen = useCallback(() => setFacesOpen(v => !v), []);

  const handleDrawerTouchEnd = (e) => {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = drawerTouchStartRef.current.x - endX;
    const diffY = drawerTouchStartRef.current.y - endY;

    // Check if horizontal swipe dominant (horizontal diff > vertical diff)
    // and exceeds threshold (50px)
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
      if (diffX > 0) {
        // Swipe Left -> Next (content moves left, reveals right/next)
        handleNavigate(isRTL ? 'prev' : 'next');
      } else {
        // Swipe Right -> Prev
        handleNavigate(isRTL ? 'next' : 'prev');
      }
    }
  };

  // Detect mobile
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
  
  const isMobileRef = useRef(isMobile);
  
  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
  
    // Manage drawer-open class for styling
    const shouldBeOpen = !isMobile && drawerOpen;
    if (shouldBeOpen) {
        document.body.classList.add('drawer-open');
    } else {
        document.body.classList.remove('drawer-open');
    }
    
    return () => {
       document.body.classList.remove('drawer-open');
    };
  }, [drawerOpen, isMobile]);

  // Track initial values to avoid persisting unchanged preferences
  const initialValuesRef = useRef({
    albumsOpen: getPreference('ImageViewer.albumsOpen', false),
    facesOpen: getPreference('ImageViewer.facesOpen', false),
    albumsHeight: getPreference('ImageViewer.albumsHeight', 200)
  });

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

  // Update deleteModalOpen when imageActions.showDeleteConfirmModal changes
  useEffect(() => {
    setDeleteModalOpen(imageActions?.showDeleteConfirmModal || false);
  }, [imageActions?.showDeleteConfirmModal]);

  const [drawerDirection, setDrawerDirection] = useState('none');
  const [drawerContentKey, setDrawerContentKey] = useState(imageId);

  // Update content key and direction when imageId changes
  useEffect(() => {
    if (imageId !== drawerContentKey) {
       // Determine direction
       if (drawerContentKey) {
         // Simple heuristic: if we are moving forward in index, slide left (content moves left)
         // But we only have IDs here. The handleNavigate function knows the direction.
         // We can use a ref to store the last direction from handleNavigate
       }
       setDrawerContentKey(imageId);
    }
  }, [imageId]);

  // Use a ref to track navigation direction for animation
  const lastNavDirectionRef = useRef('next');
  const handleNavigateRef = useRef(null);

  // Circular navigation
  const handleNavigate = (direction, index) => {
    if (!onNavigate || !filteredImages || filteredImages.length === 0) return;
    
    let targetDirection = 'next';
    
    if (direction === 'prev') {
      targetDirection = 'prev';
      if (effectiveIndex === 0 && filteredImages.length > 1) {
        // Wrap from first to last
        onNavigate('jump', filteredImages.length - 1);
      } else if (effectiveIndex > 0) {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      targetDirection = 'next';
      if (effectiveIndex === filteredImages.length - 1 && filteredImages.length > 1) {
        // Wrap from last to first
        onNavigate('jump', 0);
      } else if (effectiveIndex < filteredImages.length - 1) {
        onNavigate('next');
      }
    } else if (direction === 'jump' && typeof index === 'number') {
      const clamped = Math.min(Math.max(0, index), Math.max(0, filteredImages.length - 1));
      // Determine direction based on index diff
      targetDirection = clamped > effectiveIndex ? 'next' : 'prev';
      onNavigate('jump', clamped);
    }
    
    lastNavDirectionRef.current = targetDirection;
    setDrawerDirection(targetDirection);
  };
  
  // Update ref when handleNavigate is defined
  useEffect(() => {
    handleNavigateRef.current = handleNavigate;
  }, [handleNavigate]);


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
  
  // Sync refs with state for PhotoSwipe event handlers
  useEffect(() => {
    showRectanglesRef.current = showRectangles;
  }, [showRectangles]);
  
  useEffect(() => {
    selectedFaceIndexRef.current = selectedFaceIndex;
  }, [selectedFaceIndex]);
  
  useEffect(() => {
    facesListRef.current = facesList;
  }, [facesList]);
  
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
    return foundIndex >= 0 ? foundIndex : Math.min(currentIndex, filteredImages.length - 1);
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
  

  // Fetch image info when image changes
  useEffect(() => {
    if (!imageId) return;
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
        } else {
          setImageInfo(null);
        }
      } else {
        setImageInfo(null);
      }
    } catch (error) {
      console.error('Error fetching image info:', error);
    } finally {
      setLoading(prev => (prev === false ? prev : false));
    }
  };


  // Build PhotoSwipe items with progressive loading (thumbnail -> display)
  const pswpItems = useMemo(() => {
    if (!filteredImages || !urlHelpers || !eventId) return [];
    
    const items = filteredImages.map((img) => {
      const imgId = img.id;
      const thumbnailUrl = urlHelpers.getThumbnailUrl ? urlHelpers.getThumbnailUrl(imgId) : null;
      const displayUrl = urlHelpers.getDisplayImageUrl ? urlHelpers.getDisplayImageUrl(imgId) : null;
      
      // Use display as main source, thumbnail for progressive loading
      const src = displayUrl || thumbnailUrl;
      const msrc = thumbnailUrl; // Medium source (thumbnail) for progressive loading
      
      return {
        src: src || '',
        msrc: msrc || src || '', // Thumbnail for immediate display
        w: img.width || storeImageInfo?.width || 2000,
        h: img.height || storeImageInfo?.height || 1500,
        alt: img.label || imageAltText,
      };
    });
    
    // Reverse items for RTL so swipe gestures match visual direction
    // PhotoSwipe always treats swipe-left as "next", but in RTL swipe-left should go to "previous"
    return isRTL ? [...items].reverse() : items;
  }, [filteredImages, urlHelpers, eventId, storeImageInfo, imageAltText, isRTL]);
  
  // Helper to convert between normal index and RTL-reversed index
  const toRTLIndex = useCallback((index) => {
    if (!isRTL || pswpItems.length === 0) return index;
    return pswpItems.length - 1 - index;
  }, [isRTL, pswpItems.length]);
  
  const fromRTLIndex = useCallback((rtlIndex) => {
    if (!isRTL || pswpItems.length === 0) return rtlIndex;
    return pswpItems.length - 1 - rtlIndex;
  }, [isRTL, pswpItems.length]);

  // Initialize PhotoSwipe when image changes
  useEffect(() => {
    if (!pswpRef.current || !imageId || pswpItems.length === 0) return;
    
    // Ensure we handle PhotoSwipe-triggered close events only when initiated by the UI
    skipPswpCloseRef.current = false;
    
    const currentIndex = effectiveIndex;
    if (currentIndex < 0 || currentIndex >= pswpItems.length) return;

    // Destroy existing instance
    if (pswpInstanceRef.current) {
      // Clean up RTL counter observer if it exists
      if (pswpInstanceRef.current._rtlCounterObserver) {
        pswpInstanceRef.current._rtlCounterObserver.disconnect();
      }
      pswpInstanceRef.current.destroy();
      pswpInstanceRef.current = null;
    }

    // For RTL, we use reversed array and reversed index
    const pswpIndex = toRTLIndex(currentIndex);

    const options = {
      dataSource: pswpItems,
      index: pswpIndex,
      mainClass: isRTL ? 'pswp-rtl' : '',
      showHideAnimationType: 'none',
      zoomAnimationDuration: 200,
      allowPanToNext: true,
      spacing: 0,
      loop: true,
      pinchToClose: true,
      closeOnVerticalDrag: false,
      escKey: false, // We handle close ourselves
      arrowKeys: false, // We handle navigation ourselves
      returnFocus: false,
      trapFocus: false, // CRITICAL: Disable PhotoSwipe focus trap to prevent conflict with Vaul
      clickToCloseNonZoomable: false,
      imageClickAction: 'zoom',
      bgClickAction: 'zoom', // Changed from 'close' to prevent PhotoSwipe from closing on background click
      tapAction: 'toggle-controls',
      doubleTapAction: 'zoom',
      maxSpreadZoom: 4,
      bgOpacity: 0.9, // Darken the background (0 = transparent, 1 = fully opaque black)
      getDoubleTapZoom: (isMouseClick, item) => {
        return item.initialZoomLevel < 2 ? 2 : 1;
      },
    };

    const pswp = new PhotoSwipe(options);

    // Initialize Vaul Swipe Up Logic
    let startY = 0;
    
    pswp.on('pointerDown', (e) => {
      if (isMobileRef.current && e.originalEvent) {
        startY = e.originalEvent.clientY;
      }
    });

    pswp.on('pointerUp', (e) => {
      if (!isMobileRef.current || !e.originalEvent) return;
      
      // 1. Check if zoomed in (if so, return and do nothing)
      if (pswp.currSlide && pswp.currSlide.pan.x !== pswp.currSlide.bounds.center.x) return;

      const endY = e.originalEvent.clientY;
      const diff = startY - endY; // Positive = Swipe Up

      // 2. Threshold check (50px)
      if (diff > 50) {
        setDrawerOpen(true);
      } else if (diff < -50) {
        // Swipe Down -> Close Viewer
        // Trigger exit animation by unmounting via onClose (which unmounts ImageViewer)
        // Note: The AnimatePresence in parent will handle the exit animation
        // We can add a custom class or state if we want to change the exit animation style specifically for swipe
        onClose();
      }
    });

    // Handle close event from PhotoSwipe
    pswp.on('close', () => {
      // Close the ImageViewer when PhotoSwipe's own close button is used
      // Use handlePhotoSwipeClose to ensure both drawer and modal close
      if (!skipPswpCloseRef.current) {
        handlePhotoSwipeClose();
      }
    });

    // Handle navigation
    pswp.on('change', () => {
      const pswpNewIndex = pswp.currIndex;
      // Convert from RTL-reversed index back to original index
      const newIndex = fromRTLIndex(pswpNewIndex);
      if (newIndex !== effectiveIndex && onNavigate) {
        onNavigate('jump', newIndex);
      }
      
    });

    // Store trigger function for face rectangle updates
    // The main useEffect will handle actual injection when state changes
    pswp._triggerFaceUpdate = () => {
      // This will be handled by the useEffect that watches showRectangles, facesList, etc.
    };

    // Initialize PhotoSwipe
    pswp.init();

    // CRITICAL: Aggressively remove PhotoSwipe's focus listener to prevent stack overflow with Vaul
    // Even with trapFocus: false, PhotoSwipe might still attach listeners in some versions
    if (pswp.keyboard) {
      const keyboard = pswp.keyboard;
      if (keyboard._onFocusIn) {
        document.removeEventListener('focusin', keyboard._onFocusIn);
      }
      pswp.keyboard = null;
    }
    if (isRTL) {
      const updateCounter = () => {
        const counterEl = pswp.element?.querySelector('.pswp__counter');
        if (counterEl) {
          const displayIndex = fromRTLIndex(pswp.currIndex) + 1;
          counterEl.textContent = `${displayIndex} / ${pswpItems.length}`;
          counterEl.style.direction = 'ltr';
        }
      };
      
      // Update counter after init and on every change
      updateCounter();
      // Also update after a brief delay in case PhotoSwipe updates it after init
      setTimeout(updateCounter, 0);
      setTimeout(updateCounter, 50);
      
      // Watch for PhotoSwipe's internal counter updates and fix them
      const counterEl = pswp.element?.querySelector('.pswp__counter');
      if (counterEl) {
        const observer = new MutationObserver(() => {
          const displayIndex = fromRTLIndex(pswp.currIndex) + 1;
          const expected = `${displayIndex} / ${pswpItems.length}`;
          if (counterEl.textContent !== expected) {
            counterEl.textContent = expected;
          }
        });
        observer.observe(counterEl, { childList: true, characterData: true, subtree: true });
        
        // Store observer for cleanup
        pswp._rtlCounterObserver = observer;
      }
    }
    
    // Inject RTL styles

    // Add custom buttons directly to PhotoSwipe root after initialization
    // This ensures proper positioning relative to PhotoSwipe viewport
    const pswpRoot = pswp.element;
    if (pswpRoot) {
      // Set direction for RTL support
      pswpRoot.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
      // Info button - positioned in toolbar between close and zoom buttons
      const infoBtn = document.createElement('div');
      infoBtn.className = 'pswp__custom-button pswp__custom-button--info';
      infoBtn.style.cssText = `
        position: absolute;
        top: 20px;
        ${isRTL ? 'right: auto; left: 57px;' : 'left: auto; right: 59px;'}
        z-index: 100002;
        width: 21px;
        height: 21px;
        pointer-events: auto;
      `;
      
      infoBtn.innerHTML = `
        <button 
          type="button"
          style="
            width: 100%;
            height: 100%;
            background: transparent;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            opacity: 0.75;
            transition: opacity 0.2s;
          "
          aria-label="${t('imageViewer.info') || 'Info'}"
          title="${t('imageViewer.info') || 'Info'}"
        >
          <svg 
            viewBox="0 0 24 24" 
            style="
              width: 24px; 
              height: 24px; 
              fill: none; 
              stroke: #fff; 
              stroke-width: 2;
              pointer-events: none;
            "
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <circle cx="12" cy="8" r="0.1" fill="#fff"></circle>
          </svg>
        </button>
      `;
      
      const button = infoBtn.querySelector('button');
      if (button) {
        button.onmouseenter = () => { button.style.opacity = '1'; };
        button.onmouseleave = () => { button.style.opacity = '0.75'; };
        button.onclick = (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
          // Toggle drawer on both mobile and desktop
          setDrawerOpen(v => !v);
        };
      }
      
      pswpRoot.appendChild(infoBtn);
      
      // Drawer toggle handle - positioned on the edge, moves with PhotoSwipe
      if (!isMobile) {
        const toggleHandle = document.createElement('div');
        toggleHandle.className = 'pswp__custom-button pswp__custom-button--drawer-toggle';
        toggleHandle.style.cssText = `
          position: absolute;
          top: 96px;
          ${isRTL ? 'right: 0;' : 'left: 0;'}
          z-index: 100002;
          width: 32px;
          height: 64px;
          pointer-events: auto;
          transition: ${isRTL ? 'right' : 'left'} 0.3s cubic-bezier(0.4,0,0.2,1);
        `;
        
        toggleHandle.innerHTML = `
          <button 
            type="button"
            style="
              width: 100%;
              height: 100%;
              background: white;
              border: none;
              ${isRTL ? 'border-left' : 'border-right'}: 1px solid #e5e7eb;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0;
              border-radius: ${isRTL ? '8px 0 0 8px' : '0 8px 8px 0'};
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              transition: background-color 0.2s;
            "
            aria-label="${t('imageViewer.photoDetails')}"
            title="${t('imageViewer.photoDetails')}"
          >
            <div style="
              width: 4px;
              height: 32px;
              background-color: #9ca3af;
              border-radius: 2px;
              transition: background-color 0.2s;
            "></div>
          </button>
        `;
        
        const toggleButton = toggleHandle.querySelector('button');
        if (toggleButton) {
          toggleButton.onmouseenter = () => { 
            toggleButton.style.backgroundColor = '#f9fafb';
            const indicator = toggleButton.querySelector('div');
            if (indicator) indicator.style.backgroundColor = '#4b5563';
          };
          toggleButton.onmouseleave = () => { 
            toggleButton.style.backgroundColor = 'white';
            const indicator = toggleButton.querySelector('div');
            if (indicator) indicator.style.backgroundColor = '#9ca3af';
          };
          toggleButton.onclick = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            setDrawerOpen(v => !v);
          };
        }
        
        pswpRoot.appendChild(toggleHandle);
        
        // Store reference to toggle handle (no position updates needed - it moves with PhotoSwipe)
        pswp._drawerToggleHandle = toggleHandle;
      }
      
      // Adjust PhotoSwipe zoom button position and size
      // Add CSS to move zoom button further from info button and increase size
      // Also add CSS to hide custom buttons when PhotoSwipe UI is hidden
      const styleId = 'pswp-zoom-button-spacing';
      const customButtonStyles = `
        .pswp .pswp__custom-button {
          transition: opacity 0.25s ease !important;
        }
        .pswp:not(.pswp--ui-visible) .pswp__custom-button {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          .pswp__button--zoom {
            ${isRTL ? 'left: 27px !important;' : 'right: 27px !important;'};
            width: 52px !important;
            height: 52px !important;
          }
          .pswp__button--zoom svg {
            width: 40px !important;
            height: 40px !important;
          }
          ${customButtonStyles}
        `;
        document.head.appendChild(style);
      } else {
        // Update existing style if RTL changes
        const existingStyle = document.getElementById(styleId);
        existingStyle.textContent = `
          .pswp__button--zoom {
            ${isRTL ? 'left: 29px !important;' : 'right: 29px !important;'};
            width: 52px !important;
            height: 52px !important;
          }
          .pswp__button--zoom svg {
            top: 11px !important;
            width: 40px !important;
            height: 40px !important;
          }
          ${customButtonStyles}
        `;
      }

      // Favorite button
      if (permissions.hasFavoritesAlbum && (permissions.canEdit || imageActions.isFavorite)) {
        const favoriteBtn = document.createElement('div');
        favoriteBtn.className = 'pswp__custom-button pswp__custom-button--favorite';
        favoriteBtn.style.cssText = `
          position: absolute;
          bottom: 20px;
          ${isRTL ? 'left: 20px; right: auto;' : 'right: 20px; left: auto;'}
          z-index: 100002;
          width: 44px;
          height: 44px;
          pointer-events: auto;
        `;
        
        const updateFavoriteButton = () => {
          const isFavorite = imageActions.isFavorite;
          const canEdit = permissions.canEdit;
          favoriteBtn.innerHTML = `
            <button 
              type="button"
              style="
                width: 100%;
                height: 100%;
                background: transparent;
                border: none;
                cursor: ${canEdit ? 'pointer' : 'default'};
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                opacity: ${canEdit ? '1' : '0.8'};
              "
              ${!canEdit ? 'disabled' : ''}
              aria-label="${isFavorite ? t('imageViewer.removeFromFavorites') : t('imageViewer.addToFavorites')}"
              title="${isFavorite ? t('imageViewer.removeFromFavorites') : t('imageViewer.addToFavorites')}"
            >
              <svg 
                viewBox="0 0 24 24" 
                style="
                  width: 24px; 
                  height: 24px; 
                  fill: ${isFavorite ? '#ef4444' : 'none'}; 
                  stroke: ${isFavorite ? '#ef4444' : '#fff'}; 
                  stroke-width: 2;
                  pointer-events: none;
                "
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </button>
          `;
          
          const button = favoriteBtn.querySelector('button');
          if (button && canEdit) {
            button.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              imageActions.toggleFavorite();
              setTimeout(() => updateFavoriteButton(), 100);
            };
          }
        };
        
        updateFavoriteButton();
        pswpRoot.appendChild(favoriteBtn);
        
        // Update button when image changes
        pswp.on('change', () => {
          updateFavoriteButton();
        });
      }
      
      // Archive button
      if (permissions.hasArchiveAlbum && (permissions.canEdit || imageActions.isArchived)) {
        const archiveBtn = document.createElement('div');
        archiveBtn.className = 'pswp__custom-button pswp__custom-button--archive';
        archiveBtn.style.cssText = `
          position: absolute;
          bottom: 20px;
          ${isRTL ? 'left: 72px; right: auto;' : 'right: 72px; left: auto;'}
          z-index: 100002;
          width: 44px;
          height: 44px;
          pointer-events: auto;
        `;
        
        const updateArchiveButton = () => {
          const isArchived = imageActions.isArchived;
          const canEdit = permissions.canEdit;
          archiveBtn.innerHTML = `
            <button 
              type="button"
              style="
                width: 100%;
                height: 100%;
                background: transparent;
                border: none;
                cursor: ${canEdit ? 'pointer' : 'default'};
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                opacity: ${canEdit ? '1' : '0.8'};
              "
              ${!canEdit ? 'disabled' : ''}
              aria-label="${isArchived ? t('imageViewer.removeFromArchive') : t('imageViewer.moveToArchive')}"
              title="${isArchived ? t('imageViewer.removeFromArchive') : t('imageViewer.moveToArchive')}"
            >
              <svg 
                viewBox="0 0 24 24" 
                style="
                  width: 24px; 
                  height: 24px; 
                  fill: none; 
                  stroke: ${isArchived ? '#fff' : '#6b7280'}; 
                  stroke-width: 2;
                  pointer-events: none;
                "
              >
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"></path>
              </svg>
            </button>
          `;
          
          const button = archiveBtn.querySelector('button');
          if (button && canEdit) {
            button.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              imageActions.toggleArchive();
              setTimeout(() => updateArchiveButton(), 100);
            };
          }
        };
        
        updateArchiveButton();
        pswpRoot.appendChild(archiveBtn);
        
        // Update button when image changes
        pswp.on('change', () => {
          updateArchiveButton();
        });
      }
    }
    
    // Disable keyboard handling after init to avoid conflicts with our modal focus system
    if (pswp.keyboard) {
      // Remove focus event listeners to prevent stack overflow
      const keyboard = pswp.keyboard;
      try {
        if (keyboard._onFocusIn) {
          document.removeEventListener('focusin', keyboard._onFocusIn);
        }
        if (keyboard._onFocusOut) {
          document.removeEventListener('focusout', keyboard._onFocusOut);
        }
        // Remove keyboard event listeners if they exist
        if (keyboard._onKeyDown) {
          document.removeEventListener('keydown', keyboard._onKeyDown);
        }
      } catch (e) {
        // Ignore errors if listeners don't exist or can't be removed
      }
      // Just null out the keyboard reference - don't try to destroy it
      pswp.keyboard = null;
    }
    
    pswpInstanceRef.current = pswp;

    const drawerStyleId = 'pswp-drawer-resize';
    const drawerWidth = '320px';
    
    if (!document.getElementById(drawerStyleId)) {
      const drawerStyle = document.createElement('style');
      drawerStyle.id = drawerStyleId;
      drawerStyle.textContent = `
      /* Ensure PhotoSwipe remains interactive when drawer is open */
      /* Drawer overlays PhotoSwipe without pushing it */
      body.drawer-open .pswp {
        pointer-events: auto !important;
      }
      
      body.drawer-open .pswp__zoom-wrap {
        pointer-events: auto !important;
      }
      
      /* Ensure toggle handle has smooth transition */
      .pswp__custom-button--drawer-toggle {
        transition: ${isRTL ? 'right' : 'left'} 0.3s cubic-bezier(0.4,0,0.2,1) !important;
      }
      
      /* Move toggle handle when drawer is open */
      body.drawer-open .pswp__custom-button--drawer-toggle {
        ${isRTL ? `right: ${drawerWidth} !important;` : `left: ${drawerWidth} !important;`}
      }
    `;
      document.head.appendChild(drawerStyle);
    } else {
      // Update existing style if RTL changes
      const existingStyle = document.getElementById(drawerStyleId);
      existingStyle.textContent = `
      /* Ensure PhotoSwipe remains interactive when drawer is open */
      /* Drawer overlays PhotoSwipe without pushing it */
      body.drawer-open .pswp {
        pointer-events: auto !important;
      }
      
      body.drawer-open .pswp__zoom-wrap {
        pointer-events: auto !important;
      }
      
      /* Ensure toggle handle has smooth transition */
      .pswp__custom-button--drawer-toggle {
        transition: ${isRTL ? 'right' : 'left'} 0.3s cubic-bezier(0.4,0,0.2,1) !important;
      }
      
      /* Move toggle handle when drawer is open */
      body.drawer-open .pswp__custom-button--drawer-toggle {
        ${isRTL ? `right: ${drawerWidth} !important;` : `left: ${drawerWidth} !important;`}
      }
    `;
    }
    return () => {
      if (pswpInstanceRef.current) {
        // Prevent triggering onClose when we're destroying PhotoSwipe during cleanup
        skipPswpCloseRef.current = true;
        // Clean up RTL counter observer if it exists
        if (pswpInstanceRef.current._rtlCounterObserver) {
          pswpInstanceRef.current._rtlCounterObserver.disconnect();
        }
        // Clean up drawer toggle handle reference
        if (pswpInstanceRef.current._drawerToggleHandle) {
          pswpInstanceRef.current._drawerToggleHandle = null;
        }
        pswpInstanceRef.current.destroy();
        pswpInstanceRef.current = null;
        skipPswpCloseRef.current = false;
      }
    };
  }, [imageId, effectiveIndex, pswpItems, onNavigate, isRTL, toRTLIndex, fromRTLIndex, handleModalClose]);

  // Sync PhotoSwipe when index changes externally
  useEffect(() => {
    if (pswpInstanceRef.current) {
      const pswpTargetIndex = toRTLIndex(effectiveIndex);
      if (pswpTargetIndex !== pswpInstanceRef.current.currIndex) {
        pswpInstanceRef.current.goTo(pswpTargetIndex);
      }
    }
  }, [effectiveIndex, toRTLIndex]);

  // Update face rectangles when visibility, faces, or selection changes
  // CSS-first approach: Uses pure CSS transforms and DOM hierarchy, no manual pixel math
  useEffect(() => {
    if (!pswpInstanceRef.current) {
      return;
    }
    
    const pswp = pswpInstanceRef.current;
    const currentSlide = pswp.currSlide;
    
    if (!currentSlide || !currentSlide.content) {
      return;
    }
    
    // Get current image info
    const originalIndex = fromRTLIndex(pswp.currIndex);
    const currentImageId = filteredImages[originalIndex]?.id;
    
    // Only show rectangles for the current image
    if (currentImageId !== imageId) {
      // Remove any existing overlay for wrong image
      const existingOverlay = currentSlide.content.element?.querySelector('.pswp-face-overlay');
      if (existingOverlay) {
        // Clean up ResizeObserver before removing
        if (existingOverlay._resizeObserver) {
          existingOverlay._resizeObserver.disconnect();
          delete existingOverlay._resizeObserver;
        }
        existingOverlay.remove();
      }
      return;
    }
    
    // Remove existing overlay (handle overlays appended to parent containers on mobile)
    const removeFaceOverlays = () => {
      const roots = [
        currentSlide.content?.element,
        currentSlide.holderElement,
        pswp.element
      ].filter(Boolean);

      const seen = new Set();
      roots.forEach(root => {
        root.querySelectorAll('.pswp-face-overlay').forEach(overlay => {
          if (seen.has(overlay)) return;
          seen.add(overlay);
          if (overlay._resizeObserver) {
            overlay._resizeObserver.disconnect();
            delete overlay._resizeObserver;
          }
          overlay.remove();
        });
      });
    };

    removeFaceOverlays();
    
    // Re-inject if showRectangles is true
    if (showRectangles && facesList.length > 0) {
      // Small delay to ensure PhotoSwipe has finished its layout
      const timeoutId = setTimeout(() => {
        if (!pswpInstanceRef.current) {
          return;
        }
        const slide = pswpInstanceRef.current.currSlide;
        if (!slide || !slide.content) {
          return;
        }
        
        // Double-check we're still on the same image
        const checkIndex = fromRTLIndex(pswpInstanceRef.current.currIndex);
        const checkImageId = filteredImages[checkIndex]?.id;
        if (checkImageId !== imageId) {
          return;
        }
        
        // Find content element - in PhotoSwipe v5, this might be the img itself
        const contentElement = slide.content.element;
        if (!contentElement) {
          return;
        }
        
        // Find the img element
        let img = contentElement;
        if (contentElement.tagName !== 'IMG') {
          img = contentElement.querySelector('img.pswp__img');
        }
        
        if (!img || img.tagName !== 'IMG') {
          return;
        }
        
        // Get image natural dimensions for aspect ratio
        const imgW = img.naturalWidth || storeImageInfo?.width || 2000;
        const imgH = img.naturalHeight || storeImageInfo?.height || 1500;
        
        // Find .pswp__zoom-wrap element (PhotoSwipe's zoom container)
        // This is the element that PhotoSwipe transforms for zoom/pan
        let zoomWrap = null;
        let current = img.parentElement;
        while (current && current !== pswp.element) {
          if (current.classList && current.classList.contains('pswp__zoom-wrap')) {
            zoomWrap = current;
            break;
          }
          current = current.parentElement;
        }
        
        // If no .pswp__zoom-wrap found, use img's parent container
        // Ensure it's positioned relatively for absolute children
        const container = zoomWrap || img.parentElement;
        
        if (!container || container.tagName === 'IMG') {
          return;
        }
        
        // Ensure container has proper positioning for absolute children
        const containerStyle = window.getComputedStyle(container);
        if (containerStyle.position === 'static' || !containerStyle.position || containerStyle.position === 'initial') {
          container.style.position = 'relative';
        }
        
        // Create overlay using geometry clone strategy
        // Measure the exact position and size of the rendered image and match it pixel-perfectly
        const overlay = document.createElement('div');
        overlay.className = 'pswp-face-overlay';
        
        // Helper function to update overlay position based on image geometry
        const updateOverlayPosition = () => {
          if (!img || !overlay) return;
          
          // Copy exact geometry from img to overlay
          overlay.style.left = `${img.offsetLeft}px`;
          overlay.style.top = `${img.offsetTop}px`;
          overlay.style.width = `${img.offsetWidth}px`;
          overlay.style.height = `${img.offsetHeight}px`;
        };
        
        // Initial positioning setup
        overlay.style.cssText = `
          position: absolute;
          pointer-events: none;
          z-index: 9999;
          overflow: visible;
        `;
        
        // Initial call to position the overlay
        updateOverlayPosition();
        
        // Set up ResizeObserver to actively sync overlay position when image changes
        const ro = new ResizeObserver(() => {
          // Using requestAnimationFrame to ensure we sync with the repaint cycle
          requestAnimationFrame(updateOverlayPosition);
        });
        ro.observe(img);
        
        // Store ResizeObserver reference on overlay for cleanup
        overlay._resizeObserver = ro;
        
        // Create rectangles using percentage-based positioning
        // Since overlay now matches image dimensions exactly via CSS, we can use percentages directly
        facesList.forEach((face, index) => {
          
          // Determine if coordinates are normalized (0-1) or in pixels
          const isNormalized = face.face_left <= 1 && face.face_top <= 1 && 
                             face.face_width <= 1 && face.face_height <= 1;
          
          // Convert to percentages (no pixel math needed)
          let leftPercent, topPercent, widthPercent, heightPercent;
          
          if (isNormalized) {
            leftPercent = face.face_left * 100;
            topPercent = face.face_top * 100;
            widthPercent = face.face_width * 100;
            heightPercent = face.face_height * 100;
          } else {
            leftPercent = (face.face_left / imgW) * 100;
            topPercent = (face.face_top / imgH) * 100;
            widthPercent = (face.face_width / imgW) * 100;
            heightPercent = (face.face_height / imgH) * 100;
          }
          
          let borderColor = '#3b82f6';
          if (selectedFaceIndex === index) {
            borderColor = '#ef4444';
          } else if ((face.groupId || face.group_id) === currentGroupId) {
            borderColor = '#22c55e';
          }
          
          // Inline getGroupLabel logic to avoid dependency issues
          const groupLabel = (() => {
            if (face?.isPlaceholder) return '';
            const gid = face?.groupId || face?.group_id;
            if (!gid) return '';
            return (useDataStore.getState().entities?.[eventId]?.groups || {})[gid]?.label || '';
          })();
          
          // Create rectangle using percentage positioning (no pixel conversions)
          const rect = document.createElement('div');
          rect.className = `pswp-face-rect pswp-face-rect-${face.id || index}`;
          rect.style.cssText = `
            position: absolute;
            left: ${leftPercent}%;
            top: ${topPercent}%;
            width: ${widthPercent}%;
            height: ${heightPercent}%;
            min-width: 10px;
            min-height: 10px;
            border: 2px solid ${borderColor};
            background-color: ${borderColor}66;
            pointer-events: auto;
            cursor: pointer;
            transition: background-color 0.2s, border-color 0.2s;
            z-index: 10000;
            box-sizing: border-box;
          `;
          
          rect.title = groupLabel || '';
          
          rect.onmouseenter = () => {
            rect.style.backgroundColor = `${borderColor}50`;
          };
          rect.onmouseleave = () => {
            rect.style.backgroundColor = `${borderColor}33`;
          };
          
          rect.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Use ref to avoid dependency issues
            if (handleFaceClickRef.current) {
              handleFaceClickRef.current(index);
            }
          };
          
          const label = document.createElement('div');
          label.style.cssText = `
            position: absolute;
            ${isRTL ? 'right: 0;' : 'left: 0;'}
            top: -24px;
            background-color: ${borderColor};
            color: white;
            font-size: 12px;
            padding: 2px 6px;
            white-space: nowrap;
            pointer-events: none;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
          `;
          label.textContent = groupLabel || '';
          rect.appendChild(label);
          overlay.appendChild(rect);
        });
        
        // Append overlay as a direct sibling to the img
        // Use img.after() to insert right after the image, ensuring it's a direct sibling
        if (img.parentElement === container) {
          // img is a direct child of container, insert overlay right after it
          img.after(overlay);
        } else if (container.contains(img)) {
          // img is in container but not direct child, append to container
          container.appendChild(overlay);
        } else {
          // Fallback: append to img's parent
          img.parentElement?.appendChild(overlay);
        }
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        // Clean up ResizeObserver if overlay exists
        if (pswpInstanceRef.current?.currSlide?.content?.element) {
          const existingOverlay = pswpInstanceRef.current.currSlide.content.element.querySelector('.pswp-face-overlay');
          if (existingOverlay && existingOverlay._resizeObserver) {
            existingOverlay._resizeObserver.disconnect();
            delete existingOverlay._resizeObserver;
          }
        }
      };
    }
  }, [showRectangles, facesList, selectedFaceIndex, imageId, effectiveIndex, currentGroupId, isRTL, permissions.canEdit, fromRTLIndex, filteredImages, storeImageInfo, eventId, t]);

  // PhotoSwipe handles all zoom/pan functionality natively



  const handleFaceListClick = (index) => {
    // Only highlight from the list; no modal open
    setSelectedFaceIndex((prev) => (prev === index ? null : index));
  };

  const handleFaceRectClick = (index) => {
    // Highlight and open transfer modal when clicking the overlay box
    setSelectedFaceIndex(index);
    const face = facesList[index];
    if (face) {
      handleTransferFace(face);
    }
  };
  
  // Update refs for useEffect
  useEffect(() => {
    handleFaceClickRef.current = handleFaceRectClick;
  });

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
  
  // Update ref for useEffect
  useEffect(() => {
    handleTransferFaceRef.current = handleTransferFace;
  });

  // Reset face selection/modal when image changes to avoid stale highlights
  useEffect(() => {
    setSelectedFaceIndex(null);
    setSelectedFaceForTransfer(null);
    setShowTransferModal(false);
  }, [imageId]);

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



  // PhotoSwipe handles cleanup automatically

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

  // PhotoSwipe handles all touch events for zoom/pan

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
        className={`fixed inset-0 ${isMobile ? 'bg-transparent' : 'bg-black bg-opacity-50'} flex items-center justify-center z-50 modal-overlay overflow-hidden`}
      >
        <motion.div
          ref={modalRef}
          className={`bg-transparent min-h-0 image-viewer-modal overflow-hidden ${isMobile ? 'mx-0 my-0 w-full h-full' : 'w-full h-full'}`}
          style={isMobile ? {
            width: '100vw',
            height: '100vh',
            maxWidth: '100vw',
            maxHeight: '100vh'
          } : { 
            width: '100vw',
            height: '100vh'
          }}
          initial={{ opacity: 0, scale: isMobile ? 1 : 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: isMobile ? 1 : 0.95 }}
          tabIndex={-1}
        >

          {/* Content */}
          <div dir={isRTL ? 'rtl' : 'ltr'} className="flex h-full min-h-0 overflow-hidden">
            {/* PhotoSwipe root element */}
            <div ref={pswpRef} className="pswp" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-white z-50">
                {t('imageViewer.loading')}
              </div>
            )}

                    {/* Vaul Drawer - Mobile and Desktop */}
        <Drawer.Root 
          open={drawerOpen} 
          direction={isMobile ? 'bottom' : (isRTL ? 'right' : 'left')}
          onOpenChange={(open) => {
            // Check if any modal is open - prevent closing drawer if modal is open
            const anyModalOpen = showTransferModal || showMoveToMomentModal || showManageAccessModal || imageActions.showDeleteConfirmModal;
            
            // On desktop, only allow closing via info toggle (prevent auto-close)
            // On mobile, allow normal drawer behavior but prevent closing if modal is open
            if (isMobile) {
              // Don't close drawer if a modal is open
              if (!open && anyModalOpen) {
                return; // Prevent closing
              }
              setDrawerOpen(open);
            } else if (open) {
              // Allow opening on desktop
              setDrawerOpen(true);
            }
            // Prevent closing on desktop via onOpenChange (only via info toggle)
          }} 
          modal={isMobile}
        >
          <Drawer.Portal>
            <Drawer.Overlay 
              className={`fixed inset-0 ${isMobile ? 'bg-black/50' : 'bg-transparent pointer-events-none'}`}
              style={{ zIndex: 100001 }}
            />
            <Drawer.Content 
              ref={(node) => {
                drawerContentRef.current = node;
                setDrawerContentElement(node);
              }}
              className={isMobile 
                ? "fixed bottom-0 left-0 right-0 flex flex-col bg-white rounded-t-[10px] max-h-[85vh]"
                : `fixed top-0 ${isRTL ? 'right-0' : 'left-0'} bottom-0 flex flex-col bg-white w-80 max-w-[90vw] shadow-lg overflow-x-hidden`
              }
              style={{ 
                zIndex: 100001, 
                position: 'fixed',
                overflowX: 'hidden',
                ...(isMobile ? {} : {
                  [isRTL ? 'borderLeft' : 'borderRight']: '1px solid #e5e7eb',
                  borderRadius: 0,
                  pointerEvents: 'auto'
                })
              }}
              dir={isRTL ? 'rtl' : 'ltr'}
              onTouchStart={isMobile ? handleDrawerTouchStart : undefined}
              onTouchEnd={isMobile ? handleDrawerTouchEnd : undefined}
              onPointerDownOutside={(e) => {
                // Prevent closing on desktop via outside click - only via info toggle
                // On mobile, prevent closing if a modal is open
                const anyModalOpen = showTransferModal || showMoveToMomentModal || showManageAccessModal || imageActions.showDeleteConfirmModal;
                if (!isMobile || anyModalOpen) {
                  e.preventDefault();
                }
              }}
              onInteractOutside={(e) => {
                // Prevent closing on desktop via outside interaction - only via info toggle
                // On mobile, prevent closing if a modal is open
                const anyModalOpen = showTransferModal || showMoveToMomentModal || showManageAccessModal || imageActions.showDeleteConfirmModal;
                if (!isMobile || anyModalOpen) {
                  e.preventDefault();
                }
              }}
            >
                <Drawer.Title className="sr-only">
                  {t('imageViewer.photoDetails')}
                </Drawer.Title>
                <Drawer.Description className="sr-only">
                  {t('imageViewer.photoDetails')}
                </Drawer.Description>
                {isMobile && <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-300 my-3" />}
                <div className={`flex flex-col h-full min-h-0 overflow-y-auto overflow-x-hidden ${isMobile ? 'px-4 pb-8' : 'p-4'}`}>
                  {/* Controls */}
                  <div className="border-b border-gray-200 pb-3">
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
                      portalContainer={isMobile ? drawerContentElement : null}
                      onOpenManageAccess={() => setShowManageAccessModal(true)}
                    />
                  </div>
                  
                  {/* Animated Content for Navigation */}
                  <div className="flex-1 min-h-0 relative overflow-hidden">
                    <AnimatePresence initial={false} mode="popLayout" custom={drawerDirection}>
                      <motion.div
                        key={imageId || 'no-image'}
                        custom={drawerDirection}
                        initial={{ 
                          x: (isRTL 
                            ? (drawerDirection === 'next' ? '-100%' : '100%') 
                            : (drawerDirection === 'next' ? '100%' : '-100%')), 
                          opacity: 0 
                        }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ 
                          x: (isRTL 
                            ? (drawerDirection === 'next' ? '100%' : '-100%') 
                            : (drawerDirection === 'next' ? '-100%' : '100%')), 
                          opacity: 0 
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="h-full overflow-y-auto overflow-x-hidden"
                      >
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

                  {/* Albums Section */}
                  {(permissions.has_albums || permissions.canEdit) && albumsList && albumsList.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                    <div
                      className="flex items-center justify-between mb-2 cursor-pointer select-none"
                      onClick={handleToggleAlbumsOpen}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleAlbumsOpen();
                        }
                      }}
                    >
                        <h3 className="font-semibold text-gray-900">{t('imageViewer.albums')} ({albumsList.length})</h3>
                        <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleAlbumsOpen();
                        }}
                          className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                          title={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
                          aria-label={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
                        >
                          {albumsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                      {albumsOpen && (
                        <div className="space-y-1 max-h-44 overflow-y-auto pr-1 -mr-1 min-h-0">
                          {albumsList.map((album, index) => (
                            <div
                              key={album.id || `${album.label || 'album'}-${index}`}
                              className={`flex items-center p-2 rounded-lg bg-gray-50 ${album.isPlaceholder ? '' : 'hover:bg-gray-100'} transition-colors`}
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
                      )}
                    </div>
                  )}

                  {/* Faces Section */}
                  {permissions.has_groups && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div
                        className="flex items-center justify-between mb-2 cursor-pointer select-none"
                        onClick={handleToggleFacesOpen}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleToggleFacesOpen();
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{t('imageViewer.faces')} ({facesList.length})</h3>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (showRectangles) {
                                setSelectedFaceIndex(null);
                              }
                              setShowRectangles(!showRectangles);
                            }}
                            className={`w-7 h-7 border border-transparent rounded-md transition-colors flex items-center justify-center ${showRectangles ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-700'}`}
                            title={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                            aria-label={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                          >
                            {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFacesOpen();
                          }}
                          className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                          title={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
                          aria-label={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
                        >
                          {facesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                      {facesOpen && (
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1 -mr-1 min-h-0">
                          {facesList.length === 0 ? (
                            <p className="text-gray-500 text-sm">{t('imageViewer.noFacesDetected')}</p>
                          ) : (
                            facesList.map((face, index) => (
                              <div
                                key={`face-list-${(face.id || face.face_id || `index-${index}`)}-${(face.groupId || face.group_id || 'unknown')}-${index}-${imageId}`}
                                className={`flex items-center gap-3 p-2 rounded-lg ${face.isPlaceholder ? '' : 'cursor-pointer'} transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                                onClick={face.isPlaceholder ? undefined : () => handleFaceListClick(index)}
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
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
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
          showCrops={true}
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

      {/* Manage Access Modal */}
      <ManageAccessModal
        key="manage-access-modal"
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="image"
        entityIds={[imageId]}
        eventUrl={eventUrl}
      />

      {/* Delete confirmation modal */}
      {imageActions.showDeleteConfirmModal && (
        <ConfirmDelete
          key="delete-confirm-modal"
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


