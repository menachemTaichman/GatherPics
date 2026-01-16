import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { X, AlertTriangle, Calendar, Monitor, Wifi, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager, useModalStore } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { settingsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { formatDateTimeLocale } from '../../utils/dateUtils';
import { LongPressHoverButton } from '../common';

export default function ErrorDetailModal({ 
  isOpen, 
  onClose, 
  errorId,
  // Navigation props
  onNavigate = null,
  currentIndex = 0,
  totalErrors = 1,
  filteredErrors = []
}) {
  const [showTraceback, setShowTraceback] = useState(false);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'error-detail-modal';

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'popup', allowOutsideScroll: true });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Fetch settings to get error details when modal opens
  useEffect(() => {
    if (isOpen && errorId) {
      const fetchSettings = async () => {
        setLoading(true);
        try {
          const response = await settingsAPI.get();
          const errorsDict = response.settings?.errors || {};
          const error = errorsDict[errorId] || Object.values(errorsDict).find(e => e.error_id === errorId);
          
          if (error) {
            setSettings({ errors: { [errorId]: error } });
          }
        } catch (error) {
          console.error('Failed to load error:', error);
          showToast(formatErrorMessage(t('errorDetail.loadError'), error), 'error');
        } finally {
          setLoading(false);
        }
      };
      fetchSettings();
    }
  }, [isOpen, errorId, showToast]);

  // Get error from settings
  const error = useMemo(() => {
    if (!settings?.errors || !errorId) return null;
    const errorsDict = settings.errors || {};
    return errorsDict[errorId] || Object.values(errorsDict).find(e => e.error_id === errorId);
  }, [settings, errorId]);

  // Navigation handlers
  const handleNavigate = useCallback((direction) => {
    if (!onNavigate || totalErrors <= 1) return;
    
    if (direction === 'prev') {
      if (currentIndex === 0) {
        onNavigate('jump', totalErrors - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (currentIndex === totalErrors - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    }
  }, [onNavigate, currentIndex, totalErrors]);

  const { isTopModal } = useModalManager();

  // Check if this modal is the topmost modal
  const isTopmostModal = useCallback(() => {
    try {
      const { stack } = useModalStore.getState();
      if (stack.length === 0) return true;
      return isTopModal(modalId);
    } catch {
      return true;
    }
  }, [isTopModal, modalId]);

  // Custom keyboard handler
  const handleModalKeys = useCallback((e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // ESC handling - only if this is the topmost modal
    if (e.key === 'Escape') {
      if (isTopmostModal() && !loading) {
        onClose();
        return true;
      }
      // If not topmost, don't handle it - let the topmost modal handle it
      return false;
    }
    
    // Arrow keys for navigation (except when in input fields)
    if (targetTagName !== 'input' && targetTagName !== 'textarea' && targetTagName !== 'select') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigate('prev');
        return true;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigate('next');
        return true;
      }
    }
    
    return false;
  }, [loading, onClose, handleNavigate, isTopmostModal]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleModalKeys
  });


  if (!isOpen || !error) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        ref={modalRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        dir={isRTL ? 'rtl' : 'ltr'}
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              error.error_type === 'DatabaseError' ? 'bg-red-100' :
              error.error_type === 'PolicyError' ? 'bg-orange-100' :
              error.error_type === 'Forbidden' ? 'bg-yellow-100' :
              'bg-gray-100'
            }`}>
              <AlertTriangle className={`w-5 h-5 ${
                error.error_type === 'DatabaseError' ? 'text-red-600' :
                error.error_type === 'PolicyError' ? 'text-orange-600' :
                error.error_type === 'Forbidden' ? 'text-yellow-600' :
                'text-gray-600'
              }`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <span>{t('errorDetail.error')} #{error.error_id}</span>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  error.error_type === 'DatabaseError' ? 'bg-red-100 text-red-700' :
                  error.error_type === 'PolicyError' ? 'bg-orange-100 text-orange-700' :
                  error.error_type === 'Forbidden' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {error.error_type}
                </span>
              </h2>
              <p className="text-sm text-gray-500">
                {formatDateTimeLocale(error.created_at)}
                {totalErrors > 1 && (
                  <span className={isRTL ? 'mr-2' : 'ml-2'}>• {currentIndex + 1} {t('errorDetail.of')} {totalErrors}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Navigation buttons */}
            {totalErrors > 1 && onNavigate && (
              <>
                <LongPressHoverButton
                  onClick={() => handleNavigate('prev')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  title={t('errorDetail.previousError')}
                  aria-label={t('errorDetail.previousError')}
                >
                  <ChevronLeft className="w-5 h-5" />
                </LongPressHoverButton>
                <LongPressHoverButton
                  onClick={() => handleNavigate('next')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  title={t('errorDetail.nextError')}
                  aria-label={t('errorDetail.nextError')}
                >
                  <ChevronRight className="w-5 h-5" />
                </LongPressHoverButton>
              </>
            )}
            <LongPressHoverButton
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title={t('errorDetail.close')}
              aria-label={t('errorDetail.close')}
            >
              <X className="w-5 h-5" />
            </LongPressHoverButton>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error Message */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-700 mb-3">{t('errorDetail.errorMessage')}</h3>
            <p className="text-sm text-gray-900 whitespace-pre-wrap">{error.error_message}</p>
          </div>

          {/* Request Information */}
          {(error.request_path || error.request_method || error.user_agent || error.ip_address) && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('errorDetail.requestInformation')}</h3>
              <div className="space-y-2">
                {error.request_method && error.request_path && (
                  <div className="flex items-center gap-2 text-sm">
                    <Monitor className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-600">{t('errorDetail.request')}</span>
                    <span className="text-gray-900 font-mono">{error.request_method} {error.request_path}</span>
                  </div>
                )}
                {error.ip_address && (
                  <div className="flex items-center gap-2 text-sm">
                    <Wifi className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-600">{t('errorDetail.ip')}</span>
                    <span className="text-gray-900 font-mono">{error.ip_address}</span>
                  </div>
                )}
                {error.user_agent && (
                  <div className="flex items-start gap-2 text-sm">
                    <Monitor className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <span className="text-gray-600">{t('errorDetail.userAgent')}</span>
                      <p className="text-gray-900 font-mono text-xs leading-relaxed break-all mt-1">
                        {error.user_agent}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Traceback */}
          {error.traceback && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <button
                onClick={() => setShowTraceback(!showTraceback)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 hover:text-primary-600 transition-colors"
                title={t('errorDetail.traceback')}
                aria-label={t('errorDetail.traceback')}
              >
                <span>{t('errorDetail.traceback')}</span>
                {showTraceback ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              
              {showTraceback && (
                <pre className="mt-4 p-3 bg-white rounded text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {error.traceback}
                </pre>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
            disabled={loading}
            title={t('errorDetail.close')}
            aria-label={t('errorDetail.close')}
          >
            {t('errorDetail.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
