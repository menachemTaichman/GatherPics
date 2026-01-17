import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useRTL } from '../../hooks/useRTL';
import { profilesAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { LongPressHoverButton } from '../common';

export default function EmailVerificationModal({ isOpen, onClose, newEmail }) {
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = 'email-verification-modal';

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: MODAL_ID, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: []
      });
      
      return () => {
        unregisterModal(MODAL_ID);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setVerificationCode('');
      setError('');
      setSuccess(false);
      setLoading(false);
    }
  }, [isOpen]);

  // Custom keyboard handler - allow normal input behavior
  const handleModalKeys = (e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      if (e.key === 'Escape') {
        return false;
      }
      return true;
    }
    return false;
  };

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: MODAL_ID,
    modalType: 'popup',
    customKeyHandler: handleModalKeys
  });

  const handleVerify = async () => {
    if (!verificationCode || !verificationCode.trim()) {
      const errorMsg = t('emailVerification.verificationCodeIsRequired');
      setError(errorMsg);
      showToast(errorMsg, 'error');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await profilesAPI.verifyEmail(verificationCode.trim());
      setSuccess(true);
      showToast(t('emailVerification.emailVerifiedSuccessfully'), 'success');
      
      // Close modal after a short delay
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (error) {
      console.error('Failed to verify email:', error);
      const errorMsg = error.response?.data?.error || error.message || t('emailVerification.failedToVerifyEmail');
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setVerificationCode('');
    setError('');
    setSuccess(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-md"
          dir={isRTL ? 'rtl' : 'ltr'}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{t('emailVerification.verifyEmail')}</h2>
                <p className="text-sm text-gray-500">{t('emailVerification.enterVerificationCode')}</p>
              </div>
            </div>
            <LongPressHoverButton
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label={t('auth.close')}
            >
              <X className="w-5 h-5" />
            </LongPressHoverButton>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            {success ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('emailVerification.emailVerifiedSuccessfully')}</h3>
                <p className="text-sm text-gray-600">{t('emailVerification.yourEmailHasBeenUpdated')}</p>
              </div>
            ) : (
              <div>
                <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} autoComplete="off">
                  {/* Email info */}
                  {newEmail && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{t('emailVerification.verificationCodeSentTo')}:</span> {newEmail}
                      </p>
                    </div>
                  )}

                  {/* Verification Code */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('emailVerification.verificationCode')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="verification-code"
                      value={verificationCode}
                      onChange={(e) => {
                        // Only allow digits, max 6 characters
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setVerificationCode(value);
                        setError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !loading && verificationCode?.trim()) {
                          e.preventDefault();
                          handleVerify();
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-2xl tracking-widest font-mono"
                      placeholder="000000"
                      maxLength={6}
                      autoFocus
                      autoComplete="off"
                      required
                    />
                    <p className="mt-2 text-xs text-gray-500">{t('emailVerification.codeExpiresIn10Minutes')}</p>
                  </div>
                </form>

                {error && (
                  <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {!success && (
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('emailVerification.cancel')}
              </button>
              <button
                onClick={handleVerify}
                disabled={loading || !verificationCode?.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('emailVerification.verifying')}</span>
                  </>
                ) : (
                  <span>{t('emailVerification.verifyEmailButton')}</span>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
