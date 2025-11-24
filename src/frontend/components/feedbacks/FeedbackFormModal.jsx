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
import { useApplyScopes } from '../../utils/storeUtils';
import { useMyFeedbackById } from '../../utils/dataManager';

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
  const currentProfileIsPublic = Boolean(currentProfile?.is_public);
  const currentProfileHasEmail = !!(currentProfile?.email);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'feedback-form-modal';

  // Extract feedback ID
  const feedbackId = feedback?.id || feedback?.feedback_id;

  // Apply scope for this feedback (only when editing/viewing)
  useApplyScopes(
    isOpen && feedbackId 
      ? [{ entity: 'my_feedback', id: feedbackId, eventId: 'general' }]
      : []
  );

  // Get feedback from store (will be updated if backend sends changes)
  const feedbackFromStore = useMyFeedbackById(feedbackId);
  const effectiveFeedback = feedbackFromStore || feedback;

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'modal', allowOutsideScroll: false });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Fetch feedback details when modal opens (for editing/viewing)
  useEffect(() => {
    if (isOpen && feedbackId) {
      const fetchFeedback = async () => {
        try {
          await feedbacksAPI.getMyFeedbackById(feedbackId);
        } catch (error) {
          console.error('Failed to load feedback:', error);
        }
      };
      fetchFeedback();
    }
  }, [isOpen, feedbackId]);

  // Initialize form with current profile data or editing feedback
  useEffect(() => {
    if (isOpen) {
      if (effectiveFeedback) {
        // Editing mode
        setFormData({
          sender_name: effectiveFeedback.sender_name || '',
          sender_email: effectiveFeedback.sender_email || '',
          title: effectiveFeedback.title || '',
          type: effectiveFeedback.type || 0,
          message: effectiveFeedback.message || '',
          communication_consent: Boolean(effectiveFeedback.communication_consent),
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
    }
  }, [isOpen, currentProfile, currentProfileIsPublic, effectiveFeedback]);

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
    const isEditing = !!effectiveFeedback;

    setLoading(true);
    try {
      if (isEditing) {
        // Update existing feedback
        const updatePayload = {
          title: formData.title.trim(),
          type: formData.type,
          message: formData.message.trim(),
          communication_consent: Boolean(formData.communication_consent),
        };

        await feedbacksAPI.updateMyFeedback(feedbackId, updatePayload);
        showToast('Feedback updated successfully!', 'success');
        onClose();
      } else {
        // Create new feedback
        const payload = {
          title: formData.title.trim(),
          type: formData.type,
          message: formData.message.trim(),
          communication_consent: formData.communication_consent ? 1 : 0,
          include_metadata: formData.include_metadata
        };

        // Only include sender_name and sender_email for public profiles
        if (currentProfileIsPublic) {
          const senderName = formData.sender_name.trim();
          
          if (!senderName) {
            showToast('Please enter your name', 'error');
            setLoading(false);
            return;
          }

          payload.sender_name = senderName;
          payload.sender_email = formData.sender_email.trim() || null;
        }

        // Include diagnostics if metadata checkbox is checked
        if (formData.include_metadata) {
          const diagnostics = diagnosticsCapture.getDiagnostics();
          payload.console_logs = diagnostics.console_logs;
          payload.network_logs = diagnostics.network_logs;
          payload.network_errors = diagnostics.network_errors;
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
  }, [formData, currentProfileIsPublic, currentProfileHasEmail, currentProfile, effectiveFeedback, feedbackId, showToast, onClose]);

  // Check if editing and view states
  const isEditing = !!effectiveFeedback;
  const isClosed = Boolean(effectiveFeedback?.is_closed);
  const isViewOnly = isEditing && isClosed;

  // Check if form is valid for submission
  const isFormValid = (
    !!formData.title.trim() && 
    !!formData.message.trim() && 
    (isEditing || !currentProfileIsPublic || !!formData.sender_name.trim())
  );

  // Custom keyboard handler
  const handleFormModalKeys = useCallback((e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // Ctrl+Enter or Cmd+Enter submits the form
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (!loading && !isViewOnly && isFormValid && !submitted) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
      }
      return true; // Handled
    }
    
    // ESC closes the modal
    if (e.key === 'Escape') {
      if (!loading) {
        onClose();
      }
      return true; // Handled
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it
    }
    
    return false; // Not handled
  }, [loading, isViewOnly, isFormValid, submitted, handleSubmit, onClose]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'modal',
    allowOutsideScroll: false,
    customKeyHandler: handleFormModalKeys
  });

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Show name field only for public profiles (and only when creating)
  const shouldShowNameField = currentProfileIsPublic && !isEditing;
  
  // Show email field only for public profiles (and only when creating)
  const shouldShowEmailField = currentProfileIsPublic && !isEditing;
  
  // Show communication consent when there's an email to send (and not viewing), but hide for public profiles
  const shouldShowCommunicationConsent = !isViewOnly && !currentProfileIsPublic && currentProfileHasEmail;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col"
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
              {/* Name and Email (only for public profiles) - side by side */}
              {(shouldShowNameField || shouldShowEmailField) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name */}
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

                  {/* Email */}
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
                      
                      {/* Communication Consent - shown when email is provided (not for public profiles) */}
                      {shouldShowCommunicationConsent && formData.sender_email.trim() && (
                        <div className="mt-2">
                          <label className={`relative inline-flex items-center ${loading ? 'cursor-not-allowed' : 'cursor-pointer'} select-none`}>
                            <input
                              type="checkbox"
                              checked={formData.communication_consent}
                              onChange={(e) => handleChange('communication_consent', e.target.checked)}
                              disabled={loading}
                              className="sr-only peer"
                            />
                            <div className={`w-10 h-5 ${loading ? 'bg-gray-300' : 'bg-gray-200'} peer-focus:outline-none rounded-full peer-checked:bg-blue-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:border-white`}></div>
                            <span className={`ml-3 text-sm ${loading ? 'text-gray-400' : 'text-gray-700'}`}>
                              I would like to receive email updates
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
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
                    <span className="ml-2 text-sm text-gray-700">Improvement Suggestion</span>
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
                  rows={4}
                  disabled={loading || isViewOnly}
                />
                {!isViewOnly && (
                  <p className="text-xs text-gray-500 mt-1">
                    Press Ctrl+Enter to submit
                  </p>
                )}
              </div>

              {/* Closed Details - shown when viewing closed feedback */}
              {isViewOnly && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Response from Team</h4>
                  {effectiveFeedback.closed_at && (
                    <p className="text-xs text-gray-600 mb-2">
                      Closed on {new Date(effectiveFeedback.closed_at).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </p>
                  )}
                  {effectiveFeedback.closed_details ? (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{effectiveFeedback.closed_details}</p>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No response message provided</p>
                  )}
                </div>
              )}

              {/* Communication Consent - for non-public profiles with email */}
              {shouldShowCommunicationConsent && !shouldShowEmailField && (
                <div>
                  <label className={`relative inline-flex items-center ${(loading || isViewOnly) ? 'cursor-not-allowed' : 'cursor-pointer'} select-none`}>
                    <input
                      type="checkbox"
                      checked={formData.communication_consent}
                      onChange={(e) => handleChange('communication_consent', e.target.checked)}
                      disabled={loading || isViewOnly}
                      className="sr-only peer"
                    />
                    <div className={`w-10 h-5 ${(loading || isViewOnly) ? 'bg-gray-300' : 'bg-gray-200'} peer-focus:outline-none rounded-full peer-checked:bg-blue-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:border-white`}></div>
                    <span className={`ml-3 text-sm font-medium ${(loading || isViewOnly) ? 'text-gray-400' : 'text-gray-700'}`}>
                      I would like to receive email updates regarding this feedback
                    </span>
                  </label>
                </div>
              )}

              {/* Include Diagnostics */}
              {!isEditing && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <label className={`relative inline-flex items-start ${loading ? 'cursor-not-allowed' : 'cursor-pointer'} select-none`}>
                    <input
                      type="checkbox"
                      checked={formData.include_metadata}
                      onChange={(e) => handleChange('include_metadata', e.target.checked)}
                      disabled={loading}
                      className="sr-only peer"
                    />
                    <div className={`w-10 h-5 flex-shrink-0 ${loading ? 'bg-gray-300' : 'bg-gray-200'} peer-focus:outline-none rounded-full peer-checked:bg-blue-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:border-white`}></div>
                    <div className="ml-3 flex-1">
                      <span className={`text-sm font-medium ${loading ? 'text-gray-400' : 'text-gray-900'}`}>
                        Include diagnostic information
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        Help us debug issues by including browser info, console logs, and network activity. 
                        No personal data is collected.
                      </p>
                    </div>
                  </label>
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

