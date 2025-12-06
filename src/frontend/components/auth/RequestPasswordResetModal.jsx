import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useRTL } from '../../hooks/useRTL';
import { authAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';

export default function RequestPasswordResetModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  const { isRTL, startClass } = useRTL();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = 'request-password-reset-modal';

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

  // Custom keyboard handler
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!email || !email.trim()) {
      setError(t('requestPasswordReset.emailIsRequired'));
      return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError(t('requestPasswordReset.pleaseEnterAValidEmailAddress'));
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await authAPI.requestPasswordReset(email.trim());
      setSuccess(true);
    } catch (error) {
      console.error('Failed to request password reset:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to request password reset';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setError('');
    setSuccess(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
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
                <h2 className="text-xl font-semibold text-gray-900">{t('requestPasswordReset.resetPassword')}</h2>
                <p className="text-sm text-gray-500">{t('requestPasswordReset.requestAPasswordResetLink')}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label={t('auth.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            {success ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('requestPasswordReset.emailSent')}</h3>
                <p className="text-sm text-gray-600 mb-4">
                  {t('requestPasswordReset.ifAnAccountWithThatEmailExists')}
                </p>
                <p className="text-xs text-gray-500">
                  {t('requestPasswordReset.theLinkWillExpireIn10Minutes')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('requestPasswordReset.emailAddress')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className={`absolute ${startClass('3')} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !loading && email?.trim()) {
                          handleSubmit(e);
                        }
                      }}
                      className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all`}
                      placeholder={t('requestPasswordReset.enterYourEmailAddress')}
                      autoFocus
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {t('requestPasswordReset.enterTheEmailAddressAssociatedWithYourProfile')}
                  </p>
                </div>

                {error && (
                  <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </form>
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
                {t('requestPasswordReset.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !email?.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('requestPasswordReset.sending')}</span>
                  </>
                ) : (
                  <span>{t('requestPasswordReset.sendResetLink')}</span>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

