import { useEffect, useRef, useCallback, useState } from 'react';
import { useModalManager } from './modalManager';

/**
 * Custom hook for modal focus management
 * Handles:
 * - Focus trapping within modal
 * - Keyboard event capture (excluding scroll when mouse is outside modal)
 * - Click outside to close
 * - Escape key to close
 * - Preventing background scroll
 */
export function useModalFocus(isOpen, onClose, options = {}) {
  const modalRef = useRef(null);
  const lastActiveElement = useRef(null);
  const [modalId] = useState(() => `modal-${Math.random().toString(36).substr(2, 9)}`);
  const { register, unregister, isTopModal } = useModalManager();

  const {
    enableFocusTrapping = true,
    preventBackgroundScroll = true,
    allowOutsideScroll = true,
    customKeyHandler = null
  } = options;

  // Register and unregister the modal from the global manager
  useEffect(() => {
    if (isOpen) {
      register(modalId);
    }
    
    return () => {
      // Unregister when the component unmounts or isOpen becomes false
      unregister(modalId);
    };
  }, [isOpen, modalId, register, unregister]);


  // Store the last active element when modal opens
  useEffect(() => {
    if (isOpen) {
      lastActiveElement.current = document.activeElement;
      
      // After a delay to ensure the modal has rendered, set the initial focus.
      if (enableFocusTrapping && modalRef.current) {
        setTimeout(() => {
          if (!modalRef.current) return;

          // If focus is already within the modal, don't hijack it.
          // This prevents focus from being stolen from an input during re-renders.
          if (modalRef.current.contains(document.activeElement)) {
            return;
          }

          // If an element within the modal has `autofocus`, let the browser handle it.
          const autoFocusElement = modalRef.current.querySelector('[autofocus]');
          if (autoFocusElement) {
            // The browser should handle this automatically, but we can give it a nudge
            // if it hasn't happened yet.
            autoFocusElement.focus();
            return;
          }

          // Otherwise, find the first focusable element and focus it.
          const focusableElements = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusableElements.length > 0) {
            focusableElements[0].focus();
          } else {
            // As a fallback, focus the modal container itself.
            modalRef.current.focus();
          }
        }, 100);
      }
    }
    
    return () => {
      // Restore focus when modal closes
      if (!isOpen && lastActiveElement.current && enableFocusTrapping) {
        // Only restore focus if this was the top modal closing
        if (isTopModal(modalId) || document.activeElement === document.body) {
          try {
            lastActiveElement.current.focus();
          } catch (e) {
            // Fallback if element is no longer in DOM
            document.body.focus();
          }
        }
      }
    };
  }, [isOpen, enableFocusTrapping, modalId, isTopModal]);

  // Prevent background scroll
  useEffect(() => {
    if (!preventBackgroundScroll) return;
    
    // Only apply scroll lock if this is the only modal open
    if (isOpen && isTopModal(modalId) && document.body.style.overflow !== 'hidden') {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      
      return () => {
        // Only restore scroll if no other modals are open
        if (!document.querySelector('.modal-overlay')) {
           document.body.style.overflow = originalOverflow;
        }
      };
    }
  }, [isOpen, preventBackgroundScroll, modalId, isTopModal]);

  // Handle mouse position tracking for outside scroll detection
  const mousePosition = useRef({ x: 0, y: 0 });
  const isMouseOutsideModal = useRef(false);

  const updateMousePosition = useCallback((e) => {
    mousePosition.current = { x: e.clientX, y: e.clientY };
    
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      const wasOutside = isMouseOutsideModal.current;
      isMouseOutsideModal.current = (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
      
      
    }
  }, []);

  // Handle keyboard events
  const handleKeyDown = useCallback((e) => {
    if (!isOpen || !isTopModal(modalId)) return;

    // --- Custom Key Handler ---
    // The custom handler should be respected first. If it handles the key,
    // we stop further processing.
    if (customKeyHandler) {
      const handled = customKeyHandler(e);
      if (handled) {
        return;
      }
    }

    const isEventInsideModal = modalRef.current && modalRef.current.contains(e.target);

    // --- Unified Escape Key Handling ---
    // If not handled by a custom handler, Escape key should close the modal.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    // --- Handling for events INSIDE the modal ---
    if (isEventInsideModal) {
      // Handle focus trapping for Tab key
      if (enableFocusTrapping && e.key === 'Tab') {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length > 0) {
          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];
          
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement.focus();
            }
          }
        } else {
           e.preventDefault(); // No focusable elements, trap tab
        }
        return; // Tab trapping is handled, we're done.
      }

      // For all other keys inside the modal (like Ctrl+A),
      // stop them from bubbling to the document, but allow their default action.
      e.stopPropagation();
      return;
    }

    // --- Handling for events OUTSIDE the modal ---
    
    // Allow browser-level shortcuts that don't have a specific target inside the modal
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.startsWith('F')) {
      return;
    }

    // Allow background scroll via keyboard when mouse is outside
    if (allowOutsideScroll && isMouseOutsideModal.current) {
      const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
      if (scrollKeys.includes(e.key)) {
        return; // Allow background scroll
      }
    }

    // For all other keys originating outside the modal, block them completely.
    e.preventDefault();
    e.stopPropagation();
  }, [isOpen, onClose, customKeyHandler, enableFocusTrapping, allowOutsideScroll, modalId, isTopModal]);

  // Handle wheel events (scrolling)
  const handleWheel = useCallback((e) => {
    if (!isOpen || !isTopModal(modalId)) return;

    // Check if the scroll is happening inside the modal first
    if (modalRef.current && modalRef.current.contains(e.target)) {
      return; // Allow scrolling inside modal
    }

    // When mouse is outside modal bounds, use smooth scrolling
    if (allowOutsideScroll && isMouseOutsideModal.current) {
      // Use smooth scrolling behavior
      window.scrollBy({
        top: e.deltaY,
        behavior: 'smooth'
      });
      
      // Prevent the original event
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Only prevent background scrolling when mouse is over modal area or when outside scroll is disabled
    e.preventDefault();
    e.stopPropagation();
  }, [isOpen, allowOutsideScroll, modalId, isTopModal]);

  // Handle click outside
  const handleClick = useCallback((e) => {
    if (!isOpen || !isTopModal(modalId) || !modalRef.current) return;

    // If click is outside modal, close it
    if (!modalRef.current.contains(e.target)) {
      onClose();
    }
  }, [isOpen, onClose, modalId, isTopModal]);

  // Add event listeners
  useEffect(() => {
    if (!isOpen) return;

    // Add listeners - use capture for most but not wheel
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mousemove', updateMousePosition);
    
    // Add wheel listener with bubble phase so we can selectively prevent
    document.addEventListener('wheel', handleWheel, { passive: false, capture: false });

    return () => {
      // Remove listeners
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mousemove', updateMousePosition);
      document.removeEventListener('wheel', handleWheel, false);
    };
  }, [isOpen, handleKeyDown, handleWheel, handleClick, updateMousePosition]);

  return {
    modalRef,
    // Expose some utilities for components that need them
    isMouseOutsideModal: isMouseOutsideModal.current
  };
}

/**
 * Helper function to create modal focus options
 * Usage: const options = createModalFocusOptions({ allowOutsideScroll: false })
 */
export function createModalFocusOptions(customOptions = {}) {
  return {
    enableFocusTrapping: true,
    preventBackgroundScroll: true,
    allowOutsideScroll: true,
    customKeyHandler: null,
    ...customOptions
  };
}
