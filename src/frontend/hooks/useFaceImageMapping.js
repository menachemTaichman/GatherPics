import { useMemo, useCallback } from 'react';
import { useDataStore } from '../utils/dataManager';

/**
 * Hook that provides mapping functions between image IDs and face IDs in faces mode
 * Used for navigation, scrolling, and focusing in GroupDetailPage
 * 
 * @param {Object} options
 * @param {boolean} options.showCrops - Whether we're in faces mode
 * @param {Array} options.sortedImages - Array of sorted items (faces in faces mode, images in images mode)
 * @param {string} options.eventId - Event ID for accessing store
 * @param {string} options.currentGroupId - Current group ID (for preferring faces from this group)
 * @returns {Object} - { imageIdToFaceId, imageIdsToFaceIds, faceIdToImageId, getFaceForImage }
 */
export function useFaceImageMapping({ showCrops, sortedImages, eventId, currentGroupId }) {
  // Memoize the faces map for quick lookups
  const facesMap = useMemo(() => {
    if (!showCrops || !eventId) return {};
    const store = useDataStore.getState();
    return store.entities?.[eventId]?.faces || {};
  }, [showCrops, eventId]);

  /**
   * Convert a single image ID to a face ID
   * Prefers faces from the current group if multiple faces exist for the same image
   */
  const imageIdToFaceId = useCallback((imageId) => {
    if (!showCrops || !imageId) return null;
    
    // Find faces that belong to this image
    const matchingFaces = sortedImages.filter(face => {
      const faceData = typeof face === 'object' && face !== null ? face : facesMap[face];
      if (!faceData) return false;
      return String(faceData.image_id) === String(imageId);
    });
    
    if (matchingFaces.length === 0) return null;
    
    // Prefer face from current group if multiple exist
    if (matchingFaces.length > 1 && currentGroupId) {
      const currentGroupFace = matchingFaces.find(face => {
        const faceData = typeof face === 'object' && face !== null ? face : facesMap[face];
        return faceData && String(faceData.group_id) === String(currentGroupId);
      });
      if (currentGroupFace) {
        return typeof currentGroupFace === 'object' ? currentGroupFace.id : currentGroupFace;
      }
    }
    
    // Return first matching face
    const faceToUse = matchingFaces[0];
    return typeof faceToUse === 'object' ? faceToUse.id : faceToUse;
  }, [showCrops, sortedImages, facesMap, currentGroupId]);

  /**
   * Convert multiple image IDs to face IDs
   */
  const imageIdsToFaceIds = useCallback((imageIds) => {
    if (!showCrops || !Array.isArray(imageIds)) return [];
    
    const faceIds = [];
    imageIds.forEach(imageId => {
      const faceId = imageIdToFaceId(imageId);
      if (faceId) {
        faceIds.push(faceId);
      }
    });
    
    return faceIds;
  }, [showCrops, imageIdToFaceId]);

  /**
   * Convert a face ID to its image ID
   */
  const faceIdToImageId = useCallback((faceId) => {
    if (!showCrops || !faceId) return null;
    
    const face = typeof faceId === 'object' ? faceId : facesMap[faceId];
    if (!face) {
      // Try finding in sortedImages
      const faceInSorted = sortedImages.find(f => {
        const fId = typeof f === 'object' ? f.id : f;
        return String(fId) === String(faceId);
      });
      if (faceInSorted && faceInSorted.image_id) {
        return String(faceInSorted.image_id);
      }
      return null;
    }
    
    return face.image_id ? String(face.image_id) : null;
  }, [showCrops, facesMap, sortedImages]);

  /**
   * Get the face object for a given image ID
   * Useful when you need the full face data, not just the ID
   */
  const getFaceForImage = useCallback((imageId) => {
    if (!showCrops || !imageId) return null;
    
    const matchingFaces = sortedImages.filter(face => {
      const faceData = typeof face === 'object' && face !== null ? face : facesMap[face];
      if (!faceData) return false;
      return String(faceData.image_id) === String(imageId);
    });
    
    if (matchingFaces.length === 0) return null;
    
    // Prefer face from current group if multiple exist
    if (matchingFaces.length > 1 && currentGroupId) {
      const currentGroupFace = matchingFaces.find(face => {
        const faceData = typeof face === 'object' && face !== null ? face : facesMap[face];
        return faceData && String(faceData.group_id) === String(currentGroupId);
      });
      if (currentGroupFace) {
        return typeof currentGroupFace === 'object' ? currentGroupFace : facesMap[currentGroupFace];
      }
    }
    
    const faceToUse = matchingFaces[0];
    return typeof faceToUse === 'object' ? faceToUse : facesMap[faceToUse];
  }, [showCrops, sortedImages, facesMap, currentGroupId]);

  /**
   * Find the index of a face in sortedImages given an image ID
   */
  const getFaceIndexForImage = useCallback((imageId) => {
    if (!showCrops || !imageId) return -1;
    
    const faceId = imageIdToFaceId(imageId);
    if (!faceId) return -1;
    
    return sortedImages.findIndex(f => {
      const fId = typeof f === 'object' ? f.id : f;
      return String(fId) === String(faceId);
    });
  }, [showCrops, imageIdToFaceId, sortedImages]);

  return {
    imageIdToFaceId,
    imageIdsToFaceIds,
    faceIdToImageId,
    getFaceForImage,
    getFaceIndexForImage,
  };
}

