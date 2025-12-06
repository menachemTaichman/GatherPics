import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';

/**
 * Compact confirmation modal for delete actions
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Callback when modal closes
 * @param {function} onConfirm - Callback when delete is confirmed
 * @param {string} title - Modal title (default: "Delete Confirmation")
 * @param {string} message - Confirmation message
 * @param {string} itemName - Name of item to delete (displayed in bold)
 * @param {string} confirmText - Text for confirm button (default: "Delete")
 * @param {string} cancelText - Text for cancel button (default: "Cancel")
 * @param {string} imageUrl - Optional representative image URL
 * @param {string} imageAlt - Alt text for image
 * @param {string} caption - Optional caption/note to display
 * @param {Array} images - Optional array of image objects with 'src' property (shows grid, max 3, with +X on third if more)
 * @param {boolean} simpleMessage - If true, displays message as-is without quotes/bold formatting
 */
function ConfirmDelete({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = "Delete Confirmation",
  message = "Are you sure you want to delete",
  itemName = "this item",
  confirmText = "Delete",
  cancelText = "Cancel",
  imageUrl = null,
  imageAlt = "",
  caption = null,
  images = null,
  simpleMessage = false
}) {
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const MODAL_ID = useState(() => `confirm-delete-${Math.random().toString(36).substr(2, 9)}`)[0];
  
  // Use translations if default values are used
  const displayTitle = title === "Delete Confirmation" ? t('confirmDelete.deleteConfirmation') : title;
  const displayMessage = message === "Are you sure you want to delete" ? t('confirmDelete.areYouSure') : message;
  const displayItemName = itemName === "this item" ? t('confirmDelete.thisItem') : itemName;
  const displayConfirmText = confirmText === "Delete" ? t('confirmDelete.delete') : confirmText;
  const displayCancelText = cancelText === "Cancel" ? t('confirmDelete.cancel') : cancelText;
  
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };
  
  // Custom keyboard handler for Enter key
  const handleConfirmDeleteKeys = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
      return true; // Mark as handled
    }
    return false; // Not handled
  };
  
  // Use modal focus hook with background scroll allowed
  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleConfirmDeleteKeys,
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID
  });

  // Register modal with modal manager
  useEffect(() => {
    if (!isOpen) return;
    
    const { registerModal, unregisterModal } = useModalStore.getState();
    try {
      registerModal({ 
        id: MODAL_ID, 
        type: 'popup', 
        scopes: [], 
        allowOutsideScroll: true 
      });
    } catch {}
    
    // Listen for logout to auto-close modal
    const handleAuthLogout = () => {
      onClose();
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    
    return () => {
      try { 
        unregisterModal(MODAL_ID); 
      } catch {}
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [isOpen, MODAL_ID]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
        <motion.div 
          ref={modalRef}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h3 className="text-lg font-semibold text-gray-900">{displayTitle}</h3>
            </div>
            <button 
              onClick={onClose} 
              className="w-8 h-8 rounded-lg transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
              title={t('confirmDelete.close')}
              aria-label={t('confirmDelete.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Image grid (if provided) */}
            {images && images.length > 0 && (
              <div className="mb-4">
                <div className="flex gap-2 justify-center">
                  {images.slice(0, 3).map((image, index) => (
                    <div key={index} className="relative">
                      <img
                        src={image.src}
                        alt={image.alt || `Image ${index + 1}`}
                        className="w-24 h-24 rounded-lg object-cover border-2 border-gray-200"
                      />
                      {/* Show +X overlay on third image if there are more than 3 */}
                      {index === 2 && images.length > 3 && (
                        <div className="absolute inset-0 bg-black bg-opacity-60 rounded-lg flex items-center justify-center">
                          <span className="text-white text-xl font-semibold">
                            +{images.length - 3}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-4">
              {/* Optional single representative image (legacy) */}
              {!images && imageUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={imageUrl}
                    alt={imageAlt}
                    className="w-16 h-16 rounded-lg object-cover border"
                  />
                </div>
              )}
              
              {/* Message */}
              <div className="flex-1">
                {simpleMessage ? (
                  <p className="text-gray-700">{displayMessage}</p>
                ) : (
                  <p className="text-gray-700">
                    {displayMessage} <span className="font-semibold text-gray-900">"{displayItemName}"</span>?
                  </p>
                )}
                {caption && (
                  <p className="text-sm text-gray-500 mt-2">
                    {caption}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-gray-50 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {displayCancelText}
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              autoFocus
            >
              {displayConfirmText}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default ConfirmDelete;




