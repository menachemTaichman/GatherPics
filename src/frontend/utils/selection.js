export const getSelectionCacheKey = (groupId) => `groupDetail_selection_${groupId}`;

export const clearTransferredImagesFromCache = (sourceGroupId, transferredImageIds) => {
  if (!sourceGroupId || !transferredImageIds || transferredImageIds.length === 0) {
    return;
  }

  const cacheKey = getSelectionCacheKey(sourceGroupId);
  const settingsKey = cacheKey;

  try {
    const cachedSelectionJSON = localStorage.getItem(settingsKey);
    if (cachedSelectionJSON) {
      const cachedSelection = JSON.parse(cachedSelectionJSON);
      
      if (cachedSelection && Array.isArray(cachedSelection.value)) {
        const removedSet = new Set(transferredImageIds);
        const updatedSelection = cachedSelection.value.filter(imageId => !removedSet.has(imageId));

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
