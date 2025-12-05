import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { profilesAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile } from '../../utils/profileService';
import RequestPasswordResetModal from '../auth/RequestPasswordResetModal';

export default function ChangePasswordModal({ isOpen, onClose, eventUrl }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = 'change-password-modal';
  const currentProfile = isOpen ? getCurrentProfile() : null;
  const profileLabel = currentProfile?.label || 'Profile';

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: MODAL_ID, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: []
      });
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(MODAL_ID);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Custom keyboard handler - allow normal input behavior
  const handleModalKeys = (e) => {
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    // For non-input elements, return false to allow default modal behavior (ESC to close)
    return false;
  };

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: MODAL_ID,
    modalType: 'popup',
    customKeyHandler: handleModalKeys
  });

  const handleSave = async () => {
    // Validate all fields
    if (!currentPassword || !currentPassword.trim()) {
      setError('Current password is required');
      showToast('Current password is required', 'error');
      return;
    }
    
    if (!newPassword || !newPassword.trim()) {
      setError('New password is required');
      showToast('New password is required', 'error');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      showToast('New passwords do not match', 'error');
      return;
    }
    
    if (currentPassword === newPassword) {
      setError('New password must be different from current password');
      showToast('New password must be different from current password', 'error');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await profilesAPI.updateCurrentProfilePassword(currentPassword, newPassword, eventUrl);
      showToast('Password updated successfully', 'success');
      onClose();
    } catch (error) {
      console.error('Failed to update password:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to update password';
      
      // Check if this is the "Label with this password already exists" error
      if (errorMsg.includes('Label with this password already exists')) {
        setError('Name and password combination already exists');
      } else if (errorMsg.includes('Current password') || errorMsg.includes('incorrect')) {
        setError('Current password is incorrect');
      } else {
        setError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
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
                <p className="text-sm text-gray-500">{profileLabel || 'Profile'}</p>
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
            <div>
              <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} autoComplete="off">
                <input type="text" name="username" autoComplete="username" value={profileLabel || ''} readOnly style={{ display: 'none' }} />
                
                {/* Current Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      name="current-password"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setError('');
                      }}
                      className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter current password"
                      autoFocus
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                      title={showCurrentPassword ? 'Hide password' : 'Show password'}
                    >
                      {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetModal(true);
                      handleClose();
                    }}
                    className="mt-2 text-sm text-blue-600 hover:text-blue-700 text-left"
                  >
                    Forgot password or need to set one up?
                  </button>
                </div>

                {/* New Password */}
                <div className="mt-7">
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
                      className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter new password"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                      title={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="mt-7">
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
                        if (e.key === 'Enter' && !loading && currentPassword?.trim() && newPassword?.trim() && confirmPassword?.trim()) {
                          e.preventDefault();
                          handleSave();
                        }
                      }}
                      className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </form>

              {error && (
                <div className="flex items-center space-x-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
            <button
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || !currentPassword?.trim() || !newPassword?.trim() || !confirmPassword?.trim()}
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
      
      <RequestPasswordResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
      />
    </AnimatePresence>
  );
}




