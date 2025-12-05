import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { feedbacksAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useFeedbackById } from '../../utils/dataManager';

export default function CloseFeedbackModal({ 
  isOpen, 
  onClose, 
  feedbackId 
}) {
  const [loading, setLoading] = useState(false);
  const [closeDetails, setCloseDetails] = useState('');
  const [solved, setSolved] = useState(false);
  
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'close-feedback-modal';
  
  // Get feedback from store
  const feedback = useFeedbackById(feedbackId);

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'popup', allowOutsideScroll: true });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCloseDetails('');
      setSolved(false);
    }
  }, [isOpen]);

  const handleCloseFeedback = useCallback(async () => {
    setLoading(true);
    try {
      await feedbacksAPI.update(feedbackId, {
        is_closed: Boolean(1),
        solved: Boolean(solved),
        closed_details: closeDetails.trim() || null
      });
      
      showToast(`Feedback ${solved ? 'resolved' : 'closed'}`, 'success');
      onClose(true); // Pass true to indicate success
    } catch (error) {
      console.error('Failed to close feedback:', error);
      showToast(formatErrorMessage('close feedback', error), 'error');
    } finally {
      setLoading(false);
    }
  }, [feedbackId, solved, closeDetails, showToast, onClose]);

  // Custom keyboard handler to allow input elements
  const handleCloseModalKeys = useCallback((e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // ESC always closes the modal
    if (e.key === 'Escape') {
      if (!loading) {
        onClose(false);
      }
      return true; // Handled
    }
    
    // Enter submits the form (except in textarea where it adds newline)
    if (e.key === 'Enter' && targetTagName !== 'textarea') {
      if (!loading) {
        e.preventDefault();
        handleCloseFeedback();
      }
      return true; // Handled
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it
    }
    
    return false; // Not handled
  }, [loading, onClose, handleCloseFeedback]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleCloseModalKeys
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <motion.div
        ref={modalRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Close Feedback</h3>
        
        <div className="space-y-4 mb-6">
          <p className="text-gray-700">Close this feedback with optional notes.</p>
          
          <div>
            <label className={`relative inline-flex items-center ${loading ? 'cursor-not-allowed' : 'cursor-pointer'} select-none`}>
              <input
                type="checkbox"
                checked={solved}
                onChange={(e) => setSolved(e.target.checked)}
                disabled={loading}
                className="sr-only peer"
              />
              <div className={`w-10 h-5 ${loading ? 'bg-gray-300' : 'bg-gray-200'} peer-focus:outline-none rounded-full peer-checked:bg-green-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:border-white`}></div>
              <span className={`ml-3 text-sm font-medium ${loading ? 'text-gray-400' : 'text-gray-700'}`}>
                Mark as solved
              </span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Closure Details (optional)
            </label>
            <textarea
              value={closeDetails}
              onChange={(e) => setCloseDetails(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              placeholder="Add closure details about this feedback to be shown to the user..."
              rows={3}
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={() => onClose(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleCloseFeedback}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 flex items-center space-x-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Closing...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Close Feedback</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

