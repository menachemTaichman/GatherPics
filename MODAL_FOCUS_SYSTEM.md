# Modal Focus Management System

## Overview

This project now includes a comprehensive modal focus management system that ensures all user interactions are properly contained within open modals, while allowing specific exceptions for enhanced user experience.

## Features

### ✅ Focus Trapping
- All keyboard interactions are captured by the active modal
- Tab/Shift+Tab cycles through focusable elements within the modal only
- Focus is restored to the original element when modal closes

### ✅ Smart Scrolling
- **Inside Modal**: Normal scrolling behavior is preserved
- **Outside Modal**: Scrolling is allowed only when mouse cursor is outside modal boundaries
- **Background**: All other scrolling is prevented

### ✅ Keyboard Event Management
- **ESC Key**: Always closes the modal
- **Custom Keys**: Each modal can define its own keyboard shortcuts
- **Background Prevention**: All other keys are prevented from affecting background elements

### ✅ Click Outside Behavior
- Clicking outside modal boundaries closes the modal
- Internal clicks are handled normally

## Implementation

### Hook Usage

```javascript
import { useModalFocus } from '../utils/useModalFocus';

export default function MyModal({ isOpen, onClose }) {
  // Custom keyboard handler (optional)
  const handleCustomKeys = (e) => {
    if (e.key === 'Enter') {
      // Handle Enter key
      return true; // Mark as handled
    }
    return false; // Not handled, let default behavior continue
  };

  // Use the hook
  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleCustomKeys,
    allowOutsideScroll: true, // Default: true
    enableFocusTrapping: true, // Default: true
    preventBackgroundScroll: true // Default: true
  });

  return (
    <div className="modal-overlay">
      <div ref={modalRef} className="modal-content" tabIndex={-1}>
        {/* Modal content */}
      </div>
    </div>
  );
}
```

### Higher-Order Component Usage

```javascript
import { withModalFocus } from '../utils/useModalFocus';

function MyModal({ modalRef, ...props }) {
  return (
    <div className="modal-overlay">
      <div ref={modalRef} className="modal-content" tabIndex={-1}>
        {/* Modal content */}
      </div>
    </div>
  );
}

export default withModalFocus(MyModal, {
  allowOutsideScroll: true
});
```

## Current Implementation

The following components have been updated to use the new modal focus system:

1. **PhotoViewer** - Handles photo navigation shortcuts (arrows, zoom, etc.)
2. **TransferFacesModal** - Handles Enter key for transfer submission
3. **EditGroupModal** - Handles Enter key for form submission, special handling for name editing
4. **MergeConflictModal** - Handles Enter key for merge confirmation

## Key Benefits

### 🎯 User Experience
- **Intuitive**: Users can scroll when mouse is outside modal (expected behavior)
- **Contained**: All other interactions stay within the modal context
- **Consistent**: Same behavior across all modals

### 🔒 Focus Management
- **Accessible**: Proper focus trapping for screen readers
- **Keyboard Navigation**: Tab cycles within modal only
- **State Restoration**: Focus returns to original element on close

### 🚀 Performance
- **Efficient**: Single event listener system with smart delegation
- **Memory Safe**: Automatic cleanup on unmount
- **Minimal Overhead**: Uses React refs and effects efficiently

## Customization Options

### Custom Key Handlers
Each modal can define specific keyboard shortcuts while maintaining the base modal behavior:

```javascript
const handlePhotoViewerKeys = (e) => {
  switch (e.key) {
    case 'ArrowLeft':
      navigatePrevious();
      return true; // Handled
    case 'ArrowRight':
      navigateNext();
      return true; // Handled
    case '+':
      zoomIn();
      return true; // Handled
  }
  return false; // Not handled
};
```

### Scroll Behavior
- `allowOutsideScroll: true` - Allows scrolling when mouse is outside modal
- `allowOutsideScroll: false` - Prevents all background scrolling

### Focus Behavior
- `enableFocusTrapping: true` - Enables focus trapping within modal
- `enableFocusTrapping: false` - Disables focus management (not recommended)

## Edge Cases Handled

1. **Mouse Outside Detection**: Real-time tracking of mouse position relative to modal bounds
2. **Dynamic Content**: Works with modals that change size or content
3. **Nested Modals**: Each modal manages its own focus context
4. **Input Fields**: Special handling for form inputs that need their own key events
5. **Cleanup**: Proper removal of event listeners on unmount

## Migration Guide

To migrate existing modals to use this system:

1. Import the hook: `import { useModalFocus } from '../utils/useModalFocus';`
2. Add the hook call with appropriate options
3. Apply `modalRef` to your modal container element
4. Add `tabIndex={-1}` to make the modal focusable
5. Remove old event listeners for keyboard/click handling
6. Define custom key handlers if needed

This system eliminates the need for duplicate modal management code while providing a consistent, accessible, and user-friendly modal experience across the entire application.
