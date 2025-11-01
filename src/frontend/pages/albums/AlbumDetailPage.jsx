import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
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
import { useToast } from '../../contexts/ToastContext';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { FloatingSelectionControls } from '../../components/layout';
import { ManageAccessModal } from '../../components/profiles';
import { sortImages, toggleSortOrder } from '../../utils/sorting';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import useImageSelection from '../../hooks/useImageSelection';
import { useDataStore, useAlbumsList } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { albumsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { ConfirmDelete } from '../../components/modals';
import { useImageHighlight } from '../../hooks/useImageHighlight';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { PermissionGate } from '../../components/common';
import { usePermissions } from '../../hooks/usePermissions';

const EMPTY_ARRAY = Object.freeze([]);

export default function AlbumDetail({ urlHelpers: injectedUrlHelpers }) {
  const { album_name, eventUrl } = useParams();
  const eventId = useEventId(eventUrl);
  const navigate = useNavigate();
  const urlHelpers = injectedUrlHelpers;
  const { showToast } = useToast();
  const [album, setAlbum] = useState(null);
  const permissions = usePermissions();
  const { isAuthenticated } = useAuth();
  
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

  // Determine if this is the archived album - for archived, always include archived images
  const isArchivedAlbum = useMemo(() => {
    return (decodedAlbumName || '').toLowerCase() === 'archive';
  }, [decodedAlbumName]);

  // Determine if this is a default album (favorites or archive)
  const isDefaultAlbum = useMemo(() => {
    const label = (decodedAlbumName || '').toLowerCase();
    return ['archive', 'favorites'].includes(label);
  }, [decodedAlbumName]);

  // For archived album, always include archived; otherwise use preference
  const includeArchived = isArchivedAlbum ? true : usePreference('general.includeArchived', false);
  useApplyScopes(album?.id ? [{ entity: 'album', id: String(album.id), eventId }] : []);
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
  
  // Image highlight hook for navigation
  const { isHighlighted, registerImageRef } = useImageHighlight();

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

  // Load album data
  useEffect(() => {
    async function loadAlbumData() {
      if (!album?.id || album.isPlaceholder) return;
      
      setLoading(true);
      try {
        // Set scope to this album for relation updates
        try { useDataStore.getState().setScope({ entity: 'album', id: String(album.id), eventId }); } catch {}
        
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

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
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
  }, [sortedImages]);

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
      showToast(`${selectedImages.size} removed from album`, 'success');
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
      showToast(`Album "${album.label}" deleted`, 'success');
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
        showToast('An album with this name already exists', 'error');
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
      showToast('Album name updated', 'success');
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
    <div className="w-full">
      {/* Pinned Header */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              to={`/${eventUrl}/albums`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to all albums"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div className="relative">
              <div 
                className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg"
                >
                  {albumRepresentativeComponent}
                </div>
                {album?.representative_image && (
                  <PermissionGate requires="canEdit">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await albumsAPI.update(album.id, { representative_image: null }, eventUrl);
                          showToast('Representative removed', 'success');
                        } catch (error) {
                          showToast(formatErrorMessage('remove representative', error), 'error');
                        }
                      }}
                      className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                      title="Remove representative"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                  </PermissionGate>
                )}
              </div>
              <div className="flex items-center space-x-3">
                {isEditingTitle ? (
                  <div className="flex items-center space-x-2" onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      handleTitleCancel();
                    }
                  }}>
                    <div className="relative">
                      <input
                        type="text"
                        id="edit-album-title"
                        name="edit-album-title"
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
                        className={`text-3xl font-bold text-gray-900 bg-transparent border-b-2 focus:outline-none w-[200px] ${
                          nameConflict ? 'border-red-500' : 'border-primary-500'
                        }`}
                        autoFocus
                      />
                      {nameConflict && (
                        <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Name already exists</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleTitleSave}
                      className="p-1 hover:bg-green-100 rounded transition-colors"
                    >
                      <Check className="w-4 h-4 text-green-600" />
                    </button>
                    <button
                      onClick={handleTitleCancel}
                      className="p-1 hover:bg-red-100 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <h1 
                      className={`text-3xl font-bold text-gray-900 w-[200px] ${
                        (isDefaultAlbum || !permissions.canEdit) ? '' : 'cursor-pointer hover:text-primary-600 transition-colors'
                      }`}
                      onClick={(isDefaultAlbum || !permissions.canEdit) ? undefined : handleTitleEdit}
                    >
                      {album.label || `Album ${album.id}`}
                    </h1>
                  </div>
                )}
              </div>
              <div className="relative">
                <p className="text-gray-600">
                  {sortedImages.length} photos
                </p>
              </div>
              </div>
            </div>
          </div>

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center divide-x divide-gray-200">
            {/* Group 1: Sort */}
            <div className="flex items-center space-x-3 px-4">
            <button
                onClick={handleToggleSortOrder}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
              title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
            </button>
            </div>
            
            {/* Group 2: Zoom */}
            <div className="flex items-center space-x-3 px-4">
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
              title="Decrease size"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="text"
                id="album-detail-image-size"
                name="album-detail-image-size"
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
                  if (e.key === 'Enter') {
                    e.target.blur();
                  } else if (e.key === 'Escape') {
                    setImageSizeInputValue(undefined);
                  }
              }}
              className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
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
              title="Increase size"
            >
              <Plus className="w-4 h-4" />
            </button>
            </div>

            {/* Group 3: Selection Mode Toggle */}
            {sortedImages.length > 0 && (
              <div className="flex items-center space-x-3 px-4">
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
              </div>
            )}

            {/* Group 4: Delete Album (custom only) & Manage Access (all albums) */}
            <div className="flex items-center space-x-3 px-4">
              {!isDefaultAlbum && (
                <PermissionGate requires="canEdit">
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-red-100 text-red-700 flex items-center justify-center"
                    title="Delete album"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </PermissionGate>
              )}
              <PermissionGate requires="isProfilesManager">
                <button
                  onClick={() => setShowManageAccessModal(true)}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-blue-100 text-blue-600 flex items-center justify-center"
                  title="Manage profile access"
                >
                  <Key className="w-4 h-4" />
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-8">
        {/* Photos Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading photos...</p>
          </div>
        ) : sortedImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No photos in this album
            </h3>
            <p className="text-gray-500">
              Use image actions to add to this album
            </p>
          </motion.div>
        ) : (
          <motion.div
            className="w-full photo-gallery-grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`,
              gridAutoRows: `${Math.max(100, 266 * imageSize)}px`
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {sortedImages.map((image, index) => (
              <motion.div
                key={image.id || `unknown-${index}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className={`photo-card ${imageClasses[image.id] || 'square'}`}
              >
                <SingleImageTile
                  ref={(el) => registerImageRef(image.id, el)}
                  image={image}
                  aspectClass={imageClasses[image.id] || 'square'}
                  imageFit={'cover'}
                  thumbSrc={image.isPlaceholder ? null : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                  selectionMode={selectionMode}
                  isSelected={selectedImages.has(image.id)}
                  onToggleSelect={(e) => toggleImageSelection(image.id, e)}
                  onOpen={() => openImageViewer(image.id, index)}
                  onImageLoad={(e) => handleImageLoad(image.id, e)}
                  showCropBadge={false}
                  eventUrl={eventUrl}
                  urlHelpers={urlHelpers}
                  isHighlighted={isHighlighted(image.id)}
                />
              </motion.div>
            ))}
          </motion.div>
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
        <ImageViewer {...viewerProps} />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <ConfirmDelete
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteAlbum}
          title="Delete Album"
          message="Are you sure you want to delete"
          itemName={album.label || 'this album'}
          confirmText="Delete"
          cancelText="Cancel"
          imageUrl={
            album?.representative_image && urlHelpers?.getRepresentativeUrl
              ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image}`
              : null
          }
          imageAlt={album.label || 'Album'}
          caption="Note: Images will not be deleted, only the album."
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




