import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, MessageSquare, CheckCircle, Send } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { feedbacksAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { getCurrentProfile } from '../../utils/profileService';
import diagnosticsCapture from '../../utils/diagnosticsCapture';

export default function FeedbackFormModal({ 
  isOpen, 
  onClose,
  feedback = null
}) {
  const [formData, setFormData] = useState({
    sender_name: '',
    sender_email: '',
    title: '',
    type: 0, // 0 = bug, 1 = suggestion
    message: '',
    communication_consent: false,
    include_metadata: false
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdFeedbackId, setCreatedFeedbackId] = useState(null);
  
  const { showToast } = useToast();
  const currentProfile = useMemo(() => getCurrentProfile(), []);
  const currentProfileIsPublic = currentProfile?.is_public === 1;
  const currentProfileHasEmail = !!(currentProfile?.email);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'feedback-form-modal';

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'modal', allowOutsideScroll: false });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Initialize form with current profile data or editing feedback
  useEffect(() => {
    if (isOpen) {
      if (feedback) {
        // Editing mode
        setFormData({
          sender_name: feedback.sender_name || '',
          sender_email: feedback.sender_email || '',
          title: feedback.title || '',
          type: feedback.type || 0,
          message: feedback.message || '',
          communication_consent: feedback.communication_consent === 1,
          include_metadata: false
        });
      } else {
        // Creating mode
        setFormData({
          sender_name: currentProfileIsPublic ? '' : (currentProfile?.label || ''),
          sender_email: '',  // Never auto-fill email
          title: '',
          type: 0,
          message: '',
          communication_consent: false,
          include_metadata: false
        });
      }
      setSubmitted(false);
      setCreatedFeedbackId(null);
      
      // Start capturing diagnostics only when creating new
      if (!feedback) {
        diagnosticsCapture.startCapture();
      }
    } else {
      // Stop and clear diagnostics when modal closes
      diagnosticsCapture.stopCapture();
      diagnosticsCapture.clear();
    }
  }, [isOpen, currentProfile, currentProfileIsPublic, feedback]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'modal',
    allowOutsideScroll: false
  });

  const handleChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    // Validation
    if (!formData.title.trim()) {
      showToast('Please enter a title', 'error');
      return;
    }
    if (!formData.message.trim()) {
      showToast('Please enter your feedback message', 'error');
      return;
    }

    // Check if editing
    const isEditing = !!feedback;
    const feedbackId = feedback?.id || feedback?.feedback_id;

    setLoading(true);
    try {
      if (isEditing) {
        // Update existing feedback
        const updatePayload = {
          title: formData.title.trim(),
          type: formData.type,
          message: formData.message.trim(),
          communication_consent: formData.communication_consent ? 1 : 0,
        };

        await feedbacksAPI.updateMyFeedback(feedbackId, updatePayload);
        showToast('Feedback updated successfully!', 'success');
        onClose();
      } else {
        // Create new feedback
        const senderName = currentProfileIsPublic ? formData.sender_name.trim() : (currentProfile?.label || '');
        
        if (!senderName) {
          showToast('Please enter your name', 'error');
          setLoading(false);
          return;
        }

        const payload = {
          sender_name: senderName,
          sender_email: currentProfileHasEmail ? currentProfile.email : (formData.sender_email.trim() || null),
          title: formData.title.trim(),
          type: formData.type,
          message: formData.message.trim(),
          communication_consent: formData.communication_consent ? 1 : 0,
          include_metadata: formData.include_metadata
        };

        // Include diagnostics if metadata checkbox is checked
        if (formData.include_metadata) {
          const diagnostics = diagnosticsCapture.getDiagnostics();
          payload.console_logs = diagnostics.console_logs;
          payload.network_logs = diagnostics.network_logs;
          payload.browser_info = diagnostics.browser_info;
        }

        const result = await feedbacksAPI.create(payload);
        const newFeedbackId = result.feedback_id;
        
        showToast('Feedback sent successfully!', 'success');
        setSubmitted(true);
        setCreatedFeedbackId(newFeedbackId);
        
        // Auto-close after a longer delay to show ID
        setTimeout(() => {
          onClose();
        }, 5000);
      }
    } catch (error) {
      console.error('Failed to send feedback:', error);
      showToast(formatErrorMessage(isEditing ? 'update feedback' : 'send feedback', error), 'error');
    } finally {
      setLoading(false);
    }
  }, [formData, currentProfileIsPublic, currentProfileHasEmail, currentProfile, feedback, showToast, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Check if editing
  const isEditing = !!feedback;
  const isClosed = feedback?.is_closed === 1;
  const isViewOnly = isEditing && isClosed;
  
  // Show name field only for public profiles (and only when creating)
  const shouldShowNameField = currentProfileIsPublic && !isEditing;
  
  // Show email field only for public profiles (and only when creating)
  const shouldShowEmailField = currentProfileIsPublic && !isEditing;
  
  // Show communication consent when there's an email to send (and not viewing)
  const shouldShowCommunicationConsent = !isViewOnly && (currentProfileHasEmail || (currentProfileIsPublic && !!formData.sender_email.trim()));
  
  // Check if form is valid for submission
  const senderName = currentProfileIsPublic ? formData.sender_name.trim() : (currentProfile?.label || '');
  const isFormValid = (isEditing || !!senderName) && !!formData.title.trim() && !!formData.message.trim();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {submitted ? 'Thank You!' : isViewOnly ? 'View Feedback' : isEditing ? 'Edit Feedback' : 'Send Feedback'}
              </h2>
              <p className="text-sm text-gray-500">
                {submitted ? 'Your feedback has been received' : isViewOnly ? 'Feedback details' : isEditing ? 'Update your feedback' : 'Help us improve'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-8"
            >
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <p className="text-lg text-gray-700 mb-2">Feedback Sent Successfully!</p>
              <p className="text-sm text-gray-500 mb-3">Thank you for helping us improve.</p>
              {createdFeedbackId && currentProfileIsPublic && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4 inline-block">
                  <p className="text-xs text-blue-600 mb-1">Your Feedback ID for follow-up:</p>
                  <p className="text-xl font-mono font-bold text-blue-900">#{createdFeedbackId}</p>
                </div>
              )}
            </motion.div>
          ) : (
            <div className="space-y-4">
              {/* Name (only for public profiles) */}
              {shouldShowNameField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={formData.sender_name}
                      onChange={(e) => handleChange('sender_name', e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Enter your name"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              {/* Email (only for public profiles) */}
              {shouldShowEmailField && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-gray-500">(optional)</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={formData.sender_email}
                      onChange={(e) => handleChange('sender_email', e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="your.email@example.com"
                      disabled={loading}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Provide your email if you'd like us to follow up
                  </p>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-700"
                  placeholder="Brief summary of your feedback"
                  disabled={loading || isViewOnly}
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="text-red-500">*</span>
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      value="0"
                      checked={formData.type === 0}
                      onChange={(e) => handleChange('type', 0)}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                      disabled={loading || isViewOnly}
                    />
                    <span className="ml-2 text-sm text-gray-700">Bug Report</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      value="1"
                      checked={formData.type === 1}
                      onChange={(e) => handleChange('type', 1)}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                      disabled={loading || isViewOnly}
                    />
                    <span className="ml-2 text-sm text-gray-700">Suggestion</span>
                  </label>
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Feedback <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => handleChange('message', e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-700"
                  placeholder="Tell us what you think... (bug reports, feature requests, general feedback)"
                  rows={6}
                  disabled={loading || isViewOnly}
                />
                {!isViewOnly && (
                  <p className="text-xs text-gray-500 mt-1">
                    Press Ctrl+Enter to submit
                  </p>
                )}
              </div>

              {/* Closed Details - shown when viewing closed feedback */}
              {isViewOnly && feedback.closed_details && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Response from Team</h4>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{feedback.closed_details}</p>
                </div>
              )}

              {/* Communication Consent */}
              {shouldShowCommunicationConsent && (
                <div className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id="communication-consent"
                    checked={formData.communication_consent}
                    onChange={(e) => handleChange('communication_consent', e.target.checked)}
                    className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                    disabled={loading || isViewOnly}
                  />
                  <label htmlFor="communication-consent" className="text-sm text-gray-700 cursor-pointer">
                    I agree to be contacted via email regarding this feedback
                  </label>
                </div>
              )}

              {/* Include Diagnostics */}
              {!isEditing && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start space-x-2">
                    <input
                      type="checkbox"
                      id="include-metadata"
                      checked={formData.include_metadata}
                      onChange={(e) => handleChange('include_metadata', e.target.checked)}
                      className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      disabled={loading}
                    />
                    <div className="flex-1">
                      <label htmlFor="include-metadata" className="text-sm font-medium text-gray-900 cursor-pointer">
                        Include diagnostic information
                      </label>
                      <p className="text-xs text-gray-600 mt-1">
                        Help us debug issues by including browser info, console logs, and network activity. 
                        No personal data is collected.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
              disabled={loading}
            >
              {isViewOnly ? 'Close' : 'Cancel'}
            </button>
            {!isViewOnly && (
              <button
                onClick={handleSubmit}
                disabled={loading || !isFormValid}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{isEditing ? 'Updating...' : 'Sending...'}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>{isEditing ? 'Update Feedback' : 'Send Feedback'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

