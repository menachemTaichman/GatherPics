import { useState } from 'react';
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
import { useDataStore, selectors } from '../utils/dataManager';

/**
 * Shared ImageActions hook that handles all image-related actions
 * This hook contains the logic and API calls, but no UI
 * UX components (FloatingSelectionControls, ImageViewer, SingleImageTile) 
 * should use this for performing actions while handling their own presentation
 */
export default function useImageActions({
  imageIds, // Array of image IDs or single image ID
  eventUrl,
  showToast,
  urlHelpers,
  placeholderDataUrl,
  onImageUpdated, // Callback when image state changes
  onAlbumAdded, // Callback when image is added to album
}) {
  const { addImages, removeFromQueue, queue, open } = useBucketStore();
  
  // Normalize imageIds to array
  const imageIdsArray = Array.isArray(imageIds) ? imageIds : [imageIds].filter(Boolean);
  const primaryImageId = imageIdsArray[0];
  
  // Use data store for state
  const isFavorite = useDataStore(state => 
    imageIdsArray.length === 1 ? selectors.isFavorite(state, primaryImageId) : false
  );
  const isArchived = useDataStore(state => 
    imageIdsArray.length === 1 ? selectors.isArchived(state, primaryImageId) : false
  );
  
  // Check if images are in bucket
  const imagesInBucket = imageIdsArray.filter(id => queue.includes(id));
  const allInBucket = imagesInBucket.length === imageIdsArray.length;
  const someInBucket = imagesInBucket.length > 0;

  const handleToggleFavorite = async () => {
    if (imageIdsArray.length === 0) return;
    
    try {
      const currentFavorite = isFavorite;
      const result = await albumsAPI.toggleFavorite(imageIdsArray, currentFavorite, eventUrl);
      
      if (result) {
        // The API response interceptor will automatically update the data store
        if (onImageUpdated) {
          imageIdsArray.forEach(id => {
            onImageUpdated({ id, is_favorite: !currentFavorite });
          });
        }
        
        const action = currentFavorite ? 'Removed from' : 'Added to';
        const count = Array.isArray(result.affected_images_ids) ? result.affected_images_ids.length : (currentFavorite ? result.removed : result.added);
        
        showToast(
          <span>
            {count} {action}{' '}
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
    if (imageIdsArray.length === 0) return;
    
    try {
      if (isArchived) {
        const result = await albumsAPI.toggleArchive(imageIdsArray, true, eventUrl);
        if (result) {
          if (onImageUpdated) {
            imageIdsArray.forEach(id => {
              onImageUpdated({ id, is_archived: false });
            });
          }
          
          const count = Array.isArray(result.affected_images_ids) ? result.affected_images_ids.length : result.removed;
          showToast(
            <span>
              {count} removed from{' '}
              <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
            </span>,
            'success'
          );
        }
      } else {
        const result = await albumsAPI.addToArchive(imageIdsArray, eventUrl);
        if (result) {
          if (onImageUpdated) {
            imageIdsArray.forEach(id => {
              onImageUpdated({ id, is_archived: true });
            });
          }
          
          const count = Array.isArray(result.affected_images_ids) ? result.affected_images_ids.length : result.added;
          showToast(
            <span>
              {count} moved to{' '}
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
    if (imageIdsArray.length === 0) return;
    
    if (allInBucket) {
      // Remove all from bucket
      imageIdsArray.forEach(id => removeFromQueue(id));
      showToast(`${imageIdsArray.length} removed from bucket`, 'success');
    } else {
      // Add all to bucket
      const added = addImages(imageIdsArray);
      if (added > 0) {
        showToast(`${added} added to bucket`, 'success');
      } else {
        showToast('No new items added', 'success');
      }
      open();
    }
  };

  const handleAlbumAdded = (album) => {
    if (onAlbumAdded) {
      onAlbumAdded(album);
    }
    if (onImageUpdated) {
      imageIdsArray.forEach(id => {
        onImageUpdated({ id, album_added: album });
      });
    }
  };

  // Return action functions for UX components to use
  return {
    // Action functions
    toggleFavorite: handleToggleFavorite,
    toggleArchive: handleToggleArchive,
    toggleBucket: handleToggleBucket,
    addToAlbum: handleAlbumAdded,
    
    // State for UX components
    isFavorite,
    isArchived,
    allInBucket,
    someInBucket,
    imagesInBucket,
    
    // Album quick add component for UX components to render
    AlbumQuickAddButton: (props) => (
      <AlbumQuickAddButton
        imageId={primaryImageId}
        selectedImages={imageIdsArray}
        eventUrl={eventUrl}
        showToast={showToast}
        urlHelpers={urlHelpers}
        placeholderDataUrl={placeholderDataUrl}
        onAlbumAdded={handleAlbumAdded}
        {...props}
      />
    )
  };
}
