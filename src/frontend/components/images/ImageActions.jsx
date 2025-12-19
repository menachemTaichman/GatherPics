import { albumsAPI, groupsAPI, momentsAPI, imagesAPI } from '../../utils/apiService';
import useBucketStore from '../../utils/bucketStore';
import { useDataStore, selectors } from '../../utils/dataManager';
import { useToast } from '../../contexts/ToastContext';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useState } from 'react';
import { useEventId } from '../../utils/storeUtils';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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
  entity = null, // 'group' or 'moment' - context for representative setting
  entityId = null, // ID of the group or moment
}) {
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const { addImages, removeFromQueue, queue, open } = useBucketStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  // State for face selection modal
  const [showFaceSelectionModal, setShowFaceSelectionModal] = useState(false);
  const [facesForSelection, setFacesForSelection] = useState([]);
  const [pendingRepImageId, setPendingRepImageId] = useState(null);
  
  // State for delete confirmation modal
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  
  // Normalize imageIds to array
  const imageIdsArray = Array.isArray(imageIds) ? imageIds : [imageIds].filter(Boolean);
  const primaryImageId = imageIdsArray[0];
  
  // Use data store for state
  const isFavorite = useDataStore(state => 
    imageIdsArray.length === 1 ? selectors.isFavorite(state, eventId, primaryImageId) : false
  );
  const isArchived = useDataStore(state => 
    imageIdsArray.length === 1 ? selectors.isArchived(state, eventId, primaryImageId) : false
  );
  
  // For multiple images, check if all are in the same state
  const allAreFavorited = useDataStore(state => 
    imageIdsArray.length > 1 ? imageIdsArray.every(imageId => selectors.isFavorite(state, eventId, imageId)) : false
  );
  const allAreArchived = useDataStore(state => 
    imageIdsArray.length > 1 ? imageIdsArray.every(imageId => selectors.isArchived(state, eventId, imageId)) : false
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
      const result = await albumsAPI.toggleFavorite(imageIdsArray, newFavoriteStatus, eventUrl);
      
      if (result && result.success) {
        // The API response interceptor will automatically update the data store
        if (onImageUpdated) {
          imageIdsArray.forEach(imageId => {
            onImageUpdated({ id: imageId, is_favorite: newFavoriteStatus });
          });
        }
        
        const action = newFavoriteStatus ? t('imageActions.addedTo') : t('imageActions.removedFrom');
        const actualCount = newFavoriteStatus ? result.len_added : result.len_removed;
        const countText = actualCount;
        
        const favoritesHref = `/${eventUrl}/albums/${encodeURIComponent('Favorites')}`;
        showToast(
          <span>
            {countText} {action}{' '}
            <a 
              href={favoritesHref}
              onClick={(e) => {
                // Allow default for modifier keys and middle/right click
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1 || (e.detail && e.detail > 1)) {
                  return; // Let browser handle
                }
                e.preventDefault();
                e.stopPropagation();
                navigate(favoritesHref, {
                  state: { highlightImages: imageIdsArray.slice(0, 10) }
                });
              }}
              className="underline hover:text-gray-100"
            >{t('imageActions.Favorites')}</a>
          </span>,
          'success'
        );
      }
    } catch (e) {
      showToast(formatErrorMessage('update favorites', e), 'error');
    }
  };

  const handleToggleArchive = async () => {
    if (imageIdsArray.length === 0) return;
    
    try {
      // For single image, use the single image state; for multiple, check if all are archived
      const shouldRemove = imageIdsArray.length === 1 ? isArchived : allAreArchived;
      const newArchivedStatus = !shouldRemove;
      
      // Use the new album-based API that handles multiple images in one call
      const result = await albumsAPI.toggleArchive(imageIdsArray, newArchivedStatus, eventUrl);
      
      if (result && result.success) {
        // The API response interceptor will automatically update the data store
        if (onImageUpdated) {
          imageIdsArray.forEach(imageId => {
            onImageUpdated({ id: imageId, is_archived: newArchivedStatus });
          });
        }
        
        const action = newArchivedStatus ? t('imageActions.movedTo') : t('imageActions.removedFrom');
        const actualCount = newArchivedStatus ? result.len_added : result.len_removed;
        const countText = actualCount;
        
        const archiveHref = `/${eventUrl}/albums/${encodeURIComponent('Archive')}`;
        showToast(
          <span>
            {countText} {action}{' '}
            <a 
              href={archiveHref}
              onClick={(e) => {
                // Allow default for modifier keys and middle/right click
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1 || (e.detail && e.detail > 1)) {
                  return; // Let browser handle
                }
                e.preventDefault();
                e.stopPropagation();
                navigate(archiveHref, {
                  state: { highlightImages: imageIdsArray.slice(0, 10) }
                });
              }}
              className="underline hover:text-gray-100"
            >{t('imageActions.Archive')}</a>
          </span>,
          'success'
        );
      }
    } catch (e) {
      showToast(formatErrorMessage('update archive', e), 'error');
    }
  };

  const handleToggleBucket = () => {
    if (imageIdsArray.length === 0) return;
    
    if (allInBucket) {
      // Remove all from bucket
      imageIdsArray.forEach(id => removeFromQueue(id));
      showToast(`${imageIdsArray.length} ${t('imageActions.removedFromBucket')}`, 'success');
    } else {
      // Add all to bucket
      const added = addImages(imageIdsArray);
      if (added > 0) {
        showToast(`${added} ${t('imageActions.addedToBucket')}`, 'success');
      } else {
        showToast(t('imageActions.noNewItemsAdded'), 'success');
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

  const handleSetRepresentative = async (imageId = null, faceId = null) => {
    const targetImageId = imageId || primaryImageId;
    if (!targetImageId || !entity || !entityId) {
      showToast('Cannot set representative: missing context', 'error');
      return;
    }

    try {
      // For groups, we need to handle the special case of multiple faces
      if (entity === 'group' && !faceId) {
        // Fetch faces for this image in this group
        const response = await groupsAPI.getFacesInImage(entityId, targetImageId, eventUrl);
        const faceIds = response?.faces || [];
        
        if (faceIds.length === 0) {
          showToast('No faces found in this image for this person', 'error');
          return;
        }
        
        if (faceIds.length === 1) {
          // Only one face, use it directly (it's already a string ID)
          faceId = faceIds[0];
        } else {
          // Multiple faces, show selection modal
          // Convert face ID strings to objects for the modal
          const faceObjects = faceIds.map(id => ({ id, face_id: id }));
          setFacesForSelection(faceObjects);
          setPendingRepImageId(targetImageId);
          setShowFaceSelectionModal(true);
          return; // Exit here, will continue after modal selection
        }
      }

      // Make the API call to update representative
      if (entity === 'group') {
        const result = await groupsAPI.update(entityId, { representative_face: faceId }, eventUrl);
        // Changes are automatically applied by apiService interceptor
        const entityName = useDataStore.getState().entities?.[eventId]?.groups?.[entityId]?.label || 'person';
        showToast(t('imageActions.setAsRepresentativeFor', { entityName }), 'success');
      } else if (entity === 'moment') {
        const result = await momentsAPI.update(entityId, { representative_image: targetImageId }, eventUrl);
        // Changes are automatically applied by apiService interceptor
        const entityName = useDataStore.getState().entities?.[eventId]?.moments?.[entityId]?.label || 'moment';
        showToast(t('imageActions.setAsRepresentativeFor', { entityName }), 'success');
      } else if (entity === 'album') {
        const result = await albumsAPI.update(entityId, { representative_image: targetImageId }, eventUrl);
        // Changes are automatically applied by apiService interceptor
        const entityName = useDataStore.getState().entities?.[eventId]?.albums?.[entityId]?.label || 'album';
        showToast(t('imageActions.setAsRepresentativeFor', { entityName }), 'success');
      }
    } catch (error) {
      console.error('Error setting representative:', error);
      showToast(formatErrorMessage('set representative', error), 'error');
    }
  };

  const handleFaceSelected = async (faceId) => {
    setShowFaceSelectionModal(false);
    if (faceId && pendingRepImageId) {
      await handleSetRepresentative(pendingRepImageId, faceId);
    }
    setFacesForSelection([]);
    setPendingRepImageId(null);
  };

  const handleCloseFaceSelectionModal = () => {
    setShowFaceSelectionModal(false);
    setFacesForSelection([]);
    setPendingRepImageId(null);
  };

  const handleDeleteImages = () => {
    if (imageIdsArray.length === 0) return;
    // Show confirmation modal
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDelete = async () => {
    if (imageIdsArray.length === 0) return;

    try {
      const result = await imagesAPI.delete(imageIdsArray, eventUrl);
      
      if (result && result.success) {
        // The API response interceptor will automatically update the data store
        const count = imageIdsArray.length;
        showToast(
          <span>
            {count} {count === 1 ? 'photo' : 'photos'} deleted successfully
          </span>,
          'success'
        );
      }
    } catch (error) {
      console.error('Error deleting images:', error);
      showToast(formatErrorMessage('delete photos', error), 'error');
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmModal(false);
  };

  // Stable props for AlbumQuickAddButton to avoid inline component remounts
  const albumQuickAddProps = {
    imageId: primaryImageId,
    selectedImages: imageIdsArray,
    eventUrl,
    urlHelpers,
    placeholderDataUrl,
    onAlbumAdded: handleAlbumAdded,
  };

  // Determine the entity label for tooltips
  const getEntityLabel = () => {
    if (!entity || !entityId) return '';
    const state = useDataStore.getState();
    if (entity === 'group') {
      const group = state.entities?.[eventId]?.groups?.[entityId];
      return group?.label || 'person';
    } else if (entity === 'moment') {
      const moment = state.entities?.[eventId]?.moments?.[entityId];
      return moment?.label || 'moment';
    } else if (entity === 'album') {
      const album = state.entities?.[eventId]?.albums?.[entityId];
      return album?.label || 'album';
    }
    return '';
  };

  const canSetRepresentative = !!(entity && entityId && imageIdsArray.length === 1);
  
  // Check if the current image is the representative
  const isRepresentative = (() => {
    if (!entity || !entityId || imageIdsArray.length !== 1) return false;
    const state = useDataStore.getState();
    
    if (entity === 'group') {
      const group = state.entities?.[eventId]?.groups?.[entityId];
      return group?.representative_image === primaryImageId;
    } else if (entity === 'moment') {
      const moment = state.entities?.[eventId]?.moments?.[entityId];
      return moment?.representative_image === primaryImageId;
    } else if (entity === 'album') {
      const album = state.entities?.[eventId]?.albums?.[entityId];
      return album?.representative_image === primaryImageId;
    }
    
    return false;
  })();
  
  const representativeTooltip = (() => {
    const label = getEntityLabel();
    if (isRepresentative) {
      if (label) {
        return t('imageActions.currentRepresentativeFor', { label });
      }
      return t('imageActions.currentRepresentative');
    }
    if (label) {
      return t('imageActions.setAsRepresentativeForLabel', { label });
    }
    return t('imageActions.setAsRepresentative');
  })();

  // Prepare images for delete confirmation modal
  const deleteImages = imageIdsArray.map(imageId => ({
    id: imageId,
    src: urlHelpers ? urlHelpers.getThumbnailUrl(imageId) : null
  }));

  // Return action functions for UX components to use
  return {
    // Action functions
    toggleFavorite: handleToggleFavorite,
    toggleArchive: handleToggleArchive,
    toggleBucket: handleToggleBucket,
    addToAlbum: handleAlbumAdded,
    setRepresentative: handleSetRepresentative,
    deleteImages: handleDeleteImages,
    
    // State for UX components
    isFavorite,
    isArchived,
    allAreFavorited,
    allAreArchived,
    allInBucket,
    someInBucket,
    imagesInBucket,
    
    // Representative-related state
    canSetRepresentative,
    isRepresentative,
    representativeTooltip,
    showFaceSelectionModal,
    facesForSelection,
    onFaceSelected: handleFaceSelected,
    onCloseFaceSelectionModal: handleCloseFaceSelectionModal,
    
    // Delete confirmation modal state
    showDeleteConfirmModal,
    onConfirmDelete: handleConfirmDelete,
    onCancelDelete: handleCancelDelete,
    deleteCount: imageIdsArray.length,
    deleteImagesList: deleteImages,
    
    // Stable props for AlbumQuickAddButton; consumers should render the shared component directly
    albumQuickAddProps,
  };
}



