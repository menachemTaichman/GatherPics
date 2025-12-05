import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, Lock, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { authAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/authContext';
import { useNavigate } from 'react-router-dom';
import jwtService from '../../utils/jwtService';

export default function ResetPasswordModal({ isOpen, onClose, token }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [label, setLabel] = useState('');
  const [labelLoading, setLabelLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState(true);
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const navigate = useNavigate();
  const MODAL_ID = 'reset-password-modal';

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

  // Fetch label when modal opens with token
  useEffect(() => {
    if (isOpen && token) {
      setLabelLoading(true);
      setTokenValid(true);
      const fetchLabel = async () => {
        try {
          const response = await authAPI.validateResetToken(token);
          if (response.success && response.label) {
            setLabel(response.label);
            setTokenValid(true);
          } else {
            setTokenValid(false);
          }
        } catch (error) {
          console.error('Failed to validate token:', error);
          setTokenValid(false);
        } finally {
          setLabelLoading(false);
        }
      };
      fetchLabel();
    } else if (isOpen && !token) {
      setTokenValid(false);
      setLabelLoading(false);
    } else if (!isOpen) {
      setLabel('');
      setLabelLoading(false);
      setTokenValid(true);
    }
  }, [isOpen, token]);

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

  const handleReset = async () => {
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
    
    if (!token) {
      setError('Reset token is missing');
      showToast('Reset token is missing', 'error');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await authAPI.resetPassword(token, newPassword);
      setSuccess(true);
      showToast('Password reset successfully', 'success');
      
      // Refresh token to get new access token
      try {
        await jwtService.refresh();
        // Trigger auth:login event to update auth state
        window.dispatchEvent(new CustomEvent('auth:login'));
      } catch (error) {
        console.error('Failed to refresh token after password reset:', error);
      }
      
      // Close modal and redirect to home after a short delay
      setTimeout(() => {
        handleClose();
        navigate('/');
      }, 1500);
    } catch (error) {
      console.error('Failed to reset password:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to reset password';
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
    setSuccess(false);
    setLabel('');
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
                <h2 className="text-xl font-semibold text-gray-900">Reset Password</h2>
                <p className="text-sm text-gray-500">Enter your new password</p>
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
            {success ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Password Reset Successful</h3>
                <p className="text-sm text-gray-600">Your password has been reset. Redirecting...</p>
              </div>
            ) : labelLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Loading...</p>
              </div>
            ) : !tokenValid ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Invalid or Expired Link</h3>
                <p className="text-sm text-gray-600">
                  This password reset link is invalid or has expired. Please request a new password reset link.
                </p>
              </div>
            ) : (
              <div>
                <form onSubmit={(e) => { e.preventDefault(); handleReset(); }} autoComplete="off">
                  {/* Hidden username field for Chrome password saving */}
                  <input type="text" name="username" autoComplete="username" value={label || ''} readOnly style={{ display: 'none' }} />
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
                        className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter new password"
                        autoFocus
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
                          if (e.key === 'Enter' && !loading && newPassword?.trim() && confirmPassword?.trim()) {
                            e.preventDefault();
                            handleReset();
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
                  <div className="mt-4 flex items-center space-x-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {!success && !labelLoading && tokenValid && (
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
              <button
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={loading || !newPassword?.trim() || !confirmPassword?.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <span>Reset Password</span>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

