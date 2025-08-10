export const getSelectionCacheKey = (groupId) => `faceDetail_selection_${groupId}`;

export const clearTransferredPhotosFromCache = (sourceGroupId, transferredPhotoIds) => {
  if (!sourceGroupId || !transferredPhotoIds || transferredPhotoIds.length === 0) {
    return;
  }

  const cacheKey = getSelectionCacheKey(sourceGroupId);
  const settingsKey = `face_gallery_settings_${cacheKey}`;

  try {
    const cachedSelectionJSON = localStorage.getItem(settingsKey);
    if (cachedSelectionJSON) {
      const cachedSelection = JSON.parse(cachedSelectionJSON);
      
      if (cachedSelection && Array.isArray(cachedSelection.value)) {
        const removedSet = new Set(transferredPhotoIds);
        const updatedSelection = cachedSelection.value.filter(photoId => !removedSet.has(photoId));

        if (updatedSelection.length > 0) {
          cachedSelection.value = updatedSelection;
          localStorage.setItem(settingsKey, JSON.stringify(cachedSelection));
        } else {
          localStorage.removeItem(settingsKey);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to update selection cache for group ${sourceGroupId}:`, error);
  }
};
