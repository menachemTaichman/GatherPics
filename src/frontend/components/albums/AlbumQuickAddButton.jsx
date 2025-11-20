import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Plus as PlusIcon, Image as ImageIcon, Check } from 'lucide-react';
import { albumsAPI } from '../../utils/apiService';
import { useDataStore } from '../../utils/dataManager';
import { useToast } from '../../contexts/ToastContext';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { useEventId } from '../../utils/storeUtils';
import { useEventDefaultAlbums } from '../../hooks/useEventDefaultAlbums';

export default function AlbumQuickAddButton({ 
  selectedImages, 
  imageId, // For single image usage
  eventUrl, 
  urlHelpers, 
  placeholderDataUrl,
  dropdownDirection = 'down', // 'up' or 'down'
  onAlbumAdded // Callback when album is added
}) {
  const eventId = useEventId(eventUrl);
  const { defaultAlbumIds } = useEventDefaultAlbums(eventId, eventUrl);
  const defaultAlbumsReady = Boolean(defaultAlbumIds);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [buttonRef, setButtonRef] = useState(null);
  
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = useMemo(() => `album-quick-add-${Math.random().toString(36).slice(2)}`, []);
  
  // Use modal focus hook for proper ESC handling and click outside
  const { modalRef } = useModalFocus(open, () => setOpen(false), {
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID,
    customKeyHandler: (e) => {
      if (!open) return false;
      const node = modalRef?.current;
      const isInside = node && node.contains(e.target);
      if (isInside) {
        if (e.key === 'Enter' && isEditingName && newAlbumName.trim()) {
          e.preventDefault();
          e.stopPropagation();
          handleCreateAlbum();
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (isEditingName) {
            setIsEditingName(false);
            setNewAlbumName('');
          } else {
            setOpen(false);
          }
          return true;
        }
        // Let Tab be handled by focus trap, swallow other keys from bubbling to parent modals
        if (!['Tab', 'Enter', 'Escape'].includes(e.key)) {
          e.stopPropagation();
          return true;
        }
      }
      return false;
    }
  });
  
  // Get albums from data store entities - now get all albums
  const albumsEntities = useDataStore(state => state.entities?.[eventId]?.albums || null);
  
  // Convert albums entities to array and sort by label
  const albums = useMemo(() => {
    if (!albumsEntities) return [];
    if (!defaultAlbumIds) return [];
    const values = Object.values(albumsEntities);
    return values
      .filter((album) => {
        const albumId = album?.id || album?.album_id;
        if (!albumId) return true;
        return !defaultAlbumIds.has(String(albumId));
      })
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [albumsEntities, defaultAlbumIds]);

  // Modal registration
  useEffect(() => {
    if (open) {
      registerModal({ id: MODAL_ID, type: 'popup' });
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        setOpen(false);
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(MODAL_ID);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [open, MODAL_ID, registerModal, unregisterModal]);

  useEffect(() => {
    if (!open || !eventId) return;
    const scope = { entity: 'all', id: 'albums', eventId };
    const store = useDataStore.getState();
    store.addScope?.(scope);
    return () => {
      store.removeScope?.(scope);
    };
  }, [open, eventId]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // Fetch all albums (no filtering in API call)
        await albumsAPI.getAll(eventUrl);
        // Albums will be automatically stored in the data store via the response interceptor
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, eventUrl]);

  const handleAddToAlbum = async (album) => {
    try {
      const imagesToAdd = selectedImages || (imageId ? [imageId] : []);
      const targetAlbumId = album.id || album.album_id;
      const res = await albumsAPI.addImages(targetAlbumId, imagesToAdd, eventUrl);
      
      // Changes are automatically applied by apiService interceptor
      
      const added = res.len_added || (Array.isArray(res.affected_images_ids) ? res.affected_images_ids.length : (res.affected_images_ids || 0));
        const images = imagesToAdd || [];
        showToast(
          <span>
            {added} added to <a 
              href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate(`/${eventUrl}/albums/${encodeURIComponent(album.label)}`, {
                    state: { highlightImages: images.slice(0, 10) }
                  });
                }
              }}
              className="underline hover:text-gray-100"
            >{album.label}</a> album
          </span>,
          'success'
        );
      // Call the callback to update parent component
      if (onAlbumAdded) {
        onAlbumAdded(album);
      }
      setOpen(false);
    } catch (e) {
      showToast(formatErrorMessage('add to album', e), 'error');
    }
  };

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    
    const trimmedName = newAlbumName.trim();
    
    setIsCreatingAlbum(true);
    try {
      // Check if album name already exists using API
      const nameCheck = await albumsAPI.checkName(trimmedName, '', eventUrl);
      if (nameCheck.conflict) {
        showToast('Album with this name already exists', 'error');
        return;
      }
      
      const res = await albumsAPI.create({ label: trimmedName }, eventUrl);
      const newAlbum = res.changes?.[0]?.items?.[0];
      
      // If newAlbum is undefined, try to use album_id from response
      const albumId = newAlbum?.id || newAlbum?.album_id || res.album_id;
      
      if (albumId) {
        // Add images to the newly created album
        const imagesToAdd = selectedImages || (imageId ? [imageId] : []);
        
        if (imagesToAdd.length > 0) {
          await albumsAPI.addImages(albumId, imagesToAdd, eventUrl);
        }
        
        const imageText = imagesToAdd.length === 1 ? 'image' : 'images';
        showToast(
          <span>
            {imagesToAdd.length} {imageText} added to new album <a
              href={`/${eventUrl}/albums/${encodeURIComponent(trimmedName)}`}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate(`/${eventUrl}/albums/${encodeURIComponent(trimmedName)}`, {
                    state: { highlightImages: imagesToAdd.slice(0, 10) }
                  });
                }
              }}
              className="underline hover:text-gray-100"
            >{trimmedName}</a>
          </span>,
          'success'
        );
        
        if (onAlbumAdded) {
          onAlbumAdded({ id: albumId, label: trimmedName });
        }
        setOpen(false);
      }
    } catch (e) {
      showToast(formatErrorMessage('create album', e), 'error');
    } finally {
      setIsCreatingAlbum(false);
      setNewAlbumName('');
      setIsEditingName(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isEditingName && newAlbumName.trim()) {
      e.preventDefault();
      e.stopPropagation();
      handleCreateAlbum();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsEditingName(false);
      setNewAlbumName('');
    }
  };

  // Calculate dropdown position for portal rendering
  const getDropdownPosition = () => {
    if (!buttonRef) return {};
    const rect = buttonRef.getBoundingClientRect();
    const isUp = dropdownDirection === 'up';

    if (isUp) {
      return {
        position: 'fixed',
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 8}px`,
        zIndex: 10000,
      };
    }
    return {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.bottom + 8}px`,
      zIndex: 10000,
    };
  };

  // Render dropdown content
  const renderDropdownContent = () => (
    <div className="w-64 max-h-72 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg">
      {loading || !defaultAlbumsReady ? (
        <div className="p-3 text-sm text-gray-500">Loading albums...</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {albums.length === 0 ? (
            <li>
              <div className="p-3 text-sm text-gray-500">No albums</div>
            </li>
          ) : (
            albums.map((album, idx) => (
              <li key={album.id || album.album_id || `${album.label || 'album'}-${idx}`}>
                <button
                  className="w-full flex items-center space-x-3 p-2 hover:bg-gray-50"
                  onClick={() => handleAddToAlbum(album)}
                >
                  {ImageComponent(
                    urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}` : null,
                    {
                      width: 32,
                      height: 32,
                      className: 'w-8 h-8 rounded object-cover',
                      alt: album.label
                    }
                  )}
                  <span className="text-sm text-gray-700 truncate">{album.label}</span>
                </button>
              </li>
            ))
          )}
          
          {/* Create new album section - always shown when not loading */}
          <li>
            <div className="p-2">
              {isEditingName ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={newAlbumName}
                    onChange={(e) => setNewAlbumName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Album name"
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateAlbum}
                    disabled={!newAlbumName.trim() || isCreatingAlbum}
                    className="w-6 h-6 flex items-center justify-center rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {isCreatingAlbum ? (
                      <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setNewAlbumName('');
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                  >
                    <PlusIcon className="w-3 h-3 rotate-45" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="w-full flex items-center space-x-3 p-2 hover:bg-gray-50 rounded text-gray-600 hover:text-gray-800"
                >
                  <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                    <PlusIcon className="w-4 h-4 text-gray-400" />
                  </div>
                  <span className="text-sm">Create new album</span>
                </button>
              )}
            </div>
          </li>
        </ul>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={setButtonRef}
        onClick={() => setOpen(!open)}
        className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
        title="Add selected to album"
      >
        <PlusIcon className="w-4 h-4" />
      </button>
      {open && buttonRef && createPortal(
        <div ref={modalRef} style={getDropdownPosition()}>
          {renderDropdownContent()}
        </div>,
        document.body
      )}
    </>
  );
}



