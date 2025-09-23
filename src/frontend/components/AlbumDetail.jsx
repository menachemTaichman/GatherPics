import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowUp, ArrowDown, Minus, Plus, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useSetting } from '../utils/useSettings';
import { albumsAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { useDataStore, selectors as storeSelectors } from '../utils/dataManager';

export default function AlbumDetail({ showToast }) {
  const { album_name, eventUrl } = useParams();
  const navigate = useNavigate();
  const { urlHelpers } = useEventUrls(eventUrl);
  const [album, setAlbum] = useState(null);
  const store = useDataStore.getState();
  const [imageClasses, setImageClasses] = useState({});
  const [sortOrder, setSortOrder] = useSetting('albumDetail_sortOrder', 'asc');
  const [imageSize, setImageSize] = useSetting('albumDetail_imageSize', 1.0);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [selection, setSelection] = useState(new Set());

  useEffect(() => {
    async function fetchAlbum() {
      try {
        // We have label in the URL: fetch all albums and find by label
        const all = await albumsAPI.getAll(eventUrl);
        const found = (all.albums || []).find(a => a.label === album_name);
        if (!found) {
          navigate(`/${eventUrl}/albums`);
          return;
        }
        setAlbum(found);
        // Seed store with album entity
        store.applyChanges([{ type: 'UPSERT', entity: 'albums', items: [found] }]);
        // Fetch album images and seed store relations
        const res = await albumsAPI.getImages(found.id, eventUrl);
        const imgs = res.images || [];
        const ids = imgs.map(i => i && i.id).filter(Boolean);
        const changes = [];
        if (imgs.length > 0) changes.push({ type: 'UPSERT', entity: 'images', items: imgs });
        changes.push({ type: 'RELATION_SET', relation: 'album.images', parentId: found.id, ids });
        store.applyChanges(changes);
      } catch (e) {
        console.error('Failed to load album', e);
      }
    }
    if (eventUrl && album_name) fetchAlbum();
  }, [eventUrl, album_name, navigate]);

  const albumImages = useDataStore(state => (album?.id ? storeSelectors.albumImages(state, album.id) : []));
  const sortedImages = useMemo(() => {
    const arr = [...albumImages];
    arr.sort((a, b) => {
      const da = (a.date_taken || '');
      const db = (b.date_taken || '');
      return sortOrder === 'asc' ? String(da).localeCompare(String(db)) : String(db).localeCompare(String(da));
    });
    return arr;
  }, [albumImages, sortOrder]);

  const toggleSelection = (id) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection(next);
  };

  const handleRemoveSelected = async () => {
    if (!album || selection.size === 0) return;
    try {
      const result = await albumsAPI.removeImages(album.id, Array.from(selection), eventUrl);
      setSelection(new Set());
      showToast('Removed from album', 'success');
    } catch (e) {
      showToast('Failed to remove from album', 'error');
    }
  };

  const handleImageLoad = (imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    let imageClass = 'square';
    if (aspectRatio > 1.2) imageClass = 'landscape';
    else if (aspectRatio < 0.8) imageClass = 'portrait';
    setImageClasses(prev => ({ ...prev, [imageId]: imageClass }));
  };

  if (!album) return <div>Loading...</div>;

  return (
    <div className="w-full">
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link to={`/${eventUrl}/albums`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Back to albums">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold text-gray-900">{album.label}</h1>
              <p className="text-gray-600">{albumImages.length} images</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
              title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                const currentPercent = Math.round(imageSize * 100);
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
              style={{ width: '3rem' }}
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
        </div>
      </div>

      <div className="px-8 py-8">
        {sortedImages.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No photos in this album</h3>
            <p className="text-gray-500">Use image actions to add to this album</p>
          </motion.div>
        ) : (
          <motion.div
            className="photo-gallery-grid"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`, gridAutoRows: `${Math.max(100, 266 * imageSize)}px` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {sortedImages.map((image, index) => (
              <motion.div key={`${image.id}-${index}`} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }} className={`photo-card ${imageClasses[image.id] || 'square'}`}>
                <div className="relative group cursor-pointer h-full" onClick={() => toggleSelection(image.id)}>
                  <input
                    type="checkbox"
                    checked={selection.has(image.id)}
                    onChange={() => {}}
                    onClick={(e) => { e.stopPropagation(); toggleSelection(image.id); }}
                    className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300"
                  />
                  <img
                    src={urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : ''}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                    loading="lazy"
                    onLoad={(e) => handleImageLoad(image.id, e)}
                    onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/></svg>'; }}
                  />
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
      {selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white border border-gray-200 shadow-lg rounded-full px-4 py-2 flex items-center space-x-3 z-40">
          <span className="text-sm text-gray-700">{selection.size} selected</span>
          <button onClick={handleRemoveSelected} className="w-8 h-8 rounded-md hover:bg-red-100 text-red-700 flex items-center justify-center" title="Remove from album">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}


