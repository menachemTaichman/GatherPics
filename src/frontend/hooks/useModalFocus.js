import { useEffect, useRef, useCallback, useState } from 'react';
import { useModalManager, useModalStore } from '../utils/modalManager';

// Debug helper removed

/**
 * Custom hook for modal focus management
 * Handles:
 * - Focus trapping within modal
 * - Keyboard event capture (excluding scroll when mouse is outside modal)
 * - Click outside to close
 * - Escape key to close
 * - Preventing background scroll
 * - Browser back button to close (mobile UX improvement)
 */
export function useModalFocus(isOpen, onClose, options = {}) {
  const modalRef = useRef(null);
  const lastActiveElement = useRef(null);
  const lastForcedFocusTargetRef = useRef(null);
  const [modalId] = useState(() => options?.modalId || `modal-${Math.random().toString(36).substr(2, 9)}`);
  const isPopup = options?.modalType === 'popup';
  const { isTopModal } = useModalManager();
  
  // Check if this modal is registered and is the topmost modal
  const isTopmostModal = useCallback(() => {
    try {
      const { stack } = useModalStore.getState();
      if (stack.length === 0) {
        return true;
      }
      const topId = stack[stack.length - 1];
      const result = isTopModal(modalId);
      return result;
    } catch {
      // If modal is not registered, assume it's topmost (fallback for modals not using modalManager)
      return true;
    }
  }, [isTopModal, modalId]);

  const {
    enableFocusTrapping = true,
    preventBackgroundScroll = true,
    allowOutsideScroll = true,
    customKeyHandler = null,
    enableBackButton = true, // Enable browser back button handling by default
    backButtonStateKey = null // Custom state key for history (defaults to modalId-based)
  } = options;

  // Store the last active element when modal opens
  useEffect(() => {
    if (isOpen) {
      lastActiveElement.current = document.activeElement;
      
      // Add overscroll-contain to all scrollable elements within the modal to prevent scroll chaining
      if (modalRef.current) {
        // Apply to modal itself
        modalRef.current.style.overscrollBehavior = 'contain';
        
        // Apply to all scrollable children
        const scrollableElements = modalRef.current.querySelectorAll('[class*="overflow"]');
        scrollableElements.forEach(el => {
          el.style.overscrollBehavior = 'contain';
        });
      }
      
      // After a delay to ensure the modal has rendered, set the initial focus.
      if (enableFocusTrapping && modalRef.current) {
        setTimeout(() => {
          if (!modalRef.current) return;
          if (modalRef.current.contains(document.activeElement)) return;
          const autoFocusElement = modalRef.current.querySelector('[autofocus]');
          if (autoFocusElement) {
            try { autoFocusElement.focus({ preventScroll: true }); } catch (e) { autoFocusElement.focus(); }
            return;
          }
          const focusableElements = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusableElements.length > 0) {
            try { focusableElements[0].focus({ preventScroll: true }); } catch (e) { focusableElements[0].focus(); }
          } else {
            try { modalRef.current.focus({ preventScroll: true }); } catch (e) { modalRef.current.focus(); }
          }
        }, 100);
      }
    }
    
    return () => {
      // Restore focus when modal closes
      if (!isOpen && lastActiveElement.current && enableFocusTrapping) {
        try {
          lastActiveElement.current.focus({ preventScroll: true });
        } catch (e) {
          try { document.body.focus({ preventScroll: true }); } catch (e2) { document.body.focus(); }
        }
      }
    };
  }, [isOpen, enableFocusTrapping, modalId]);

  // Prevent background scroll (local implementation; covers popup and panel when desired)
  useEffect(() => {
    if (!isOpen) return;
    // For popups, only lock if allowOutsideScroll is false
    // For panels, lock if preventBackgroundScroll is true and allowOutsideScroll is false
    const lockBackground = (isPopup && !allowOutsideScroll) || (!isPopup && !allowOutsideScroll && preventBackgroundScroll);
    if (!lockBackground) return;
    const originalOverflow = document.documentElement.style.overflow || '';
    const originalBodyOverflow = document.body.style.overflow || '';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = originalOverflow;
      document.body.style.overflow = originalBodyOverflow;
    };
  }, [isOpen, isPopup, preventBackgroundScroll, allowOutsideScroll]);

  // Handle mouse position tracking for outside scroll detection
  const mousePosition = useRef({ x: 0, y: 0 });
  const isMouseOutsideModal = useRef(false);

  const updateMousePosition = useCallback((e) => {
    mousePosition.current = { x: e.clientX, y: e.clientY };
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
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
    if (!isOpen) return;
    const topmost = isTopmostModal();
    const inModal = modalRef.current && modalRef.current.contains(e.target);
    const stackSnapshot = (() => {
      try { return [...(useModalStore.getState().stack || [])]; } catch { return []; }
    })();
    // Only the topmost modal should react to keyboard events
    if (!topmost) {
      return;
    }
    // Custom handler first
    if (customKeyHandler) {
      const handled = customKeyHandler(e);
      if (handled) {
        return;
      }
    }
    const isEventInsideModal = inModal;
    if (e.key === 'Escape') {
      // Only handle ESC if this modal is the topmost modal
      if (isTopmostModal()) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // If not topmost modal, let the event bubble to the topmost modal
      return;
    }
    if (isEventInsideModal) {
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
          e.preventDefault();
        }
        return;
      }
      // Allow Enter/Space on buttons and links to work normally
      if ((e.key === 'Enter' || e.key === ' ') && 
          (e.target.tagName === 'BUTTON' || e.target.tagName === 'A')) {
        // Let the button/link handle the event naturally
        return;
      }
      e.stopPropagation();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key && e.key.startsWith('F'))) return;
    if (allowOutsideScroll && isMouseOutsideModal.current) {
      const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
      if (scrollKeys.includes(e.key)) return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, [isOpen, onClose, customKeyHandler, enableFocusTrapping, allowOutsideScroll, modalId, isTopmostModal]);

  // Handle wheel events (scrolling)
  const handleWheel = useCallback((e) => {
    if (!isOpen) return;
    if (e.defaultPrevented) return;
    
    // Only handle wheel events if this modal is the topmost modal
    if (!isTopmostModal()) {
      return; // Let the topmost modal handle the wheel event
    }
    
    const isEventInsideModal = modalRef.current && modalRef.current.contains(e.target);
    const isOutsideByPointer = (() => {
      if (!modalRef.current) return true;
      const rect = modalRef.current.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    })();
    
    if (isEventInsideModal) {
      let node = e.target instanceof Element ? e.target : null;
      const deltaY = e.deltaY || 0;
      const deltaX = e.deltaX || 0;
      const canScrollInAxis = (el) => {
        const style = window.getComputedStyle(el);
        const yScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
        const xScrollable = style.overflowX === 'auto' || style.overflowX === 'scroll';
        if (yScrollable) {
          const maxY = el.scrollHeight - el.clientHeight;
          if (maxY > 0) {
            if (deltaY < 0 && el.scrollTop > 0) return true;
            if (deltaY > 0 && el.scrollTop < maxY) return true;
          }
        }
        if (xScrollable) {
          const maxX = el.scrollWidth - el.clientWidth;
          if (maxX > 0) {
            if (deltaX < 0 && el.scrollLeft > 0) return true;
            if (deltaX > 0 && el.scrollLeft < maxX) return true;
          }
        }
        return false;
      };
      
      // Check if the target element or any parent can scroll
      while (node && node !== modalRef.current) {
        if (node instanceof Element && canScrollInAxis(node)) {
          return; // Allow the element to handle scrolling naturally
        }
        node = node.parentElement;
      }
      
      // If no scrollable element found, prevent the event
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Handle events outside the modal
    if (allowOutsideScroll && isOutsideByPointer) {
      return; // Allow background scrolling
    }
    e.preventDefault();
    e.stopPropagation();
  }, [isOpen, allowOutsideScroll, modalId, isTopmostModal]);

  // Handle click outside
  const handleClick = useCallback((e) => {
    if (!isOpen || !modalRef.current) return;
    if (!isTopmostModal()) return;
    const stackSnapshot = (() => {
      try { return [...(useModalStore.getState().stack || [])]; } catch { return []; }
    })();
    const inModal = modalRef.current.contains(e.target);

    // If click is inside this (topmost) modal, ensure the target gets focus when appropriate
    const maybeFocusTarget = () => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;
      const tag = t.tagName;
      const isFocusableTag = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const hasTabIndex = typeof t.tabIndex === 'number' && t.tabIndex >= 0;
      const isContentEditable = t.isContentEditable;
      const shouldForce = isFocusableTag || hasTabIndex || isContentEditable;

      if (!shouldForce) return;

      // Prevent default to stop other listeners from stealing focus (e.g., PhotoSwipe/UI buttons)
      e.preventDefault();
      e.stopPropagation();

      const focusAttempts = [0, 10, 30, 60, 120];
      lastForcedFocusTargetRef.current = t;
      focusAttempts.forEach((delay) => {
        setTimeout(() => {
          const active = document.activeElement;
          if (active !== t && document.contains(t)) {
            try {
              t.focus({ preventScroll: true });
            } catch {
              try { t.focus(); } catch {}
            }
          } else {
          }
        }, delay);
      });
    };

    if (!inModal) {
      // Check if click is on PhotoSwipe elements (PhotoSwipe appends to document.body, outside modalRef)
      const pswpElement = e.target.closest('.pswp');
      if (pswpElement) {
        // Don't close if clicking on PhotoSwipe elements - they're part of the modal content
        return;
      }
      
      // Check if the click is on the toggle button (for BucketDrawer or NotificationsDropdown)
      let target = e.target;
      while (target && target !== document.body) {
        if (target.dataset && (target.dataset.bucketToggle === 'true' || target.dataset.notifToggle === 'true')) {
          return; // Don't close if clicking the toggle button
        }
        target = target.parentElement;
      }
      onClose();
    } else {
      maybeFocusTarget();
    }
  }, [isOpen, onClose, modalId, isTopmostModal]);

  // Pointer down logging to track who is consuming the click before focus
  const handlePointerDown = useCallback((e) => {
    if (!isOpen || !modalRef.current) return;
    if (!isTopmostModal()) return;
    const stackSnapshot = (() => {
      try { return [...(useModalStore.getState().stack || [])]; } catch { return []; }
    })();
  }, [isOpen, modalId, isTopmostModal]);

  // Add event listeners
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousemove', updateMousePosition);
    document.addEventListener('wheel', handleWheel, { passive: false, capture: false });
    document.addEventListener('pointerdown', handlePointerDown, true);
    const handleFocusIn = (e) => {
      if (!isTopmostModal()) return;
      const stackSnapshot = (() => {
        try { return [...(useModalStore.getState().stack || [])]; } catch { return []; }
      })();
      const inModal = modalRef.current ? modalRef.current.contains(e.target) : false;
      // Post-focus snapshot to see where focus landed after other handlers
      setTimeout(() => {
        const active = document.activeElement;
      }, 0);
      // If topmost but focus landed outside, try a single redirect to the last forced target
      if (!inModal && modalRef.current && lastForcedFocusTargetRef.current) {
        const target = modalRef.current.contains(lastForcedFocusTargetRef.current) ? lastForcedFocusTargetRef.current : null;
        lastForcedFocusTargetRef.current = null; // only once
        if (target) {
          setTimeout(() => {
            if (!document.contains(target)) return;
            try {
              target.focus({ preventScroll: true });
            } catch {
              try { target.focus(); } catch {}
            }
          }, 0);
        }
      }
    };
    const handleFocusOut = (e) => {
      if (!isTopmostModal()) return;
      setTimeout(() => {
        const active = document.activeElement;
      }, 0);
    };
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    
    // Delay click handler registration to prevent catching the opening click
    const clickTimeout = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 100);
    return () => {
      clearTimeout(clickTimeout);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mousemove', updateMousePosition);
      document.removeEventListener('wheel', handleWheel, false);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
    };
  }, [isOpen, handleKeyDown, handleWheel, handleClick, updateMousePosition, handlePointerDown]);

  // Handle browser back button to close modal on mobile
  // Only handle for topmost modal to prevent conflicts
  const historyStatePushedRef = useRef(false);
  const wasClosedByBackButtonRef = useRef(false);
  const originalUrlRef = useRef(window.location.href);
  const isCleaningUpRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const isTopmostModalRef = useRef(isTopmostModal);

  // Keep refs updated
  useEffect(() => {
    onCloseRef.current = onClose;
    isTopmostModalRef.current = isTopmostModal;
  }, [onClose, isTopmostModal]);

  useEffect(() => {
    // Only handle if modal is open and enabled
    if (!isOpen || !enableBackButton) {
      return;
    }

    // Only handle if this is the topmost modal
    if (!isTopmostModalRef.current()) {
      return;
    }

    // Store the original URL when modal opens
    originalUrlRef.current = window.location.href;
    
    // Use modalId-based state key or custom one
    const stateKey = backButtonStateKey || `${modalId}Open`;
    
    // Push or update history state when modal opens to enable back button handling
    if (!historyStatePushedRef.current) {
      try {
        window.history.pushState({ [stateKey]: true }, '', window.location.href);
        historyStatePushedRef.current = true;
        wasClosedByBackButtonRef.current = false;
      } catch (e) {
        console.warn('Failed to push history state for modal:', e);
      }
    } else {
      // History state already exists (modal state changed but still open)
      // Just update the state without pushing a new entry
      try {
        window.history.replaceState({ [stateKey]: true }, '', window.location.href);
      } catch (e) {
        console.warn('Failed to update history state for modal:', e);
      }
    }

    const handlePopState = (event) => {
      // Don't handle popstate if we're in the middle of cleanup
      if (isCleaningUpRef.current) {
        return;
      }
      
      // Only handle if this is still the topmost modal
      if (!isTopmostModalRef.current()) {
        return;
      }
      
      // If we pushed a state and back button is pressed, close the modal
      if (historyStatePushedRef.current) {
        wasClosedByBackButtonRef.current = true;
        // Close the modal instead of navigating
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      // Don't run cleanup if we never actually pushed a state
      if (!historyStatePushedRef.current) {
        return;
      }
      
      // Mark that we're cleaning up to prevent popstate handler from running
      isCleaningUpRef.current = true;
      
      window.removeEventListener('popstate', handlePopState);
      
      // Clean up: if modal closes normally (not via back button), remove our history entry
      if (!wasClosedByBackButtonRef.current) {
        try {
          const currentUrl = window.location.href;
          const stateKey = backButtonStateKey || `${modalId}Open`;
          const hasModalState = window.history.state?.[stateKey];
          
          if (currentUrl === originalUrlRef.current && hasModalState) {
            // Remove our history entry by going back
            setTimeout(() => {
              // Only go back if we're still cleaning up (component unmounted)
              if (!isCleaningUpRef.current) {
                return;
              }
              
              const stillOnSameUrl = window.location.href === originalUrlRef.current;
              const stillHasState = window.history.state?.[stateKey];
              
              if (stillOnSameUrl && stillHasState && isCleaningUpRef.current) {
                window.history.back();
              }
            }, 150);
          }
        } catch (e) {
          console.error('Error during modal history cleanup:', e);
        }
      }
      
      // Reset flags for next time modal opens
      historyStatePushedRef.current = false;
      wasClosedByBackButtonRef.current = false;
      isCleaningUpRef.current = false;
    };
  }, [isOpen, enableBackButton, modalId, backButtonStateKey]);

  return {
    modalRef,
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




