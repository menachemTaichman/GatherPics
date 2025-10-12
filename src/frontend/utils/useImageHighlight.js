import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

export function useImageHighlight() {
  const location = useLocation();
  const [highlightedIds, setHighlightedIds] = useState(new Set());
  const imageRefsMap = useRef(new Map());
  const highlightTimeoutRef = useRef(null);
  const scrollAttemptRef = useRef(0);
  
  // Register an image ref for scrolling
  const registerImageRef = useCallback((imageId, element) => {
    if (element) {
      imageRefsMap.current.set(imageId, element);
    } else {
      imageRefsMap.current.delete(imageId);
    }
  }, []);
  
  // Check if an image should be highlighted
  const isHighlighted = useCallback((imageId) => {
    return highlightedIds.has(imageId);
  }, [highlightedIds]);
  
  // Clear highlights
  const clearHighlights = useCallback(() => {
    setHighlightedIds(new Set());
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  }, []);
  
  // Effect: Handle navigation changes
  useEffect(() => {
    const highlightImages = location.state?.highlightImages;
    
    if (!highlightImages || !Array.isArray(highlightImages) || highlightImages.length === 0) {
      clearHighlights();
      return;
    }
    
    // Set highlighted IDs
    setHighlightedIds(new Set(highlightImages));
    scrollAttemptRef.current = 0;
    
    // Scroll to first highlighted image (with retry logic)
    const scrollToFirst = () => {
      const firstId = highlightImages[0];
      const element = imageRefsMap.current.get(firstId);
      
      if (element) {
        // Found it, scroll
        element.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
      } else if (scrollAttemptRef.current < 20) {
        // Not yet rendered, retry after a short delay (up to 2 seconds total)
        scrollAttemptRef.current++;
        setTimeout(scrollToFirst, 100);
        return;
      }
      // else: give up after 20 attempts (2 seconds)
    };
    
    // Start scrolling attempts - add extra delay if also scrolling to moment
    const initialDelay = location.state?.highlightMoment ? 800 : 100;
    setTimeout(scrollToFirst, initialDelay); // Initial delay for render
    
    // Clear highlights after 3 seconds
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedIds(new Set());
    }, 3000);
    
    // Cleanup on unmount or navigation
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [location.key]); // Re-run on navigation
  
  return {
    highlightedIds,
    isHighlighted,
    registerImageRef,
    clearHighlights
  };
}

