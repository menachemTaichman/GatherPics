import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
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
  const { t } = useTranslation();
  const { isRTL } = useRTL();
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
        is_closed: true,
        solved: Boolean(solved),
        closed_details: closeDetails.trim() || null
      });
      
      showToast(solved ? t('closeFeedback.feedbackResolved') : t('closeFeedback.feedbackClosed'), 'success');
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
    
    // Handle button elements - prevent Enter from triggering toggle buttons, route to save instead
    if (targetTagName === 'button') {
      // Check if this is the save button using data attribute
      const isSaveButton = e.target.dataset?.isSaveButton === 'true';
      
      // Allow save button to work normally
      if (isSaveButton && e.key === 'Enter') {
        return false; // Let the button's onClick handle it
      }
      // For other buttons (like toggles), prevent Enter from triggering them
      // Instead, trigger close feedback if conditions are met
      if (e.key === 'Enter' && !loading) {
        e.preventDefault();
        e.stopPropagation();
        handleCloseFeedback();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // For other keys on buttons, allow default behavior
      return true;
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // Enter submits the form (except in textarea where it adds newline)
      if (e.key === 'Enter' && targetTagName !== 'textarea') {
        if (!loading) {
          e.preventDefault();
          e.stopPropagation();
          handleCloseFeedback();
        }
        return true; // Handled
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
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
        dir={isRTL ? 'rtl' : 'ltr'}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('closeFeedback.closeFeedback')}</h3>
        
        <div className="space-y-4 mb-6">
          <p className="text-gray-700">{t('closeFeedback.closeThisFeedbackWithOptionalNotes')}</p>
          
          <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3">
            <div>
              <p className="font-medium text-gray-900">{t('closeFeedback.markAsSolved')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (loading) return;
                setSolved(!solved);
              }}
              disabled={loading}
              className={`w-10 h-6 rounded-full relative transition-colors ${solved ? 'bg-green-600' : 'bg-gray-300'} ${loading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              aria-pressed={solved}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${solved ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('closeFeedback.closureDetailsOptional')}
            </label>
            <textarea
              value={closeDetails}
              onChange={(e) => setCloseDetails(e.target.value)}
              dir={isRTL ? 'rtl' : 'ltr'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              placeholder={t('closeFeedback.addClosureDetailsAboutThisFeedback')}
              rows={3}
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
            disabled={loading}
            title={t('closeFeedback.cancel')}
            aria-label={t('closeFeedback.cancel')}
          >
            {t('closeFeedback.cancel')}
          </button>
          <button
            type="button"
            data-is-save-button="true"
            onClick={handleCloseFeedback}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            title={t('closeFeedback.closeFeedback')}
            aria-label={t('closeFeedback.closeFeedback')}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{t('closeFeedback.closing')}</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>{t('closeFeedback.closeFeedback')}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

