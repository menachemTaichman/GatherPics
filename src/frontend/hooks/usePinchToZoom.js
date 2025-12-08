import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Hook for pinch-to-zoom functionality on mobile devices
 * @param {number} imageSize - Current image size value (0.5 to 3.0)
 * @param {function} setImageSize - Function to update image size
 * @param {object} options - Optional configuration
 * @param {number} options.minSize - Minimum size (default: 0.5)
 * @param {number} options.maxSize - Maximum size (default: 3.0)
 * @returns {function} Callback ref to attach to the container element
 */
export default function usePinchToZoom(imageSize, setImageSize, options = {}) {
  const { minSize = 0.5, maxSize = 3.0 } = options;
  
  const pinchStartDistanceRef = useRef(null);
  const pinchStartSizeRef = useRef(null);
  const gridContainerRef = useRef(null);
  const imageSizeRef = useRef(imageSize);
  
  // Keep imageSizeRef in sync
  useEffect(() => {
    imageSizeRef.current = imageSize;
  }, [imageSize]);
  
  // State to track when container is ready
  const [containerReady, setContainerReady] = useState(false);
  
  // Callback ref to ensure container is set
  const setGridContainerRef = useCallback((node) => {
    gridContainerRef.current = node;
    setContainerReady(!!node);
  }, []);
  
  // Pinch-to-zoom handlers for mobile
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container || !containerReady) return;
    
    const getDistance = (touch1, touch2) => {
      const dx = touch2.clientX - touch1.clientX;
      const dy = touch2.clientY - touch1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    
    const handleTouchStart = (e) => {
      // Only handle if exactly 2 touches on the container or its children
      if (e.touches.length === 2) {
        // Check if touches are within the container bounds
        const rect = container.getBoundingClientRect();
        const touchesInContainer = Array.from(e.touches).every(touch => {
          return touch.clientX >= rect.left && touch.clientX <= rect.right &&
                 touch.clientY >= rect.top && touch.clientY <= rect.bottom;
        });
        
        if (touchesInContainer) {
          const distance = getDistance(e.touches[0], e.touches[1]);
          pinchStartDistanceRef.current = distance;
          pinchStartSizeRef.current = imageSizeRef.current;
          e.preventDefault();
        }
      }
    };
    
    const handleTouchMove = (e) => {
      // Only handle if we have 2 touches and a valid start distance
      if (e.touches.length === 2 && pinchStartDistanceRef.current !== null) {
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const scale = currentDistance / pinchStartDistanceRef.current;
        const newSize = Math.max(minSize, Math.min(maxSize, pinchStartSizeRef.current * scale));
        setImageSize(newSize);
        e.preventDefault();
      }
    };
    
    const handleTouchEnd = (e) => {
      // Reset if we have less than 2 touches
      if (e.touches.length < 2) {
        pinchStartDistanceRef.current = null;
        pinchStartSizeRef.current = null;
      }
    };
    
    const handleTouchCancel = (e) => {
      pinchStartDistanceRef.current = null;
      pinchStartSizeRef.current = null;
    };
    
    // Attach listeners to container
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchCancel);
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [containerReady, setImageSize, minSize, maxSize]);
  
  return setGridContainerRef;
}

