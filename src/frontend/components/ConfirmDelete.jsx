import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useModalFocus } from '../utils/useModalFocus';
import { useModalStore } from '../utils/modalManager';

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
  caption = null
}) {
  const MODAL_ID = useState(() => `confirm-delete-${Math.random().toString(36).substr(2, 9)}`)[0];
  
  // Use modal focus hook with background scroll allowed
  const { modalRef } = useModalFocus(isOpen, onClose, {
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
    
    return () => {
      try { 
        unregisterModal(MODAL_ID); 
      } catch {}
    };
  }, [isOpen, MODAL_ID]);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

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
        >
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            </div>
            <button 
              onClick={onClose} 
              className="w-8 h-8 rounded-lg transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="flex items-start space-x-4">
              {/* Optional representative image */}
              {imageUrl && (
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
                <p className="text-gray-700">
                  {message} <span className="font-semibold text-gray-900">"{itemName}"</span>?
                </p>
                {caption && (
                  <p className="text-sm text-gray-500 mt-2">
                    {caption}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-gray-50 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              autoFocus
            >
              {confirmText}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default ConfirmDelete;

