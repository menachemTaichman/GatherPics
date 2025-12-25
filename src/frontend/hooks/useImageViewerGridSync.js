import { useRef, useEffect, useCallback } from 'react';
import { useImageHighlight } from './useImageHighlight';

/**
 * Hook that synchronizes ImageViewer with the grid:
 * 1. Scrolls grid when navigating in ImageViewer
 * 2. Focuses last viewed image after closing ImageViewer
 * 3. Provides image highlight support for navigation from Toast
 * 
 * @param {Object} options
 * @param {React.RefObject} options.gridRef - Ref to the AbsoluteMasonryGrid component
 * @param {Array} options.sortedImages - Array of sorted images (for finding indices)
 * @param {React.RefObject|Function} options.imageTileRefs - Ref array for image tile DOM elements, or function to get refs
 * @param {boolean} options.viewerOpen - Whether the ImageViewer is currently open
 * @param {Function} options.getRefsForImage - Optional function to get refs for a specific image (for multi-grid support)
 * @returns {Object} - { onImageChange, highlightedIds, registerImageRef, setCurrentImageId }
 */
export function useImageViewerGridSync({ gridRef, sortedImages, imageTileRefs, viewerOpen, getRefsForImage = null }) {
  // Track current image ID in viewer for refocus on close
  const currentViewerImageIdRef = useRef(null);
  
  // Use image highlight hook for navigation from Toast
  const { highlightedIds, registerImageRef } = useImageHighlight(gridRef);
  
  // Callback to scroll grid when image changes in viewer
  const handleImageChange = useCallback((imageId, index) => {
    // Track current image ID
    currentViewerImageIdRef.current = imageId;
    
    // Scroll to the image in the grid
    if (gridRef?.current?.scrollToItem) {
      gridRef.current.scrollToItem(imageId);
    }
  }, [gridRef]);
  
  // Refocus on current image when viewer closes
  useEffect(() => {
    if (!viewerOpen && currentViewerImageIdRef.current) {
      const imageId = currentViewerImageIdRef.current;
      
      // Function to attempt focus with retry
      const attemptFocus = (retryCount = 0) => {
        // If getRefsForImage is provided, use it (for multi-grid support)
        if (getRefsForImage) {
          const refs = getRefsForImage(imageId);
          if (refs) {
            const { refs: imageRefs, index: imageIndex } = refs;
            if (imageIndex >= 0 && imageRefs && imageRefs[imageIndex]) {
              const imageElement = imageRefs[imageIndex];
              // Ensure element is focusable and focus it
              if (imageElement && typeof imageElement.focus === 'function') {
                // Make sure element is in the DOM and visible
                if (imageElement.offsetParent !== null || imageElement.getBoundingClientRect().width > 0) {
                  imageElement.focus();
                  currentViewerImageIdRef.current = null;
                  return true; // Success
                }
              }
            }
          }
        } else {
          // Default behavior: use sortedImages and imageTileRefs
          // Normalize imageId to string for comparison (handles string/number mismatch)
          const normalizedImageId = String(imageId);
          const imageIndex = sortedImages.findIndex(img => String(img.id) === normalizedImageId);
          
          if (imageIndex >= 0 && imageTileRefs?.current && imageTileRefs.current[imageIndex]) {
            const imageElement = imageTileRefs.current[imageIndex];
            
            // Focus the image tile to show the blue border
            if (imageElement && typeof imageElement.focus === 'function') {
              // Make sure element is in the DOM and visible
              if (imageElement.offsetParent !== null || imageElement.getBoundingClientRect().width > 0) {
                imageElement.focus();
                currentViewerImageIdRef.current = null;
                return true; // Success
              }
            }
          }
        }
        
        // Retry if not successful and haven't exceeded retry limit
        if (retryCount < 3) {
          setTimeout(() => attemptFocus(retryCount + 1), 100);
          return false;
        }
        
        // Clear the ref after all retries exhausted
        currentViewerImageIdRef.current = null;
        return false;
      };
      
      // Initial delay to ensure viewer animation completes
      const timeoutId = setTimeout(() => {
        attemptFocus();
      }, 150);
      
      return () => clearTimeout(timeoutId);
    }
  }, [viewerOpen, sortedImages, imageTileRefs, getRefsForImage]);
  
  return {
    onImageChange: handleImageChange,
    highlightedIds,
    registerImageRef,
    // Expose for tracking in openImageViewer if needed
    setCurrentImageId: (imageId) => {
      currentViewerImageIdRef.current = imageId;
    }
  };
}

