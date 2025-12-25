import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

export function useImageHighlight(gridRef = null) {
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
    const highlightFaces = location.state?.highlightFaces;
    
    // Use highlightFaces if available, otherwise fall back to highlightImages
    const idsToHighlight = highlightFaces || highlightImages;
    
    if (!idsToHighlight || !Array.isArray(idsToHighlight) || idsToHighlight.length === 0) {
      clearHighlights();
      return;
    }
    
    // Set highlighted IDs
    setHighlightedIds(new Set(idsToHighlight));
    scrollAttemptRef.current = 0;
    
    // Scroll to first highlighted item (with retry logic)
    const scrollToFirst = () => {
      const firstId = idsToHighlight[0];
      
      // Check if element exists in DOM first - if so, use DOM scrolling directly
      // This is more reliable than scrollToItem which requires item to be in layout
      const element = imageRefsMap.current.get(firstId);
      if (element) {
        // Element exists, use DOM scrolling directly
        // Find scrollable container
        let scrollContainer = null;
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            scrollContainer = parent;
            break;
          }
          parent = parent.parentElement;
        }
        
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const currentScrollTop = scrollContainer.scrollTop;
          const elementTopInContent = (elementRect.top - containerRect.top) + currentScrollTop;
          const containerHeight = scrollContainer.clientHeight;
          const elementHeight = elementRect.height;
          const targetScroll = elementTopInContent - (containerHeight / 2) + (elementHeight / 2);
          const finalScroll = Math.max(0, Math.min(targetScroll, scrollContainer.scrollHeight - containerHeight));
          
          scrollContainer.scrollTo({ top: finalScroll, behavior: 'smooth' });
          return; // Success, done
        }
      }
      
      // Element not found yet, try grid's scrollToItem if available (might work if item is in layout)
      if (gridRef?.current?.scrollToItem) {
        try {
          gridRef.current.scrollToItem(firstId);
          // If scrollToItem worked, it will scroll. If not, we'll retry below.
          // Give it a moment to see if element appears
          if (scrollAttemptRef.current < 3) {
            scrollAttemptRef.current++;
            setTimeout(scrollToFirst, 150);
            return;
          }
        } catch (error) {
          // Grid method failed, continue to retry logic
        }
      }
      
      // If element still not found, retry
      if (scrollAttemptRef.current < 20) {
        scrollAttemptRef.current++;
        setTimeout(scrollToFirst, 100);
        return;
      }
      
      // Final fallback - check element one more time
      const finalElement = imageRefsMap.current.get(firstId);
      
      if (finalElement) {
        // Find the scrollable grid container - the parent with overflowY: auto
        let scrollContainer = null;
        let parent = finalElement.parentElement;
        
        // Walk up to find the scrollable container
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
              style.overflow === 'auto' || style.overflow === 'scroll') {
            scrollContainer = parent;
            break;
          }
          parent = parent.parentElement;
        }
        
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = finalElement.getBoundingClientRect();
          const currentScrollTop = scrollContainer.scrollTop;
          const elementTopInContent = (elementRect.top - containerRect.top) + currentScrollTop;
          const containerHeight = scrollContainer.clientHeight;
          const elementHeight = elementRect.height;
          const targetScroll = elementTopInContent - (containerHeight / 2) + (elementHeight / 2);
          const finalScroll = Math.max(0, Math.min(targetScroll, scrollContainer.scrollHeight - containerHeight));
          
          scrollContainer.scrollTo({
            top: finalScroll,
            behavior: 'smooth'
          });
        } else {
          // Fallback to scrollIntoView if no container found
          finalElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
        }
      }
    };
    
    // Start scrolling attempts - add extra delay if also scrolling to moment
    const initialDelay = location.state?.highlightMoment ? 800 : 100;
    setTimeout(scrollToFirst, initialDelay); // Initial delay for render
    
    // Clear highlights after 4 seconds (longer to match the animation duration)
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedIds(new Set());
    }, 4000);
    
    // Cleanup on unmount or navigation
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [location.key, gridRef]); // Re-run on navigation or gridRef change
  
  return {
    highlightedIds,
    isHighlighted,
    registerImageRef,
    clearHighlights
  };
}




