import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, User, Mail, MessageSquare, Calendar, Monitor, Wifi, CheckCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager, useModalStore } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { feedbacksAPI, settingsAPI } from '../../utils/apiService';
import { useFeedbackById } from '../../utils/dataManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useApplyScopes } from '../../utils/storeUtils';
import CloseFeedbackModal from './CloseFeedbackModal';
import ConfirmDelete from '../modals/ConfirmDelete';
import { formatDateTimeLocale } from '../../utils/dateUtils';
import { useRTL } from '../../hooks/useRTL';

export default function FeedbackDetailModal({ 
  isOpen, 
  onClose, 
  feedbackId,
  // Navigation props
  onNavigate = null,
  currentIndex = 0,
  totalFeedbacks = 1,
  filteredFeedbacks = [],
  filterStatus = 'all'
}) {
  const [loading, setLoading] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showCloseFeedbackModal, setShowCloseFeedbackModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [notes, setNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [showRelatedErrors, setShowRelatedErrors] = useState(false);
  const [settings, setSettings] = useState(null);
  
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const { showToast } = useToast();
  const { registerModal, unregisterModal, isTopModal } = useModalManager();
  const modalId = 'feedback-detail-modal';
  
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

  // Apply scope for this feedback
  useApplyScopes(
    isOpen && feedbackId 
      ? [{ entity: 'feedback', id: feedbackId, eventId: 'general' }]
      : []
  );

  // Get feedback from store
  const feedback = useFeedbackById(feedbackId);

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'popup', allowOutsideScroll: true });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Fetch feedback details when modal opens
  useEffect(() => {
    if (isOpen && feedbackId) {
      const fetchFeedback = async () => {
        try {
          await feedbacksAPI.getById(feedbackId);
        } catch (error) {
          console.error('Failed to load feedback:', error);
          showToast(formatErrorMessage('load feedback', error), 'error');
        }
      };
      fetchFeedback();
    }
  }, [isOpen, feedbackId, showToast]);

  // Fetch settings (for errors) when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchSettings = async () => {
        try {
          const response = await settingsAPI.get();
          setSettings(response.settings || {});
        } catch (error) {
          console.error('Failed to load settings (errors):', error);
          // Don't show toast for settings errors, just log
        }
      };
      fetchSettings();
    }
  }, [isOpen]);

  // Initialize notes from feedback
  useEffect(() => {
    if (feedback) {
      setNotes(feedback.notes || '');
      setEditingNotes(false);
    }
  }, [feedback]);

  const handleSaveNotes = useCallback(async () => {
    setLoading(true);
    try {
      await feedbacksAPI.update(feedbackId, {
        notes: notes.trim() || null
      });
      
      showToast(t('feedbackDetail.notesSaved'), 'success');
      setEditingNotes(false);
    } catch (error) {
      console.error('Failed to save notes:', error);
      showToast(formatErrorMessage('save notes', error), 'error');
    } finally {
      setLoading(false);
    }
  }, [feedbackId, notes, showToast]);

  const handleCloseModalCallback = useCallback((success) => {
    setShowCloseFeedbackModal(false);
    if (success) {
      // Check if current feedback still matches filter after closing
      // If using filter for "open only", navigate to next since this is now closed
      if (onNavigate && totalFeedbacks > 1 && (filterStatus === 'open' || filterStatus === 'solved')) {
        // Feedback was just closed, so it no longer matches "open" or "solved" filters
        // Auto-navigate to next feedback (stay at same index which will show the next item)
        const nextIndex = currentIndex >= totalFeedbacks - 1 ? 0 : currentIndex;
        onNavigate('jump', nextIndex);
        return; // Don't close modal
      }
      onClose();
    }
  }, [onClose, onNavigate, totalFeedbacks, currentIndex, filterStatus]);

  const handleDeleteConfirm = useCallback(async () => {
    setLoading(true);
    try {
      await feedbacksAPI.delete(feedbackId);
      showToast(t('feedbackDetail.feedbackDeleted'), 'success');
      onClose();
    } catch (error) {
      console.error('Failed to delete feedback:', error);
      showToast(formatErrorMessage('delete feedback', error), 'error');
    } finally {
      setLoading(false);
    }
  }, [feedbackId, showToast, onClose]);

  const isClosed = Boolean(feedback?.is_closed);

  // Navigation handlers
  const handleNavigate = useCallback((direction) => {
    if (!onNavigate || totalFeedbacks <= 1) return;
    
    if (direction === 'prev') {
      if (currentIndex === 0) {
        onNavigate('jump', totalFeedbacks - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (currentIndex === totalFeedbacks - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    }
  }, [onNavigate, currentIndex, totalFeedbacks]);

  // Custom keyboard handler
  const handleDetailModalKeys = useCallback((e) => {
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
        return true; // Handled
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigate('next');
        return true; // Handled
      }
    }
    
    // Enter opens the close feedback modal (except in textarea where it adds newline)
    if (e.key === 'Enter' && targetTagName !== 'textarea') {
      if (!loading && !isClosed) {
        e.preventDefault();
        setShowCloseFeedbackModal(true);
      }
      return true; // Handled
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true; // Signal that we're handling this, preventing useModalFocus from stopping it
    }
    
    return false; // Not handled
  }, [loading, onClose, isClosed, handleNavigate, isTopmostModal]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleDetailModalKeys
  });

  // Parse diagnostics if available
  const diagnostics = useMemo(() => {
    if (!feedback?.diagnostics) return null;
    try {
      return typeof feedback.diagnostics === 'string' 
        ? JSON.parse(feedback.diagnostics) 
        : feedback.diagnostics;
    } catch (e) {
      return null;
    }
  }, [feedback?.diagnostics]);

  // Get related errors for this feedback
  const relatedErrors = useMemo(() => {
    if (!settings?.errors || !feedback?.error_ids || !Array.isArray(feedback.error_ids)) return [];
    const errorsDict = settings.errors || {};
    return feedback.error_ids
      .map(errorId => errorsDict[errorId] || Object.values(errorsDict).find(e => e.error_id === errorId))
      .filter(Boolean) // Remove any undefined/null entries
      .sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime; // Most recent first
      });
  }, [settings?.errors, feedback?.error_ids]);

  if (!isOpen || !feedback) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <motion.div
          ref={modalRef}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                isClosed ? 'bg-gray-100' : 'bg-primary-100'
              }`}>
                <MessageSquare className={`w-5 h-5 ${isClosed ? 'text-gray-600' : 'text-primary-600'}`} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <span>{t('feedbackDetail.feedback')} #{feedbackId}</span>
                  {isClosed && (
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      feedback.solved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {feedback.solved ? t('feedbackDetail.solved') : t('feedbackDetail.closed')}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-gray-500">
                  {formatDateTimeLocale(feedback.created_at)}
                  {totalFeedbacks > 1 && (
                    <span className="ml-2">• {currentIndex + 1} {t('feedbackDetail.of')} {totalFeedbacks}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Navigation buttons */}
              {totalFeedbacks > 1 && onNavigate && (
                <>
                  <button
                    onClick={() => handleNavigate('prev')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                    title={t('feedbackDetail.previousFeedback')}
                    aria-label={t('feedbackDetail.previousFeedback')}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleNavigate('next')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                    title={t('feedbackDetail.nextFeedback')}
                    aria-label={t('feedbackDetail.nextFeedback')}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title={t('feedbackDetail.close')}
                aria-label={t('feedbackDetail.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Feedback Details */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('feedbackDetail.feedbackDetails')}</h3>
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-gray-600">{t('feedbackDetail.sender')}</span>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-900">{feedback.sender_name}</span>
                    </div>
                    {Boolean(feedback.profile_is_public) && feedback.profile_label && (
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-xs text-gray-600">{t('feedbackDetail.profile')}</span>
                        <span className="text-sm text-gray-900">{feedback.profile_label}</span>
                      </div>
                    )}
                    {feedback.sender_email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <a href={`mailto:${feedback.sender_email}`} className="text-sm text-blue-600 hover:underline">
                          {feedback.sender_email}
                        </a>
                        {feedback.communication_consent && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                            {t('feedbackDetail.agreedToContact')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">{t('feedbackDetail.title')}</span>
                  <p className="text-sm font-medium text-gray-900">{feedback.title}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-600">{t('feedbackDetail.type')}</span>
                  <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                    feedback.type === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {feedback.type === 0 ? t('feedbackDetail.bugReport') : t('feedbackDetail.suggestion')}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-600">{t('feedbackDetail.details')}</span>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap mt-1">{feedback.message}</p>
                </div>
              </div>
            </div>

            {/* Developer Notes - private, not shown to sender */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">{t('feedbackDetail.developerNotes')}</h3>
                {!editingNotes && (
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {t('feedbackDetail.edit')}
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent resize-none"
                    placeholder={t('feedbackDetail.addPrivateNotes')}
                    rows={3}
                    disabled={loading}
                    dir={isRTL ? 'rtl' : 'ltr'}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setNotes(feedback.notes || '');
                        setEditingNotes(false);
                      }}
                      className="px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded transition-colors"
                      disabled={loading}
                    >
                      {t('feedbackDetail.cancel')}
                    </button>
                    <button
                      onClick={handleSaveNotes}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                      disabled={loading}
                    >
                      {t('feedbackDetail.saveNotes')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-900 whitespace-pre-wrap">
                  {notes || <span className="text-gray-400 italic">{t('feedbackDetail.noNotesYet')}</span>}
                </p>
              )}
            </div>

            {/* Metadata */}
            {(feedback.user_agent || feedback.ip_address) && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('feedbackDetail.metadata')}</h3>
                <div className="space-y-2">
                  {feedback.ip_address && (
                    <div className="flex items-center gap-2 text-xs">
                      <Wifi className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">{t('feedbackDetail.ip')}</span>
                      <span className="text-gray-900 font-mono">{feedback.ip_address}</span>
                    </div>
                  )}
                  {feedback.user_agent && (
                    <div className="flex items-start gap-2 text-xs">
                      <Monitor className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div className="flex-1">
                        <span className="text-gray-600">{t('feedbackDetail.userAgent')}</span>
                        <p className="text-gray-900 font-mono text-[10px] leading-relaxed break-all mt-1">
                          {feedback.user_agent}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Diagnostics */}
            {diagnostics && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 hover:text-primary-600 transition-colors"
                >
                  <span>{t('feedbackDetail.diagnosticInformation')}</span>
                  {showDiagnostics ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                
                {showDiagnostics && (
                  <div className="mt-4 space-y-4">
                    {/* Browser Info */}
                    {diagnostics.browser_info && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2">{t('feedbackDetail.browserInformation')}</h4>
                        <pre className="bg-white p-3 rounded text-[10px] overflow-x-auto">
                          {JSON.stringify(diagnostics.browser_info, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Console Logs */}
                    {diagnostics.console_logs && diagnostics.console_logs.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2">
                          {t('feedbackDetail.consoleLogs')} ({diagnostics.console_logs.length})
                        </h4>
                        <div className="bg-white p-3 rounded max-h-60 overflow-y-auto">
                          {diagnostics.console_logs.map((log, idx) => (
                            <div key={idx} className="text-[10px] font-mono mb-1 pb-1 border-b border-gray-100 last:border-0">
                              <span className={`${
                                log.type === 'error' ? 'text-red-600' :
                                log.type === 'warn' ? 'text-yellow-600' :
                                'text-gray-600'
                              }`}>
                                [{log.type}]
                              </span>
                              <span className="text-gray-400 ml-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
                              <pre className="mt-1 text-gray-900 whitespace-pre-wrap break-words">{log.message}</pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Network Logs */}
                    {diagnostics.network_logs && diagnostics.network_logs.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2">
                          {t('feedbackDetail.networkRequests')} ({diagnostics.network_logs.length})
                        </h4>
                        <div className="bg-white p-3 rounded max-h-60 overflow-y-auto">
                          {diagnostics.network_logs.map((log, idx) => (
                            <div key={idx} className="text-[10px] font-mono mb-2 pb-2 border-b border-gray-100 last:border-0">
                              <div className="flex items-center space-x-2">
                                <span className={`px-1.5 py-0.5 rounded ${
                                  log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {log.status || 'ERR'}
                                </span>
                                <span className="text-blue-600">{log.method}</span>
                                <span className="text-gray-600">{log.duration}ms</span>
                              </div>
                              <div className="mt-1 text-gray-900 break-all">{log.url}</div>
                              {log.error && (
                                <div className="mt-1 text-red-600">{log.error}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Network Errors (Detailed) */}
                    {diagnostics.network_errors && diagnostics.network_errors.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-red-700 mb-2">
                          {t('feedbackDetail.networkErrors')} ({diagnostics.network_errors.length})
                        </h4>
                        <div className="bg-white p-3 rounded max-h-80 overflow-y-auto">
                          {diagnostics.network_errors.map((error, idx) => (
                            <div key={idx} className="text-[10px] font-mono mb-3 pb-3 border-b border-red-100 last:border-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">
                                  {error.status || 'ERR'}
                                </span>
                                <span className="text-blue-600 font-semibold">{error.method}</span>
                                <span className="text-gray-600">{error.duration}ms</span>
                                {error.type && (
                                  <span className="text-gray-400 text-[9px]">({error.type})</span>
                                )}
                              </div>
                              <div className="text-gray-400 text-[9px] mb-1">{new Date(error.timestamp).toLocaleString()}</div>
                              <div className="text-gray-900 break-all mb-1">{error.url}</div>
                              {error.statusText && (
                                <div className="text-red-600 mb-1">{error.statusText}</div>
                              )}
                              {error.error && (
                                <div className="text-red-600 mb-1">Error: {error.error}</div>
                              )}
                              {error.responseBody && (
                                <div className="mt-2">
                                  <div className="text-gray-600 font-semibold mb-1">{t('feedbackDetail.response')}</div>
                                  <pre className="bg-red-50 p-2 rounded text-red-900 whitespace-pre-wrap break-words">
                                    {typeof error.responseBody === 'string' 
                                      ? error.responseBody 
                                      : JSON.stringify(error.responseBody, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {error.headers && (
                                <div className="mt-2">
                                  <div className="text-gray-600 font-semibold mb-1">{t('feedbackDetail.headers')}</div>
                                  <pre className="bg-gray-50 p-2 rounded text-gray-700 whitespace-pre-wrap break-words text-[9px]">
                                    {JSON.stringify(error.headers, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Related Errors */}
            {relatedErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <button
                  onClick={() => setShowRelatedErrors(!showRelatedErrors)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 hover:text-red-600 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    {t('feedbackDetail.relatedErrors')} ({relatedErrors.length})
                  </span>
                  {showRelatedErrors ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                
                {showRelatedErrors && (
                  <div className="mt-4 space-y-4">
                    {relatedErrors.map((error) => (
                      <button
                        key={error.error_id}
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('error:open-detail', {
                            detail: { errorId: error.error_id }
                          }));
                        }}
                        className="w-full text-left bg-white p-3 rounded border border-red-200 hover:border-red-400 hover:shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              error.error_type === 'DatabaseError' ? 'bg-red-100 text-red-700' :
                              error.error_type === 'PolicyError' ? 'bg-orange-100 text-orange-700' :
                              error.error_type === 'Forbidden' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {error.error_type}
                            </span>
                            {error.request_method && error.request_path && (
                              <span className="text-xs text-gray-600">
                                {error.request_method} {error.request_path}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500">
                            {formatDateTimeLocale(error.created_at)}
                          </span>
                        </div>
                        <div className="text-sm text-gray-900 mb-2 line-clamp-2">
                          {error.error_message}
                        </div>
                        <div className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          {t('feedbackDetail.clickToViewDetails')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Closed Info */}
            {isClosed && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('feedbackDetail.closureInformation')}</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-600">{t('feedbackDetail.closedAt')}</span>
                    <span className="text-gray-900">{formatDateTimeLocale(feedback.closed_at)}</span>
                  </div>
                  {feedback.closed_by_label && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">{t('feedbackDetail.closedBy')}</span>
                      <span className="text-gray-900">{feedback.closed_by_label}</span>
                    </div>
                  )}
                  {feedback.closed_details && (
                    <div className="mt-3">
                      <span className="text-xs text-gray-600">{t('feedbackDetail.closureDetails')}</span>
                      <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">{feedback.closed_details}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-between">
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={loading}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              {t('feedbackDetail.delete')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
                disabled={loading}
              >
                {t('feedbackDetail.close')}
              </button>
              {!isClosed && (
                <button
                  onClick={() => setShowCloseFeedbackModal(true)}
                  disabled={loading}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{t('feedbackDetail.closeFeedback')}</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Close Feedback Modal */}
      <CloseFeedbackModal
        isOpen={showCloseFeedbackModal}
        onClose={handleCloseModalCallback}
        feedbackId={feedbackId}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmDelete
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title={t('feedbackDetail.deleteFeedback')}
        message={t('feedbackDetail.areYouSureYouWantToDelete')}
        itemName={`${t('feedbackDetail.feedback')} #${feedbackId}`}
        confirmText={t('feedbackDetail.delete')}
        cancelText={t('feedbackDetail.cancel')}
      />
    </>
  );
}

