import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { profilesAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { formatErrorMessage } from '../../utils/errorHandler';

export default function PublicProfilePasswordModal({ isOpen, onClose, profileId, profileLabel, eventUrl }) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();
  const MODAL_ID = 'public-profile-password-modal';

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      const { registerModal, unregisterModal } = useModalStore.getState();
      try {
        registerModal({ 
          id: MODAL_ID, 
          type: 'popup',
          allowOutsideScroll: true 
        });
      } catch {}
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
      };
    }
  }, [isOpen]);

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

  const handleSave = async () => {
    if (!newPassword || !newPassword.trim()) {
      setError('New password is required');
      showToast('New password is required', 'error');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      showToast('Passwords do not match', 'error');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Use profilesAPI.update to update password (only allowed for public profiles)
      const targetEventUrl = eventUrl || null;
      await profilesAPI.update(profileId, { password: newPassword }, targetEventUrl);
      showToast('Password updated successfully', 'success');
      handleClose();
    } catch (error) {
      console.error('Failed to update password:', error);
      const errorMsg = formatErrorMessage('update password', error);
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError('');
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
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Lock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Change Password</h2>
                <p className="text-sm text-gray-500">{profileLabel || 'Public Profile'}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} autoComplete="off">
              {/* New Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    name="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setError('');
                    }}
                    tabIndex={1}
                    className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter new password"
                    autoFocus
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                    title={showNewPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-label={showNewPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm New Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirm-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !loading && newPassword?.trim() && confirmPassword?.trim()) {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                    tabIndex={2}
                    className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                    title={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </form>

            {error && (
              <div className="mt-4 flex items-center space-x-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              tabIndex={3}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || !newPassword?.trim() || !confirmPassword?.trim()}
              tabIndex={4}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save</span>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

