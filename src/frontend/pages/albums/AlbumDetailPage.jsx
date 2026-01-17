import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  ArrowLeft, 
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Plus,
  Minus,
  Square,
  CheckSquare,
  Trash2,
  Check,
  X,
  AlertTriangle,
  Key
} from 'lucide-react';
import { ImageViewer, SingleImageTile } from '../../components/images';
import AbsoluteMasonryGrid from '../../components/images/AbsoluteMasonryGrid';
import { useToast } from '../../contexts/ToastContext';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { FloatingSelectionControls } from '../../components/layout';
import { ManageAccessModal } from '../../components/profiles';
import { sortImages, toggleSortOrder } from '../../utils/sorting';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import useImageSelection from '../../hooks/useImageSelection';
import { useDataStore, useAlbumsList } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId, EMPTY_SCOPES } from '../../utils/storeUtils';
import { albumsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { ConfirmDelete } from '../../components/modals';
import { useImageViewerGridSync } from '../../hooks/useImageViewerGridSync';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { PermissionGate, LongPressHoverButton } from '../../components/common';
import { usePermissions } from '../../hooks/usePermissions';
import { useEventDefaultAlbums } from '../../hooks/useEventDefaultAlbums';
import { useRTL } from '../../hooks/useRTL';
import usePinchToZoom from '../../hooks/usePinchToZoom';
import i18n from '../../i18n';
import { APP_CONFIG } from '../../config/appConfig';

const EMPTY_ARRAY = Object.freeze([]);

export default function AlbumDetail({ urlHelpers: injectedUrlHelpers }) {
  const { album_name, eventUrl } = useParams();
  const eventId = useEventId(eventUrl);
  const navigate = useNavigate();
  const urlHelpers = injectedUrlHelpers;
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  const [album, setAlbum] = useState(null);
  const permissions = usePermissions();
  const { isAuthenticated } = useAuth();
  const { archiveAlbumId, favoritesAlbumId } = useEventDefaultAlbums(eventId, eventUrl);
  
  // Use the hook at component level to avoid conditional hook calls
  const albumRepresentativeComponent = useImageComponent(
    album && urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}` : null,
    {
      width: 64,
      height: 64,
      className: 'w-full h-full object-cover',
      alt: album?.label || `Album ${album?.id}`,
      key: album?.id || 'no-representative',
      iconType: 'image'
    }
  );
  
  const sortOrder = usePreference('AlbumDetail.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('AlbumDetail.sortDir', value);
  const [loading, setLoading] = useState(false);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  
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
  
  // Pinch-to-zoom for mobile
  const setPinchRef = usePinchToZoom(imageSize, setImageSize);
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);
  const pendingClassUpdatesRef = useRef({});
  const flushClassesRafRef = useRef(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [nameConflict, setNameConflict] = useState(false);

  // Subscribe to normalized albums list
  const currentAlbums = useAlbumsList(eventId);
  const attemptedLookupRef = useRef(false);
  const isRenamingRef = useRef(false);
  
  const decodedAlbumName = useMemo(() => {
    try { return decodeURIComponent(album_name || ''); } catch { return album_name || ''; }
  }, [album_name]);

  const albumIdentifier = album?.id || album?.album_id || null;
  const archiveId = archiveAlbumId ? String(archiveAlbumId) : null;
  const favoritesId = favoritesAlbumId ? String(favoritesAlbumId) : null;

  const isArchivedAlbum = useMemo(() => {
    if (!archiveId || !albumIdentifier) return false;
    return String(albumIdentifier) === archiveId;
  }, [archiveId, albumIdentifier]);

  const isFavoritesAlbum = useMemo(() => {
    if (!favoritesId || !albumIdentifier) return false;
    return String(albumIdentifier) === favoritesId;
  }, [favoritesId, albumIdentifier]);

  const isDefaultAlbum = isArchivedAlbum || isFavoritesAlbum;

  const albumScopes = useMemo(() => {
    if (!eventId || !album?.id) return EMPTY_SCOPES;
    return [{ entity: 'album', id: String(album.id), eventId }];
  }, [eventId, album?.id]);

  const includeArchivedPreference = usePreference('general.includeArchived', false);
  // For archived album, always include archived; otherwise use preference
  const includeArchived = isArchivedAlbum ? true : includeArchivedPreference;
  useApplyScopes(albumScopes);
  const relatedImages = useChilds(eventId, 'albums', album?.id, 'images', { 
    includeArchived, 
    sortBy: 'date', 
    sortOrder 
  });

  // Create placeholder images for unauthenticated state
  const placeholderImages = useMemo(() => {
    if (!album?.isPlaceholder) return EMPTY_ARRAY;
    return Array.from({ length: 24 }, (_, i) => ({
      id: `placeholder-${i}`,
      label: '',
      isPlaceholder: true
    }));
  }, [album?.isPlaceholder]);

  const sortedImages = useMemo(() => {
    if (!album?.id) return EMPTY_ARRAY;
    // Use placeholders if album is a placeholder
    if (album.isPlaceholder) return placeholderImages;
    return sortImages(relatedImages, 'date', sortOrder);
  }, [album?.id, album?.isPlaceholder, relatedImages, sortOrder, placeholderImages]);

  // Update refs array when sortedImages changes
  useEffect(() => {
    imageTileRefs.current = imageTileRefs.current.slice(0, sortedImages.length);
  }, [sortedImages.length]);

  const {
    selectedKeys: selectedImages,
    toggleKey: toggleSelectedImageKey,
    clear: clearSelection,
    selectAll: selectAllImages,
  } = useImageSelection({
    items: sortedImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });

  const { isOpen: viewerOpen, open: openViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast,
    onTransferComplete: () => {},
    onJumpToMoment: () => {},
    defaultSortBy: 'date',
    defaultSortOrder: sortOrder,
    urlHelpers,
    filteredIds: null,
  });
  
  // Refs for arrow key navigation
  const imageTileRefs = useRef([]);
  const gridRef = useRef(null);
  
  // Image viewer grid sync hook - combines grid scrolling, focus after close, and image highlight
  // Must be called after sortedImages, gridRef, imageTileRefs, and viewerOpen are defined
  const { onImageChange, highlightedIds, registerImageRef } = useImageViewerGridSync({
    gridRef,
    sortedImages,
    imageTileRefs,
    viewerOpen
  });

  // Find album by label
  useEffect(() => {
    if (!eventUrl || !decodedAlbumName) return;
    
    // Skip lookup if we're in the middle of a rename
    if (isRenamingRef.current) {
      isRenamingRef.current = false; // Reset the flag
      return;
    }
    
    // Wait for eventId to resolve before attempting album lookup
    if (!eventId) {
      return;
    }
    
    // If not authenticated, immediately set placeholder and skip all logic
    if (!isAuthenticated) {
      setAlbum({
        id: 'placeholder',
        label: decodedAlbumName,
        images: new Set(),
        isPlaceholder: true
      });
      return;
    }
    
    const resolveByLabel = async () => {
      const searchingForLabel = decodedAlbumName; // Capture the label we're searching for
      
      try {
        // Load all albums to populate the store
        await albumsAPI.getAll(eventUrl);
        
        // Check if we're still looking for the same album (might have been renamed during this async operation)
        // Use window.location to get the current URL parameter
        const urlPath = window.location.pathname;
        const currentAlbumNameFromUrl = urlPath.split('/albums/')[1];
        const currentDecodedName = currentAlbumNameFromUrl ? decodeURIComponent(currentAlbumNameFromUrl) : '';
        if (searchingForLabel !== currentDecodedName) {
          return;
        }
        
        // After loading, check if album exists in store
        const storeAlbums = useDataStore.getState().entities?.[eventId]?.albums || {};
        const match = Object.values(storeAlbums).find(a => a.label === searchingForLabel);
        if (match) {
          setAlbum(match);
          return;
        }
      } catch (e) {
        console.error('Failed to resolve album:', e);
      }
      // Not found -> redirect back to albums list
      navigate(`/${eventUrl}/albums`);
    };

    const foundAlbum = (currentAlbums || []).find(a => a.label === decodedAlbumName);
    if (foundAlbum) {
      // Update only if it's a different album or has different data
      if (!album || album.id !== foundAlbum.id || album !== foundAlbum) {
        setAlbum(foundAlbum);
      }
      return;
    }
    
    if (!attemptedLookupRef.current) {
      attemptedLookupRef.current = true;
      resolveByLabel();
    }
    
    // Refetch data after login
    const handleAuthLogin = () => {
      attemptedLookupRef.current = false; // Reset to allow refetch
      resolveByLabel();
    };
    
    // Reset to placeholder on logout
    const handleAuthLogout = () => {
      setAlbum({
        id: 'placeholder',
        label: decodedAlbumName,
        images: new Set(),
        isPlaceholder: true
      });
    };
    
    window.addEventListener('auth:login', handleAuthLogin);
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => {
      window.removeEventListener('auth:login', handleAuthLogin);
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [decodedAlbumName, currentAlbums, navigate, eventUrl, isAuthenticated, eventId]);

  // Keep local `album` in sync by id when the store object changes
  useEffect(() => {
    if (!album?.id) return;
    const byId = (currentAlbums || []).find(a => a.id === album.id);
    if (byId && byId !== album) {
      setAlbum(byId);
    }
  }, [currentAlbums, album?.id]);

  // Set document title
  useEffect(() => {
    if (album?.label) {
      document.title = `${album.label} | ${APP_CONFIG.name}`;
    } else {
      document.title = `${t('albumDetail.album')} | ${APP_CONFIG.name}`;
    }
  }, [album?.label, i18n.language]);

  // Load album data
  useEffect(() => {
    async function loadAlbumData() {
      if (!album?.id || album.isPlaceholder) return;
      
      setLoading(true);
      try {
        // Fetch album details (includes images via RELATION_SET)
        await albumsAPI.getById(album.id, eventUrl);
      } catch (error) {
        console.error('Error fetching album details:', error);
        showToast(formatErrorMessage('load album details', error), 'error');
      } finally {
        setLoading(false);
      }
    }
    
    if (album?.id && !album.isPlaceholder) loadAlbumData();
  }, [album?.id, eventUrl]);

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
  };

  const handleImageLoad = (imageId, e) => {
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
  };

  const toggleImageSelection = (imageId, event) => {
    toggleSelectedImageKey(imageId, event);
  };

  // Swipe selection support
  const lastSwipedIdsRef = useRef(new Set());
  
  const handleSelectRange = useCallback((ids, isStart) => {
    // ids הוא מערך של כל הפריטים שנבחרו בטווח (כמו Shift)
    if (!ids || ids.length === 0) return;

    // אם זו תחילת לחיצה ארוכה (checkbox)
    if (isStart) {
      setSelectionMode(true); // כניסה למצב בחירה
      // בוחרים את כל הפריטים בטווח
      ids.forEach(id => {
        if (!selectedImages.has(id)) {
          toggleSelectedImageKey(id);
        }
      });
      lastSwipedIdsRef.current = new Set(ids);
      return;
    }

    // בזמן גרירה - עדכון הבחירה לכל הפריטים בטווח
    const currentIds = new Set(ids);
    
    // הסרת פריטים שיצאו מהטווח
    lastSwipedIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        if (selectedImages.has(id)) {
          toggleSelectedImageKey(id);
        }
      }
    });
    
    // הוספת פריטים חדשים שנכנסו לטווח
    currentIds.forEach(id => {
      if (!lastSwipedIdsRef.current.has(id)) {
        if (!selectedImages.has(id)) {
          toggleSelectedImageKey(id);
        }
      }
    });
    
    lastSwipedIdsRef.current = currentIds;
  }, [toggleSelectedImageKey, selectedImages, setSelectionMode]);

  // Handle keyboard shortcuts and arrow key navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Arrow key navigation for images
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const currentElement = document.activeElement;
        const currentIndex = imageTileRefs.current.findIndex(ref => ref === currentElement);
        
        if (currentIndex === -1) return;
        
        // Calculate grid dimensions (approximate based on viewport)
        const gridContainer = currentElement.closest('.photo-gallery-grid');
        if (!gridContainer) return;
        
        const containerRect = gridContainer.getBoundingClientRect();
        const itemRect = currentElement.getBoundingClientRect();
        
        // Estimate columns based on container width and item width
        const itemWidth = itemRect.width;
        const containerWidth = containerRect.width;
        const estimatedCols = Math.floor(containerWidth / itemWidth) || 1;
        
        let nextIndex = currentIndex;
        
        switch (event.key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, sortedImages.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + estimatedCols, sortedImages.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - estimatedCols, 0);
            break;
        }
        
        if (nextIndex !== currentIndex && imageTileRefs.current[nextIndex]) {
          event.preventDefault();
          imageTileRefs.current[nextIndex].focus();
        }
        return;
      }
      
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        if (sortedImages.length > 0) {
          selectAllImages();
        }
      }
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedImages, selectAllImages, clearSelection]);

  const openImageViewer = (imageId, index) => {
    openViewer({ index, parent: album.id, entity: 'album', sortBy: 'date', sortOrder, filteredIds: null });
  };

  // Handle removing images from album
  const handleRemoveFromAlbum = async () => {
    if (!album || selectedImages.size === 0) return;
    
    try {
      await albumsAPI.removeImages(album.id, Array.from(selectedImages), eventUrl);
      // Changes are automatically applied by apiService interceptor
      clearSelection();
      showToast(`${selectedImages.size} ${t('albumDetail.removedFromAlbum')}`, 'success');
    } catch (error) {
      console.error('Error removing from album:', error);
      showToast(formatErrorMessage('remove from album', error), 'error');
    }
  };

  // Handle album deletion
  const handleDeleteAlbum = async () => {
    if (!album) return;
    
    try {
      await albumsAPI.delete(album.id, eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(`${t('albumDetail.albumDeleted')}: "${album.label}"`, 'success');
      navigate(`/${eventUrl}/albums`);
    } catch (error) {
      console.error('Error deleting album:', error);
      showToast(formatErrorMessage('delete album', error), 'error');
    }
  };

  // Handle title editing
  const handleTitleEdit = () => {
    setEditingTitle(album.label || '');
    setIsEditingTitle(true);
  };

  const handleTitleSave = async () => {
    if (!album || !editingTitle.trim()) {
      handleTitleCancel();
      return;
    }

    // Check if name actually changed
    if (editingTitle.trim() === album.label) {
      setIsEditingTitle(false);
      return;
    }

    try {
      // Check for conflicts first (excluding current album)
      const conflictResult = await albumsAPI.checkName(editingTitle.trim(), album.id, eventUrl);
      
      if (conflictResult.conflict) {
        showToast(t('albumDetail.albumNameAlreadyExists'), 'error');
        setNameConflict(true);
        return;
      }
      
      // Set flag to prevent the lookup effect from running BEFORE the API call
      // because the response interceptor will update the store during the API call
      isRenamingRef.current = true;
      
      // Also reset attemptedLookupRef to allow the new name to be looked up if needed
      attemptedLookupRef.current = false;
      
      // No conflict, proceed with update
      await albumsAPI.update(album.id, { label: editingTitle.trim() }, eventUrl);
      
      // Changes are automatically applied by apiService interceptor
      
      // Update local album state immediately to ensure smooth transition
      setAlbum(prev => ({ ...prev, label: editingTitle.trim() }));
      
      // Update the URL to reflect the new album name
      const newUrl = `/${eventUrl}/albums/${encodeURIComponent(editingTitle.trim())}`;
      navigate(newUrl, { replace: true });
      
      setIsEditingTitle(false);
      setNameConflict(false);
      showToast(t('albumDetail.albumNameUpdated'), 'success');
    } catch (error) {
      console.error('Error updating album name:', error);
      showToast(formatErrorMessage('update album name', error), 'error');
      setIsEditingTitle(false);
    }
  };

  const handleTitleCancel = () => {
    setIsEditingTitle(false);
    setEditingTitle(album?.label || '');
    setNameConflict(false);
  };

  // Check for name conflicts when editing (live validation)
  const checkNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      // Exclude current album from conflict check
      const result = await albumsAPI.checkName(label.trim(), album.id, eventUrl);
      setNameConflict(result.conflict || false);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  if (!album) {
    return <div>Loading...</div>;
  }

  return (
    <div className="w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="h-[4rem]"></div>
      {/* Pinned Header */}
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200/50 px-4 sm:px-8 py-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              to={`/${eventUrl}/albums`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title={t('albumDetail.backToAllAlbums')}
              aria-label={t('albumDetail.backToAllAlbums')}
            >
              {isRTL ? (
                <ArrowRight className="w-5 h-5 text-gray-600" />
              ) : (
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              )}
            </Link>
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div 
                  className="w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg"
                >
                  {albumRepresentativeComponent}
                </div>
                {album?.representative_image && (
                  <PermissionGate requires="canEdit">
                    <LongPressHoverButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await albumsAPI.update(album.id, { representative_image: null }, eventUrl);
                          showToast(t('albumDetail.removeRepresentative'), 'success');
                        } catch (error) {
                          showToast(formatErrorMessage('remove representative', error), 'error');
                        }
                      }}
                      className={`absolute -bottom-1 ${endClass('1')} w-4 h-4 sm:w-5 sm:h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors`}
                      title={t('albumDetail.removeRepresentative')}
                      aria-label={t('albumDetail.removeRepresentative')}
                    >
                      <Minus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    </LongPressHoverButton>
                  </PermissionGate>
                )}
              </div>
              <div className="flex flex-col items-start gap-1 sm:gap-3 flex-1 min-w-0">
                {isEditingTitle ? (
                  <div className="flex flex-col gap-1 flex-1 min-w-0" onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      handleTitleCancel();
                    }
                  }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="text"
                          id="edit-album-title"
                          name="edit-album-title"
                          dir={isRTL ? 'rtl' : 'ltr'}
                          value={editingTitle}
                          onChange={(e) => {
                            setEditingTitle(e.target.value);
                            checkNameConflict(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleTitleSave();
                            } else if (e.key === 'Escape') {
                              handleTitleCancel();
                            }
                          }}
                          className={`text-xl sm:text-3xl font-bold text-gray-900 bg-transparent border-b-2 focus:outline-none w-full max-w-[200px] ${
                            nameConflict ? 'border-red-500' : 'border-primary-500'
                          }`}
                          autoFocus
                        />
                        {nameConflict && (
                          <div className={`absolute top-full ${startClass('0')} mt-1 flex items-center gap-1 text-red-500 text-xs`}>
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t('albumDetail.nameAlreadyExists')}</span>
                          </div>
                        )}
                      </div>
                      <LongPressHoverButton
                        onClick={handleTitleSave}
                        className="p-1 hover:bg-green-100 rounded transition-colors flex-shrink-0"
                        title={t('albumDetail.save')}
                        aria-label={t('albumDetail.save')}
                      >
                        <Check className="w-4 h-4 text-green-600" />
                      </LongPressHoverButton>
                      <button
                        onClick={handleTitleCancel}
                        className="p-1 hover:bg-red-100 rounded transition-colors flex-shrink-0"
                        title={t('albumDetail.cancel')}
                        aria-label={t('albumDetail.cancel')}
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                    <div className="relative">
                      <p className="text-sm sm:text-base text-gray-600 whitespace-nowrap">
                        {sortedImages.length} {t('albumDetail.photos')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 min-w-0">
                    <h1 
                      className={`text-xl sm:text-3xl font-bold text-gray-900 truncate ${
                        (isDefaultAlbum || !permissions.canEdit) ? '' : 'cursor-pointer hover:text-primary-600 transition-colors'
                      }`}
                      onClick={(isDefaultAlbum || !permissions.canEdit) ? undefined : handleTitleEdit}
                    >
                      {album.label || `${t('albumDetail.album')} ${album.id}`}
                    </h1>
                    <div className="relative">
                      <p className="text-sm sm:text-base text-gray-600 whitespace-nowrap">
                        {sortedImages.length} {t('albumDetail.photos')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls Row */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* Group 1: Sort */}
            <div className="flex items-center gap-2 sm:gap-4">
            <button
                onClick={handleToggleSortOrder}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
              title={t('albumsGallery.sort') + ' ' + (sortOrder === 'asc' ? t('albumsGallery.ascending') : t('albumsGallery.descending'))}
              aria-label={t('albumsGallery.sort') + ' ' + (sortOrder === 'asc' ? t('albumsGallery.ascending') : t('albumsGallery.descending'))}
            >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
            </button>
            </div>
            
            {/* Group 2: Zoom */}
            <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => {
                const currentPercent = Math.round(imageSize * 100);
                  const next25 = Math.ceil(currentPercent / 25) * 25;
                const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                const subtract25 = currentPercent - 25;
                const newPercent = Math.max(25, Math.max(subtract25, prev25));
                setImageSize(newPercent / 100);
              }}
              disabled={imageSize <= 0.25}
              className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('albumDetail.decreaseSize')}
              aria-label={t('albumDetail.decreaseSize')}
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="text"
                id="album-detail-image-size"
                name="album-detail-image-size"
              inputMode="numeric"
              pattern="[0-9]*"
              dir={isRTL ? 'rtl' : 'ltr'}
              value={imageSizeInputValue !== undefined ? imageSizeInputValue : Math.round(imageSize * 100)}
              onChange={e => setImageSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={e => {
                let val = parseInt(e.target.value, 10);
                if (isNaN(val)) val = Math.round(imageSize * 100);
                val = Math.max(25, Math.min(300, val));
                setImageSize(val / 100);
                setImageSizeInputValue(undefined);
              }}
              onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.target.blur();
                  } else if (e.key === 'Escape') {
                    setImageSizeInputValue(undefined);
                  }
              }}
              className="text-sm font-medium text-gray-700 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                style={{width: '3rem'}}
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
              title={t('albumDetail.increaseSize')}
              aria-label={t('albumDetail.increaseSize')}
            >
              <Plus className="w-4 h-4" />
            </button>
            </div>

            {/* Group 3: Selection Mode Toggle */}
            {sortedImages.length > 0 && (
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={() => setSelectionMode(!selectionMode)}
                  className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                    selectionMode 
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  title={selectionMode ? t('albumDetail.cancelSelectionMode') : t('albumDetail.showCheckboxes')}
                  aria-label={selectionMode ? t('albumDetail.cancelSelectionMode') : t('albumDetail.showCheckboxes')}
                >
                  {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </div>
            )}

            {/* Group 4: Delete Album (custom only) & Manage Access (all albums) */}
            <div className="flex items-center gap-2 sm:gap-4">
              {!isDefaultAlbum && (
                <PermissionGate requires="canEdit">
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-red-100 text-red-700 flex items-center justify-center"
                    title={t('albumDetail.deleteAlbum')}
                    aria-label={t('albumDetail.deleteAlbum')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </PermissionGate>
              )}
              <PermissionGate requires="isProfilesManager">
                <button
                  onClick={() => setShowManageAccessModal(true)}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-blue-100 text-blue-600 flex items-center justify-center"
                  title={t('albumDetail.manageProfileAccess')}
                  aria-label={t('albumDetail.manageProfileAccess')}
                >
                  <Key className="w-4 h-4" />
                </button>
              </PermissionGate>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-4 sm:px-8 pt-0 pb-0">
        {/* Photos Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">{t('albumDetail.loadingPhotos')}</p>
          </div>
        ) : sortedImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t('albumDetail.noPhotosInThisAlbum')}
            </h3>
            <p className="text-gray-500">
              {t('albumDetail.useImageActionsToAdd')}
            </p>
          </motion.div>
        ) : (
          <div className="w-full" style={{ height: `calc(100vh - ${isMobile ? '15rem' : '16rem'})`, marginTop: '1rem' }}>
            <AbsoluteMasonryGrid
              ref={gridRef}
              items={sortedImages}
              baseSize={Math.max(60, 266 * imageSize)}
              imageClasses={imageClasses}
              containerHeight="100%"
              className="w-full"
              onPinchRef={setPinchRef}
              onSelectRange={handleSelectRange}
              style={{
                '--grid-scale': 1,
                '--grid-z-index': 1,
              }}
              onItemRef={(image, index, el) => {
                if (el) {
                  registerImageRef(image.id, el);
                  // Store ref for arrow key navigation - find actual index
                  const actualIndex = sortedImages.findIndex(img => img.id === image.id);
                  if (actualIndex !== -1 && imageTileRefs.current[actualIndex] !== el) {
                    imageTileRefs.current[actualIndex] = el;
                  }
                }
              }}
              renderItem={(image, index, isPortrait, setRef, extraProps) => {
                // Find actual index in sortedImages
                const actualIndex = sortedImages.findIndex(img => img.id === image.id);
                return (
                  <div
                    className={`photo-card ${imageClasses[image.id] || 'square'}`}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <SingleImageTile
                      ref={setRef}
                      image={image}
                      aspectClass={imageClasses[image.id] || 'square'}
                      imageFit={'cover'}
                      thumbSrc={image.isPlaceholder ? null : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                      selectionMode={selectionMode}
                      isSelected={selectedImages.has(image.id)}
                      onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                      startDrag={extraProps?.startDrag}
                      onOpen={() => openImageViewer(image.id, actualIndex !== -1 ? actualIndex : 0)}
                      onImageLoad={(e) => handleImageLoad(image.id, e)}
                      showCropBadge={false}
                      eventUrl={eventUrl}
                      urlHelpers={urlHelpers}
                      isHighlighted={highlightedIds?.has(image.id)}
                      photoIndex={actualIndex !== -1 ? actualIndex : 0}
                      contextType="Album"
                      contextLabel={album?.label}
                    />
                  </div>
                );
              }}
            />
          </div>
        )}
      </div>

      {/* Floating Selection Controls */}
      <FloatingSelectionControls
        selectedCount={selectedImages.size}
        totalCount={sortedImages.length}
        selectedImages={selectedImages}
        onSelectAll={selectAllImages}
        onClearSelection={clearSelection}
        onTransferFaces={() => {}}
        onRemoveFromAlbum={handleRemoveFromAlbum}
        eventUrl={eventUrl}
        urlHelpers={urlHelpers}
        placeholderDataUrl={null}
        showTransferFaces={false}
        showRemoveFromMoment={false}
        showMoveToMoment={false}
        showRemoveFromAlbum={!isDefaultAlbum}
        showArchive={true}
        showFavorites={true}
        showBucket={true}
        showAlbum={true}
        selectionMode={selectionMode}
        entity="album"
        entityId={album?.id}
      />

      {/* Modals */}
      {viewerOpen && (
        <ImageViewer {...viewerProps} onImageChange={onImageChange} includeArchivedOverride={includeArchived} />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <ConfirmDelete
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteAlbum}
          title={t('albumDetail.deleteAlbum')}
          message={t('albumDetail.areYouSureYouWantToDeleteThisAlbum')}
          itemName={album.label || t('albumDetail.album')}
          confirmText={t('albumDetail.deleteAlbum')}
          cancelText={t('albumDetail.cancel')}
          imageUrl={
            album?.representative_image && urlHelpers?.getRepresentativeUrl
              ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image}`
              : null
          }
          imageAlt={album.label || t('albumDetail.album')}
          caption={t('albumDetail.noteImagesNotDeleted')}
        />
      )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="album"
        entityIds={album?.id ? [album.id] : []}
        eventUrl={eventUrl}
      />
    </div>
  );
}




