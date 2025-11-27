import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Archive, User, UserCircle, Edit2, Plus, LogOut, Lock, Trash2, FileText, Eye, Check, MessageSquare } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { getPreference, setPreference } from '../../utils/settings';
import { profilesAPI, requestsAPI, feedbacksAPI } from '../../utils/apiService';
import { useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile, setCurrentProfile } from '../../utils/profileService';
import { useMyRequestsList, useMyFeedbacksList } from '../../utils/dataManager';
import { useApplyScopes, usePendingRequestsCount, useEventId } from '../../utils/storeUtils';
import { useEventUrls } from '../../hooks/useEventUrls';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/authContext';
import { ChangePasswordModal } from '../profiles';
import { ConfirmDelete } from '../modals';
import { RequestFormModal } from '../requests';
import { FeedbackFormModal } from '../feedbacks';
import { PermissionGate } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDate } from '../../utils/dateUtils';

export default function AccountModal({ hideButton = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(getPreference('general.includeArchived', false));
  const { eventUrl } = useParams();
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const { urlHelpers } = useEventUrls(eventUrl);
  const permissions = usePermissions();
  const { logout, isAuthenticated, openLoginModal } = useAuth();
  
  // Profile management state
  const currentProfile = getCurrentProfile();
  const pendingRequestsCount = usePendingRequestsCount(eventId);
  const [editingEmail, setEditingEmail] = useState(false);
  const [currentEmail, setCurrentEmail] = useState('');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  
  // Requests state
  const [showRequestFormModal, setShowRequestFormModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [showDeleteRequestModal, setShowDeleteRequestModal] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState(null);
  
  // Feedback state
  const [showFeedbackFormModal, setShowFeedbackFormModal] = useState(false);
  const [editingMyFeedback, setEditingMyFeedback] = useState(null);
  const [showDeleteMyFeedbackModal, setShowDeleteMyFeedbackModal] = useState(false);
  const [myFeedbackToDelete, setMyFeedbackToDelete] = useState(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  useEffect(() => {
    const handleAccountOpen = () => {
      setIsOpen(true);
    };

    window.addEventListener('account:open', handleAccountOpen);
    return () => window.removeEventListener('account:open', handleAccountOpen);
  }, []);

  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'account-modal';

  // Register modal when opened, unregister when closed
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true
      });
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        setIsOpen(false);
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(modalId);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Apply scopes
  const profileId = currentProfile?.id || currentProfile?.profile_id;
  const isPublic = Boolean(currentProfile?.is_public);

  const scopeConfig = useMemo(() => {
    if (!isOpen || !profileId) {
      return [];
    }

    const scopes = [
      ...(eventId ? [{ entity: 'event_profile', id: String(profileId), eventId }] : []),
      { entity: 'profile', id: String(profileId), eventId: 'general' },
    ];

    if (eventId) {
      scopes.push({ entity: 'all', id: 'my_access_requests', eventId });
    }

    if (!isPublic) {
      scopes.push({ entity: 'all', id: 'my_feedbacks', eventId: 'general' });
    }

    return scopes;
  }, [eventId, isOpen, isPublic, profileId]);

  useApplyScopes(scopeConfig);

  // Fetch current profile when modal opens
  useEffect(() => {
    if (isOpen && isAuthenticated && eventUrl && currentProfile?.profile_id) {
      fetchCurrentProfile();
      fetchMyRequests();
    }
  }, [isOpen, isAuthenticated, eventUrl, currentProfile?.id, currentProfile?.is_public, permissions.enable_new_requests]);

  // Fetch my feedbacks when modal opens
  useEffect(() => {
    if (isOpen && isAuthenticated && !Boolean(currentProfile?.is_public)) {
      fetchMyFeedbacks();
    }
  }, [isOpen, isAuthenticated, currentProfile?.is_public]);

  const fetchCurrentProfile = async () => {
    try {
      await profilesAPI.getCurrentProfile(eventUrl);
    } catch (error) {
      console.error('Failed to fetch current profile:', error);
    }
  };

  const fetchMyRequests = async () => {
    try {
      await requestsAPI.getMyRequests(eventUrl);
    } catch (error) {
      console.error('Failed to fetch my requests:', error);
    }
  };

  const fetchMyFeedbacks = async () => {
    try {
      await feedbacksAPI.getMyFeedbacks();
    } catch (error) {
      console.error('Failed to fetch my feedbacks:', error);
    }
  };

  // Email editing handlers
  const handleEmailEdit = useCallback(() => {
    setCurrentEmail(currentProfile?.email || '');
    setEditingEmail(true);
  }, [currentProfile?.email]);

  const handleEmailSave = useCallback(async () => {
    try {
      await profilesAPI.updateCurrentProfile({ email: currentEmail.trim() || null }, eventUrl);
      setCurrentProfile({ ...currentProfile, email: currentEmail.trim() || null });
      showToast('Email updated', 'success');
      setEditingEmail(false);
    } catch (error) {
      console.error('Failed to update email:', error);
      showToast(formatErrorMessage('update email', error), 'error');
    }
  }, [currentProfile, currentEmail, eventUrl, showToast]);

  const handleEmailCancel = useCallback(() => {
    setEditingEmail(false);
    setCurrentEmail(currentProfile?.email || '');
  }, [currentProfile?.email]);

  // Custom keyboard handler to prevent ESC from closing modal when editing
  const handleModalKeys = useCallback((e) => {
    if (showChangePasswordModal) {
      return true;
    }
    
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      return true;
    }
    
    return false;
  }, [showChangePasswordModal]);

  const { modalRef } = useModalFocus(isOpen, () => setIsOpen(false), {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: !showChangePasswordModal,
    customKeyHandler: handleModalKeys
  });

  const handleIncludeArchivedChange = (checked) => {
    setIncludeArchived(checked);
    setPreference('general.includeArchived', checked);
  };

  const handleSignOut = async () => {
    await logout();
    setIsOpen(false);
  };

  const handleSignIn = () => {
    setIsOpen(false);
    openLoginModal();
  };

  // Requests handlers
  const handleCreateRequest = () => {
    setEditingRequest(null);
    setShowRequestFormModal(true);
  };

  const handleEditRequest = (request) => {
    const requestId = request?.id || request?.access_request_id;
    const requestWithId = request ? { ...request, access_request_id: requestId || request.id } : null;
    setEditingRequest(requestWithId);
    setShowRequestFormModal(true);
  };

  const handleDeleteRequest = (request) => {
    setRequestToDelete(request);
    setShowDeleteRequestModal(true);
  };

  const handleConfirmDeleteRequest = async () => {
    if (!requestToDelete) return;

    const requestId = requestToDelete?.id || requestToDelete?.access_request_id;
    if (!requestId) {
      console.error('Cannot delete request: no ID found', requestToDelete);
      showToast('Cannot delete request: ID not found', 'error');
      return;
    }

    try {
      await requestsAPI.deleteMyRequest(requestId, eventUrl);
      showToast(`Request deleted`, 'success');
    } catch (error) {
      console.error('Failed to delete request:', error);
      showToast(formatErrorMessage('delete request', error), 'error');
    } finally {
      setRequestToDelete(null);
    }
  };

  // My Feedbacks handlers
  const handleEditMyFeedback = (feedback) => {
    const feedbackId = feedback?.id || feedback?.feedback_id;
    const feedbackWithId = feedback ? { ...feedback, feedback_id: feedbackId || feedback.id } : null;
    setEditingMyFeedback(feedbackWithId);
    setShowFeedbackFormModal(true);
  };

  const handleDeleteMyFeedback = (feedback) => {
    setMyFeedbackToDelete(feedback);
    setShowDeleteMyFeedbackModal(true);
  };

  const handleConfirmDeleteMyFeedback = async () => {
    if (!myFeedbackToDelete) return;

    const feedbackId = myFeedbackToDelete?.id || myFeedbackToDelete?.feedback_id;
    if (!feedbackId) {
      console.error('Cannot delete feedback: no ID found', myFeedbackToDelete);
      showToast('Cannot delete feedback: ID not found', 'error');
      return;
    }

    try {
      await feedbacksAPI.deleteMyFeedback(feedbackId);
      showToast(`Feedback deleted`, 'success');
    } catch (error) {
      console.error('Failed to delete feedback:', error);
      showToast(formatErrorMessage('delete feedback', error), 'error');
    } finally {
      setMyFeedbackToDelete(null);
    }
  };

  // Get user's requests
  const userRequests = useMyRequestsList(eventId);
  const sortedMyRequests = useMemo(() => {
    return [...userRequests].sort((a, b) => {
      const ta = a?.requested_at ? new Date(a.requested_at).getTime() : 0;
      const tb = b?.requested_at ? new Date(b.requested_at).getTime() : 0;
      return tb - ta;
    });
  }, [userRequests]);

  // Get user's feedbacks
  const userFeedbacks = useMyFeedbacksList();
  const sortedMyFeedbacks = useMemo(() => {
    return [...userFeedbacks].sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [userFeedbacks]);

  const accountModal = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsOpen(false)}>
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ 
              opacity: 1, 
              scale: 1
            }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                  <UserCircle className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Account</h2>
                  <p className="text-sm text-gray-500">Manage your account settings</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-0">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ 
                  opacity: 1, 
                  y: 0
                }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {!isAuthenticated ? (
                  /* Not Authenticated - Show Sign In */
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <User className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Not Signed In</h3>
                    <p className="text-gray-600 mb-4">Sign in to access your account settings</p>
                    <button
                      onClick={handleSignIn}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium inline-flex items-center space-x-2"
                    >
                      <User className="w-4 h-4" />
                      <span>Sign In</span>
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Current Profile Section (compact with sign out) */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-base text-gray-700">
                          Current Profile: <span className="font-medium text-gray-900">{currentProfile?.label || 'Not set'}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {!Boolean(currentProfile?.is_public) && (
                            <button
                              onClick={() => setShowChangePasswordModal(true)}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors font-medium inline-flex items-center justify-center space-x-2 border border-blue-700 shadow-sm"
                            >
                              <Lock className="w-4 h-4" />
                              <span>Change Password</span>
                            </button>
                          )}
                          <button
                            onClick={handleSignOut}
                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors font-medium inline-flex items-center justify-center space-x-2 border border-red-200 shadow-sm"
                          >
                            <LogOut className="w-4 h-4" />
                            <span>Sign Out</span>
                          </button>
                        </div>
                      </div>
                      {!Boolean(currentProfile?.is_public) && (
                        <div 
                          className="flex items-center space-x-1.5"
                          onKeyDown={(e) => {
                            if (editingEmail) {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleEmailSave();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleEmailCancel();
                              }
                            }
                          }}
                        >
                          <span className="text-sm text-gray-600">Email:</span>
                          {editingEmail ? (
                            <>
                              <input
                                type="email"
                                value={currentEmail}
                                onChange={(e) => setCurrentEmail(e.target.value)}
                                className="w-64 px-2 py-1 text-sm border border-blue-500 rounded focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                                placeholder="Enter email (optional)"
                                autoFocus
                              />
                              <button
                                onClick={handleEmailSave}
                                className="p-1 hover:bg-green-100 rounded transition-colors"
                                title="Save (Enter)"
                              >
                                <Check className="w-4 h-4 text-green-600" />
                              </button>
                              <button
                                onClick={handleEmailCancel}
                                className="p-1 hover:bg-red-100 rounded transition-colors"
                                title="Cancel (Esc)"
                              >
                                <X className="w-4 h-4 text-red-600" />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-sm font-medium text-gray-900">{currentProfile?.email || 'Not set'}</span>
                              <button
                                onClick={handleEmailEdit}
                                className="p-1 hover:bg-blue-100 rounded transition-colors"
                                title="Edit email"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Include Archived */}
                    <PermissionGate requires="hasArchiveAlbum">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Gallery Preferences</h4>
                        <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center">
                              <Archive className="w-5 h-5 text-gray-600" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">Include Archived</p>
                              <p className="text-sm text-gray-500">Show archived images in galleries</p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={includeArchived}
                              onChange={(e) => handleIncludeArchivedChange(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                          </label>
                        </div>
                      </div>
                    </PermissionGate>

                    {/* My Requests Section - only show if there are requests or new requests are enabled */}
                    {(() => {
                      const isPublic = Boolean(currentProfile?.is_public);
                      const enableNewRequests = permissions.enable_new_requests;
                      const hasRequests = userRequests.length > 0;
                      const shouldShow = enableNewRequests || (!isPublic && hasRequests);
                      
                      if (!shouldShow) return null;
                      
                      return (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold text-gray-700">My Requests</h4>
                            {enableNewRequests && (
                              <button
                                onClick={handleCreateRequest}
                                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-1">
                                <Plus className="w-4 h-4" />
                                <span>Create Request</span>
                              </button>
                            )}
                          </div>
                          {!isPublic && (userRequests.length === 0 ? (
                            <div key="no-requests-message" className="text-center py-4">
                              <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                              <p className="text-sm text-gray-500">No requests yet</p>
                            </div>
                          ) : (
                            <div key="requests-list" className="space-y-2">
                              {sortedMyRequests.map((request, index) => {
                                const requestKey = request?.id || request?.access_request_id || `request-${index}`;
                                const requestId = request?.id || request?.access_request_id;
                                
                                return (
                                  <div
                                    key={requestKey}
                                    className="flex items-center justify-between py-3 px-4 bg-white rounded-lg hover:shadow-sm transition-shadow"
                                  >
                                    <div className="flex items-center space-x-3">
                                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <FileText className="w-5 h-5 text-blue-600" />
                                      </div>
                                      <div>
                                        <div className="flex items-center space-x-2">
                                          <p className="font-medium text-gray-900">{request.applicant_name}</p>
                                          <span className={`px-2 py-1 text-xs rounded-full ${
                                            (() => {
                                              const status = request.status || 'pending';
                                              const statusConfig = {
                                                pending: 'bg-blue-100 text-blue-700',
                                                approved: 'bg-green-100 text-green-700',
                                                rejected: 'bg-red-100 text-red-700',
                                                mixed: 'bg-yellow-100 text-yellow-700'
                                              };
                                              return statusConfig[status] || statusConfig.pending;
                                            })()
                                          }`}>
                                            {(() => {
                                              const status = request.status || 'pending';
                                              const statusConfig = {
                                                pending: 'Pending',
                                                approved: 'Approved',
                                                rejected: 'Rejected',
                                                mixed: 'Mixed'
                                              };
                                              return statusConfig[status] || statusConfig.pending;
                                            })()}
                                          </span>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                          {request.groups_count} group{request.groups_count !== 1 ? 's' : ''} • {formatDate(request.requested_at)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      {(() => {
                                        const status = request.status || 'pending';
                                        const isClosed = status !== 'pending';
                                        return isClosed ? (
                                          <button
                                            onClick={() => handleEditRequest(request)}
                                            className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                            title="View request"
                                          >
                                            <Eye className="w-4 h-4 text-blue-600" />
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => handleEditRequest(request)}
                                              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                              title="Edit request"
                                            >
                                              <Edit2 className="w-4 h-4 text-blue-600" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteRequest(request)}
                                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                              title="Delete request"
                                            >
                                              <Trash2 className="w-4 h-4 text-red-600" />
                                            </button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* My Feedbacks Section - for non-public profiles only, only show if there are feedbacks */}
                    {(() => {
                      const isPublic = Boolean(currentProfile?.is_public);
                      const hasFeedbacks = userFeedbacks.length > 0;
                      const shouldShow = !isPublic && hasFeedbacks;
                      
                      if (!shouldShow) return null;
                      
                      return (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold text-gray-700">My Feedbacks</h4>
                          </div>
                          <div key="feedbacks-list" className="space-y-2">
                            {sortedMyFeedbacks.map((feedback, index) => {
                              const feedbackKey = feedback?.id || feedback?.feedback_id || `feedback-${index}`;
                              const feedbackId = feedback?.id || feedback?.feedback_id;
                              const isClosed = Boolean(feedback?.is_closed);
                              
                              return (
                                <div
                                  key={feedbackKey}
                                  className="flex items-center justify-between py-3 px-4 bg-white rounded-lg hover:shadow-sm transition-shadow"
                                >
                                  <div className="flex items-center space-x-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                      feedback.type === 0 ? 'bg-red-100' : 'bg-green-100'
                                    }`}>
                                      <MessageSquare className={`w-5 h-5 ${
                                        feedback.type === 0 ? 'text-red-600' : 'text-green-600'
                                      }`} />
                                    </div>
                                    <div>
                                      <div className="flex items-center space-x-2">
                                        <p className="font-medium text-gray-900">{feedback.title}</p>
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                          isClosed 
                                            ? (feedback.solved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700')
                                            : 'bg-blue-100 text-blue-700'
                                        }`}>
                                          {isClosed ? (feedback.solved ? 'Solved' : 'Closed') : 'Open'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-500">
                                        {feedback.type === 0 ? 'Bug Report' : 'Suggestion'} • {formatDate(feedback.created_at)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    {isClosed ? (
                                      <button
                                        onClick={() => handleEditMyFeedback(feedback)}
                                        className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                        title="View feedback"
                                      >
                                        <Eye className="w-4 h-4 text-blue-600" />
                                      </button>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => handleEditMyFeedback(feedback)}
                                          className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                          title="Edit feedback"
                                        >
                                          <Edit2 className="w-4 h-4 text-blue-600" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteMyFeedback(feedback)}
                                          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                          title="Delete feedback"
                                        >
                                          <Trash2 className="w-4 h-4 text-red-600" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </motion.div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <div className="flex justify-end">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  const nestedModals = (
    <>
      {showChangePasswordModal && currentProfile && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          profileId={currentProfile.id || currentProfile.profile_id}
          profileLabel={currentProfile.label}
          eventUrl={eventUrl}
        />
      )}

      {showDeleteRequestModal && requestToDelete && (
        <ConfirmDelete
          isOpen={showDeleteRequestModal}
          onClose={() => {
            setShowDeleteRequestModal(false);
            setRequestToDelete(null);
          }}
          onConfirm={handleConfirmDeleteRequest}
          title="Delete Request"
          message="Are you sure you want to delete this request"
          itemName={requestToDelete.applicant_name}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}

      {showRequestFormModal && (
        <RequestFormModal
          isOpen={showRequestFormModal}
          onClose={() => {
            setShowRequestFormModal(false);
            setEditingRequest(null);
          }}
          request={editingRequest}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}

      {showFeedbackFormModal && (
        <FeedbackFormModal
          isOpen={showFeedbackFormModal}
          onClose={() => {
            setShowFeedbackFormModal(false);
            setEditingMyFeedback(null);
          }}
          feedback={editingMyFeedback}
        />
      )}

      {showDeleteMyFeedbackModal && myFeedbackToDelete && (
        <ConfirmDelete
          isOpen={showDeleteMyFeedbackModal}
          onClose={() => {
            setShowDeleteMyFeedbackModal(false);
            setMyFeedbackToDelete(null);
          }}
          onConfirm={handleConfirmDeleteMyFeedback}
          title="Delete Feedback"
          message="Are you sure you want to delete this feedback"
          itemName={myFeedbackToDelete.title}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}
    </>
  );

  return (
    <>
      {!hideButton && (
        <button
          onClick={() => setIsOpen(true)}
          className="w-9 h-9 border border-transparent rounded-lg transition-all hover:bg-gray-100 flex items-center justify-center text-gray-700 relative"
          title="Account"
        >
          <UserCircle className="w-4 h-4" />
        </button>
      )}

      {isClient && createPortal(
        <>
          {accountModal}
          {nestedModals}
        </>,
        document.body
      )}
    </>
  );
}
