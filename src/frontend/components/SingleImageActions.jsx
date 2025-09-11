import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Heart as HeartIcon, 
  Archive, 
  ShoppingBag,
  Plus as PlusIcon,
  Image as ImageIcon
} from 'lucide-react';
import AlbumQuickAddButton from './AlbumQuickAddButton';
import { albumsAPI } from '../utils/apiService';
import useBucketStore from '../utils/bucketStore';

export default function SingleImageActions({
  imageId,
  imageInfo,
  eventUrl,
  showToast,
  urlHelpers,
  placeholderDataUrl,
  onImageUpdated
}) {
  const { addImages, removeFromQueue, queue, open } = useBucketStore();
  const [isFavorite, setIsFavorite] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const isInBucket = imageId ? queue.includes(imageId) : false;

  // Update local state when imageInfo changes
  useEffect(() => {
    if (imageInfo) {
      setIsFavorite(!!(imageInfo.is_favorite ?? imageInfo.is_favorites));
      setIsArchived(!!imageInfo.is_archived);
    }
  }, [imageInfo]);

  const handleToggleFavorite = async () => {
    if (!imageId) return;
    try {
      const currentFavorite = isFavorite;
      const result = await albumsAPI.toggleFavorite([imageId], currentFavorite, eventUrl);
      if (result) {
        setIsFavorite(!currentFavorite);
        if (onImageUpdated) {
          onImageUpdated({ is_favorite: !currentFavorite });
        }
        showToast(
          <span>
            {currentFavorite ? 'Removed from ' : 'Added to '}
            <Link to={`/${eventUrl}/albums/${encodeURIComponent('Favorites')}`} className="underline hover:text-gray-100">Favorites</Link>
          </span>,
          'success'
        );
      }
    } catch (e) {
      showToast('Failed to update favorites', 'error');
    }
  };

  const handleToggleArchive = async () => {
    if (!imageId) return;
    try {
      if (isArchived) {
        const result = await albumsAPI.toggleArchive([imageId], true, eventUrl);
        if (result) {
          setIsArchived(false);
          if (onImageUpdated) {
            onImageUpdated({ is_archived: false });
          }
          showToast(
            <span>
              Removed from{' '}
              <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
            </span>,
            'success'
          );
        }
      } else {
        const result = await albumsAPI.addToArchive([imageId], eventUrl);
        if (result) {
          setIsArchived(true);
          if (onImageUpdated) {
            onImageUpdated({ is_archived: true });
          }
          showToast(
            <span>
              Moved to{' '}
              <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
            </span>,
            'success'
          );
        }
      }
    } catch (e) {
      showToast('Failed to update archive', 'error');
    }
  };

  const handleToggleBucket = () => {
    if (!imageId) return;
    if (isInBucket) {
      removeFromQueue(imageId);
      showToast('Removed from bucket', 'success');
    } else {
      addImages([imageId]);
      open();
    }
  };

  const handleAlbumAdded = (album) => {
    if (onImageUpdated) {
      onImageUpdated({ album_added: album });
    }
  };

  return (
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
        placeholderDataUrl={placeholderDataUrl}
        onAlbumAdded={handleAlbumAdded}
        dropdownDirection="down"
      />

      {/* Add to bucket / Remove from bucket */}
      <button
        onClick={handleToggleBucket}
        className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 ${isInBucket ? 'text-gray-700' : 'text-gray-700'}`}
        title={isInBucket ? 'Remove from bucket' : 'Add to bucket'}
      >
        <ShoppingBag className="w-4 h-4" fill={isInBucket ? '#60a5fa' : 'none'} stroke="currentColor" strokeWidth="2" />
      </button>

      {/* Archive toggle */}
      <button
        onClick={handleToggleArchive}
        className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
        title={isArchived ? 'Remove from archive' : 'Move to archive'}
        aria-pressed={isArchived}
      >
        <Archive className="w-4 h-4" fill={isArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2" />
      </button>
    </div>
  );
}
