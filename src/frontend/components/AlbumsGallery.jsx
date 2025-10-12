import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowUp, ArrowDown, Image as ImageIcon, Minus, Plus, Check, X, AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApplyScopes } from '../utils/storeUtils';
import { usePreference } from '../utils/useSettings';
import { setPreference, getImageCount } from '../utils/settings';
import { albumsAPI } from '../utils/apiService';
import { useAlbumsList } from '../utils/dataManager';
import { ImageComponent } from '../utils/useImage.jsx';
import { useToast } from '../utils/ToastContext';
import { useModalFocus } from '../utils/useModalFocus';
import { useModalManager } from '../utils/modalManager';

export default function AlbumsGallery({ eventUrl, urlHelpers: injectedUrlHelpers }) {
  const urlHelpers = injectedUrlHelpers;
  useApplyScopes([{ entity: 'all', id: 'albums' }]);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const sortOrder = usePreference('AlbumsGallery.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('AlbumsGallery.sortDir', value);
  const cardSize = usePreference('general.size', 1.0);
  const setCardSize = (value) => setPreference('general.size', value);
  const [cardSizeInputValue, setCardSizeInputValue] = useState();
  const [imageClasses, setImageClasses] = useState({});
  
  // New album creation states
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [creatingAlbumLoading, setCreatingAlbumLoading] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
  const inputRef = useRef(null);
  const createBoxRef = useRef(null);
  
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = 'album-create-fab';

  // Use the data store for albums
  const storeAlbums = useAlbumsList();
  
  // Custom keyboard handler for create album
  const handleCreateAlbumKeys = (e) => {
    if (e.key === 'Enter' && newAlbumName.trim() && !nameConflict && !creatingAlbumLoading) {
      e.preventDefault();
      e.stopPropagation();
      handleCreateAlbum();
      return true; // Mark as handled
    }
    return false; // Not handled
  };
  
  // Modal focus hook for create album box
  const { modalRef } = useModalFocus(isCreatingAlbum, () => setIsCreatingAlbum(false), {
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID,
    customKeyHandler: handleCreateAlbumKeys,
  });
  
  // Modal registration
  useEffect(() => {
    if (isCreatingAlbum) {
      registerModal({ id: MODAL_ID, type: 'popup' });
      return () => {
        unregisterModal(MODAL_ID);
      };
    }
  }, [isCreatingAlbum, MODAL_ID, registerModal, unregisterModal]);
  
  // Focus input when creating album
  useEffect(() => {
    if (isCreatingAlbum && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreatingAlbum]);

  useEffect(() => {
    async function loadAlbums() {
      try {
        await albumsAPI.getAll(eventUrl);
      } catch (e) {
        console.error('Failed to load albums', e);
      }
    }
    if (eventUrl) loadAlbums();
  }, [eventUrl]);

  // Use albums from store
  const currentAlbums = storeAlbums;

  const filteredAndSortedAlbums = useMemo(() => {
    let filtered = currentAlbums.filter(album => {
      // Filter by search term
      const matchesSearch = album.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           String(album.id || '').includes(searchTerm);
      return matchesSearch;
    });

    // Separate default albums (favorites, archive) from custom albums
    const defaultAlbums = filtered.filter(a => ['archive', 'favorites'].includes((a.label || '').toLowerCase()));
    const customAlbums = filtered.filter(a => !['archive', 'favorites'].includes((a.label || '').toLowerCase()));

    // Sort custom albums by name
    customAlbums.sort((a, b) => {
      const na = (a.label || '').toLowerCase();
      const nb = (b.label || '').toLowerCase();
      return sortOrder === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
    });

    // Default albums always come first
    return [...defaultAlbums, ...customAlbums];
  }, [currentAlbums, searchTerm, sortOrder]);

  const handleImageLoad = (albumId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    let imageClass = 'square';
    if (aspectRatio > 1.2) imageClass = 'landscape';
    else if (aspectRatio < 0.8) imageClass = 'portrait';
    setImageClasses(prev => ({ ...prev, [albumId]: imageClass }));
  };

  // For archived album, always use count_images instead of actual_count_images
  const getAlbumImageCount = (album) => {
    if ((album.label || '').toLowerCase() === 'archive') {
      return album.images_count || 0;
    }
    return getImageCount(album);
  };
  
  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim() || creatingAlbumLoading) return;
    
    const trimmedName = newAlbumName.trim();
    
    // Check for name conflict before submitting
    const existingAlbum = currentAlbums.find(
      a => (a.label || '').toLowerCase() === trimmedName.toLowerCase()
    );
    
    if (existingAlbum) {
      showToast('Album with this name already exists', 'error');
      return;
    }
    
    setCreatingAlbumLoading(true);
    try {
      const res = await albumsAPI.create({ label: trimmedName }, eventUrl);
      const items = res.changes?.[0]?.items;
      const newAlbum = Array.isArray(items) ? items[0] : items;
      const albumId = newAlbum?.id || newAlbum?.album_id || res.album_id;
      
      if (albumId) {
        const link = `/${eventUrl}/albums/${encodeURIComponent(trimmedName)}`;
        showToast(
          <span>
            Album <a 
              href={link} 
              className="underline hover:text-gray-100"
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate(link);
                }
              }}
            >{trimmedName}</a> created
          </span>,
          'success'
        );
        
        setIsCreatingAlbum(false);
        setNewAlbumName('');
        // Don't navigate automatically - let the user click the toast link if they want
      }
    } catch (e) {
      console.error('Failed to create album:', e);
      showToast(`Failed to create album: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      setCreatingAlbumLoading(false);
    }
  };
  
  const checkNameConflict = (name) => {
    if (!name.trim()) {
      setNameConflict(false);
      return;
    }
    
    const existingAlbum = currentAlbums.find(
      a => (a.label || '').toLowerCase() === name.trim().toLowerCase()
    );
    
    setNameConflict(!!existingAlbum);
  };
  
  const handleNewAlbumNameChange = (e) => {
    const name = e.target.value;
    setNewAlbumName(name);
    checkNameConflict(name);
  };
  
  const handleCancelCreate = () => {
    setIsCreatingAlbum(false);
    setNewAlbumName('');
    setNameConflict(false);
  };
  
  const handleToggleCreate = () => {
    if (isCreatingAlbum) {
      // Close if already open
      setIsCreatingAlbum(false);
      setNewAlbumName('');
      setNameConflict(false);
    } else {
      // Open
      setIsCreatingAlbum(true);
    }
  };

  return (
    <div className="w-full">
      {/* Sticky Header */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Albums
            </h1>
            <p className="text-gray-600">
              {filteredAndSortedAlbums.length === currentAlbums.length
                ? `${filteredAndSortedAlbums.length} albums`
                : `${filteredAndSortedAlbums.length} of ${currentAlbums.length} albums`
              }
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                id="search-albums"
                name="search-albums"
                placeholder="Search albums..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
              />
            </div>
            
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-1"
              title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortOrder === 'asc' ? (
                <ArrowUp className="w-4 h-4" />
              ) : (
                <ArrowDown className="w-4 h-4" />
              )}
            </button>

            {/* Size Control */}
            <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
              <button
                onClick={() => {
                  const currentPercent = Math.round(cardSize * 100);
                  const next25 = Math.ceil(currentPercent / 25) * 25;
                  const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                  const subtract25 = currentPercent - 25;
                  const newPercent = Math.max(50, Math.max(subtract25, prev25));
                  setCardSize(newPercent / 100);
                }}
                disabled={cardSize <= 0.50}
                className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="text"
                id="card-size-input"
                name="card-size-input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={cardSizeInputValue !== undefined ? cardSizeInputValue : Math.round(cardSize * 100)}
                onChange={e => setCardSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={e => {
                  let val = parseInt(e.target.value, 10);
                  if (isNaN(val)) val = Math.round(cardSize * 100);
                  val = Math.max(50, Math.min(175, val));
                  setCardSize(val / 100);
                  setCardSizeInputValue(undefined);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.target.blur();
                  } else if (e.key === 'Escape') {
                    setCardSizeInputValue(undefined);
                  }
                }}
                className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                style={{width: '3rem'}}
              />
              <button
                onClick={() => {
                  const currentPercent = Math.round(cardSize * 100);
                  const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                  const add25 = currentPercent + 25;
                  const newPercent = Math.min(175, Math.min(add25, next25));
                  setCardSize(newPercent / 100);
                }}
                disabled={cardSize >= 1.75}
                className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-8">
        {/* Gallery Grid */}
        {filteredAndSortedAlbums.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm ? 'No albums found' : 'No albums yet'}
            </h3>
            <p className="text-gray-500">
              {searchTerm 
                ? 'Try adjusting your search terms' 
                : 'Create an album from image actions'
              }
            </p>
          </motion.div>
        ) : (
          <motion.div 
            className="photo-gallery-grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * cardSize)}px, 1fr))`,
              gridAutoRows: `${Math.max(100, 266 * cardSize)}px`
            }}
          >
            {filteredAndSortedAlbums.map((album, index) => {
              const imageSrc = urlHelpers?.getRepresentativeUrl 
                ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}` 
                : null;
              
              return (
                <motion.div
                  key={album.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className={`photo-card ${imageClasses[album.id] || 'square'}`}
                  style={{ transition: 'transform 0.2s ease-out' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <Link to={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="block group h-full">
                    <div className="relative h-full rounded-lg overflow-hidden">
                      {ImageComponent(imageSrc, {
                        width: 266,
                        height: 266,
                        className: 'w-full h-full object-cover',
                        alt: album.label,
                        iconType: 'image',
                        onLoad: (e) => handleImageLoad(album.id, e)
                      })}
                      
                      {/* Shadow overlay on hover */}
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 rounded-lg"></div>
                      
                      {/* Album Info Overlay */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                        <div className="font-semibold text-white truncate text-sm">
                          {album.label}
                        </div>
                        <div className="text-xs text-white/90">
                          {getAlbumImageCount(album)} images
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
      
      {/* Floating Create Album Button */}
      <div className="fixed bottom-8 right-8 z-40">
        <AnimatePresence>
          {isCreatingAlbum && (
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.9, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-20 right-0 bg-gradient-to-br from-white to-blue-50 rounded-xl shadow-2xl border border-blue-100 p-4 w-80"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newAlbumName}
                    onChange={handleNewAlbumNameChange}
                    placeholder="Enter album name..."
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white ${
                      nameConflict ? 'border-red-500' : 'border-blue-200'
                    }`}
                    disabled={creatingAlbumLoading}
                  />
                  {nameConflict && (
                    <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs whitespace-nowrap">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Album name already exists</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCreateAlbum}
                  disabled={!newAlbumName.trim() || creatingAlbumLoading || nameConflict}
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 hover:from-purple-600 hover:via-blue-600 hover:to-indigo-700 text-white disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex-shrink-0"
                  title="Create album (Enter)"
                >
                  {creatingAlbumLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Check className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={handleCancelCreate}
                  disabled={creatingAlbumLoading}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-transparent hover:border-red-200 flex-shrink-0"
                  title="Cancel (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <motion.button
          onClick={handleToggleCreate}
          className="w-16 h-16 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 hover:from-purple-600 hover:via-blue-600 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={{ rotate: isCreatingAlbum ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          title="Create new album"
        >
          <Plus className="w-8 h-8" />
        </motion.button>
      </div>
    </div>
  );
}

