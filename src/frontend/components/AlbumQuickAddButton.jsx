import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus as PlusIcon, Image as ImageIcon } from 'lucide-react';
import { albumsAPI } from '../utils/apiService';
import { useDataStore } from '../utils/dataManager';

export default function AlbumQuickAddButton({ 
  selectedImages, 
  imageId, // For single image usage
  eventUrl, 
  showToast, 
  urlHelpers, 
  placeholderDataUrl,
  dropdownDirection = 'down', // 'up' or 'down'
  onAlbumAdded // Callback when album is added
}) {
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
        title="Add selected photos to album"
      >
        <PlusIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className={`absolute ${dropdownDirection === 'up' ? 'bottom-full left-0 mb-2' : 'top-full left-0 mt-2'} w-64 max-h-72 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg z-50`}>
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
                        const imagesToAdd = selectedImages || (imageId ? [imageId] : []);
                        const res = await albumsAPI.addImages(album.albumID, imagesToAdd, eventUrl);
                        useDataStore.getState().addImagesToAlbum(res);
                        const added = Array.isArray(res.added_ids) ? res.added_ids.length : (res.added || 0);
                        showToast(
                          <span>
                            {added} added to{' '}
                            <Link to={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="underline hover:text-gray-100">{album.label}</Link>
                          </span>,
                          'success'
                        );
                        // Call the callback to update parent component
                        if (onAlbumAdded) {
                          onAlbumAdded(album);
                        }
                      } catch (e) {
                        showToast('Failed to add to album', 'error');
                      } finally {
                        setOpen(false);
                      }
                    }}
                  >
                    {album.representative_image ? (
                      <img 
                        src={urlHelpers?.getThumbnailUrl ? urlHelpers.getThumbnailUrl(album.representative_image) : `/api/events/${eventUrl}/thumb/${album.representative_image}.webp`} 
                        alt="" 
                        className="w-8 h-8 rounded object-cover" 
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
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
