import { Link } from 'react-router-dom';
import AlbumQuickAddButton from './AlbumQuickAddButton';
import { imagesAPI } from '../utils/apiService';
import useBucketStore from '../utils/bucketStore';
import { useDataStore, selectors } from '../utils/dataManager';
import { useToast } from '../utils/ToastContext';

/**
 * Shared ImageActions hook that handles all image-related actions
 * This hook contains the logic and API calls, but no UI
 * UX components (FloatingSelectionControls, ImageViewer, SingleImageTile) 
 * should use this for performing actions while handling their own presentation
 */
export default function useImageActions({
  imageIds, // Array of image ids or single image id
  eventUrl,
  urlHelpers,
  placeholderDataUrl,
  onImageUpdated, // Callback when image state changes
  onAlbumAdded, // Callback when image is added to album
}) {
  const { showToast } = useToast();
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
  
  // For multiple images, check if all are in the same state
  const allAreFavorited = useDataStore(state => 
    imageIdsArray.length > 1 ? imageIdsArray.every(imageId => selectors.isFavorite(state, imageId)) : false
  );
  const allAreArchived = useDataStore(state => 
    imageIdsArray.length > 1 ? imageIdsArray.every(imageId => selectors.isArchived(state, imageId)) : false
  );
  
  // Check if images are in bucket
  const imagesInBucket = imageIdsArray.filter(id => queue.includes(id));
  const allInBucket = imagesInBucket.length === imageIdsArray.length;
  const someInBucket = imagesInBucket.length > 0;

  const handleToggleFavorite = async () => {
    if (imageIdsArray.length === 0) return;
    
    try {
      // For single image, use the single image state; for multiple, check if all are favorited
      const shouldRemove = imageIdsArray.length === 1 ? isFavorite : allAreFavorited;
      const newFavoriteStatus = !shouldRemove;
      
      // Use the new album-based API that handles multiple images in one call
      const result = await imagesAPI.toggleFavorite(imageIdsArray, newFavoriteStatus, eventUrl);
      
      if (result && result.success) {
        // The API response interceptor will automatically update the data store
        if (onImageUpdated) {
          imageIdsArray.forEach(imageId => {
            onImageUpdated({ id: imageId, is_favorite: newFavoriteStatus });
          });
        }
        
        const action = newFavoriteStatus ? 'Added to' : 'Removed from';
        const actualCount = newFavoriteStatus ? result.len_added : result.len_removed;
        const countText = actualCount === 1 ? '' : `${actualCount} `;
        
        showToast(
          <span>
            {countText}{action}{' '}
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
      // For single image, use the single image state; for multiple, check if all are archived
      const shouldRemove = imageIdsArray.length === 1 ? isArchived : allAreArchived;
      const newArchivedStatus = !shouldRemove;
      
      // Use the new album-based API that handles multiple images in one call
      const result = await imagesAPI.toggleArchive(imageIdsArray, newArchivedStatus, eventUrl);
      
      if (result && result.success) {
        // The API response interceptor will automatically update the data store
        if (onImageUpdated) {
          imageIdsArray.forEach(imageId => {
            onImageUpdated({ id: imageId, is_archived: newArchivedStatus });
          });
        }
        
        const action = newArchivedStatus ? 'moved to' : 'removed from';
        const actualCount = newArchivedStatus ? result.len_added : result.len_removed;
        const countText = actualCount === 1 ? '' : `${actualCount} `;
        
        showToast(
          <span>
            {countText}{action}{' '}
            <Link to={`/${eventUrl}/albums/${encodeURIComponent('Archive')}`} className="underline hover:text-gray-100">Archive</Link>
          </span>,
          'success'
        );
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
    allAreFavorited,
    allAreArchived,
    allInBucket,
    someInBucket,
    imagesInBucket,
    
    // Album quick add component for UX components to render
    AlbumQuickAddButton: (props) => (
      <AlbumQuickAddButton
        imageId={primaryImageId}
        selectedImages={imageIdsArray}
        eventUrl={eventUrl}
        urlHelpers={urlHelpers}
        placeholderDataUrl={placeholderDataUrl}
        onAlbumAdded={handleAlbumAdded}
        {...props}
      />
    )
  };
}
