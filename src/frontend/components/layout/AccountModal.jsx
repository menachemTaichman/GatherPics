import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Archive, User, UserCircle, Edit2, Plus, LogOut, Lock, Trash2, FileText, Eye, Check, MessageSquare, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { getPreference, setPreference } from '../../utils/settings';
import { profilesAPI, requestsAPI, feedbacksAPI } from '../../utils/apiService';
import { useParams, useLocation } from 'react-router-dom';
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
import { PermissionGate, LongPressHoverButton } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDate } from '../../utils/dateUtils';
import { useRTL } from '../../hooks/useRTL';

export default function AccountModal({ hideButton = false }) {
  const { t } = useTranslation();
  const { isRTL, ms, me } = useRTL();
  const [isOpen, setIsOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(getPreference('general.includeArchived', false));
  const [hideTimestampsInGallery, setHideTimestampsInGallery] = useState(getPreference('general.hideTimestampsInGallery', false));
  const params = useParams();
  const location = useLocation();
  
  // Get eventUrl from params, or extract from pathname as fallback
  // Route structure: /:eventUrl/* or /:eventUrl
  const eventUrlFromParams = params.eventUrl;
  const eventUrlFromPath = location.pathname.split('/').filter(Boolean)[0];
  const eventUrl = eventUrlFromParams || (eventUrlFromPath && !['dashboard', 'reset-password', 'about'].includes(eventUrlFromPath) ? eventUrlFromPath : undefined);
  
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const { urlHelpers } = useEventUrls(eventUrl);
  const permissions = usePermissions(eventUrl);
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
      showToast(t('account.emailUpdated'), 'success');
      setEditingEmail(false);
    } catch (error) {
      console.error('Failed to update email:', error);
      showToast(formatErrorMessage(t('account.updateEmail'), error), 'error');
    }
  }, [currentProfile, currentEmail, eventUrl, showToast, t]);

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

  const handleHideTimestampsInGalleryChange = (checked) => {
    setHideTimestampsInGallery(checked);
    setPreference('general.hideTimestampsInGallery', checked);
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
      showToast(t('account.cannotDeleteRequestNoId'), 'error');
      return;
    }

    try {
      await requestsAPI.deleteMyRequest(requestId, eventUrl);
      showToast(t('account.requestDeleted'), 'success');
    } catch (error) {
      console.error('Failed to delete request:', error);
      showToast(formatErrorMessage(t('account.deleteRequestAction'), error), 'error');
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
      showToast(t('account.cannotDeleteFeedbackNoId'), 'error');
      return;
    }

    try {
      await feedbacksAPI.deleteMyFeedback(feedbackId);
      showToast(t('account.feedbackDeleted'), 'success');
    } catch (error) {
      console.error('Failed to delete feedback:', error);
      showToast(formatErrorMessage(t('account.deleteFeedbackAction'), error), 'error');
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
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                  <UserCircle className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{t('account.account')}</h2>
                  <p className="text-sm text-gray-500">{t('account.manageAccountSettings')}</p>
                </div>
              </div>
              <LongPressHoverButton
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title={t('account.close')}
                aria-label={t('account.close')}
              >
                <X className="w-5 h-5" />
              </LongPressHoverButton>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-0" dir={isRTL ? 'rtl' : 'ltr'}>
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
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('account.notSignedIn')}</h3>
                    <p className="text-gray-600 mb-4">{t('account.signInToAccess')}</p>
                              <button
                                onClick={handleSignIn}
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium inline-flex items-center gap-2"
                              >
                                <span>{t('account.signIn')}</span>
                                <User className="w-4 h-4" />
                              </button>
                  </div>
                ) : (
                  <>
                    {/* Current Profile Section (compact with sign out) */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-base text-gray-700">
                          <span className={me('1')}>{t('account.currentProfile')}</span> <span className="font-medium text-gray-900">{currentProfile?.label || t('account.notSet')}</span>
                        </div>
                        <div className={`flex items-center ${ms('2')}`}>
                          {!Boolean(currentProfile?.is_public) && (
                            <button
                              onClick={() => setShowChangePasswordModal(true)}
                              className={`px-3 py-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors font-medium inline-flex items-center justify-center gap-2 ${ms('2')} border border-blue-700 shadow-sm`}
                            >
                              <span>{t('account.changePassword')}</span>
                              <Lock className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={handleSignOut}
                            className={`px-3 py-1.5 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors font-medium inline-flex items-center justify-center gap-2 ${ms('2')} border border-red-200 shadow-sm`}
                          >
                            <span>{t('account.signOut')}</span>
                            <LogOut className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {!Boolean(currentProfile?.is_public) && (
                        <div 
                          className="flex items-center gap-1.5"
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
                          <span className={`text-sm text-gray-600 ${me('2')}`}>{t('account.email')}</span>
                          {editingEmail ? (
                            <>
                              <input
                                type="email"
                                value={currentEmail}
                                onChange={(e) => setCurrentEmail(e.target.value)}
                                className="w-64 px-2 py-1 text-sm border border-blue-500 rounded focus:ring-2 focus:ring-blue-300 focus:border-transparent"
                                placeholder={t('account.enterEmailOptional')}
                                autoFocus
                              />
                              <LongPressHoverButton
                                onClick={handleEmailSave}
                                className={`p-1 hover:bg-green-100 rounded transition-colors ${ms('2')}`}
                                title={t('account.saveEnter')}
                                aria-label={t('account.saveEnter')}
                              >
                                <Check className="w-4 h-4 text-green-600" />
                              </LongPressHoverButton>
                              <LongPressHoverButton
                                onClick={handleEmailCancel}
                                className={`p-1 hover:bg-red-100 rounded transition-colors ${ms('2')}`}
                                title={t('account.cancelEsc')}
                                aria-label={t('account.cancelEsc')}
                              >
                                <X className="w-4 h-4 text-red-600" />
                              </LongPressHoverButton>
                            </>
                          ) : (
                            <>
                              <span className={`text-sm font-medium text-gray-900 ${ms('2')}`}>{currentProfile?.email || t('account.notSet')}</span>
                              <LongPressHoverButton
                                onClick={handleEmailEdit}
                                className={`p-1 hover:bg-blue-100 rounded transition-colors ${ms('2')}`}
                                title={t('account.editEmail')}
                                aria-label={t('account.editEmail')}
                              >
                                <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                              </LongPressHoverButton>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Gallery Preferences */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('account.galleryPreferences')}</h4>
                      <div className="space-y-2">
                        {/* Include Archived */}
                        <PermissionGate requires="hasArchiveAlbum" eventUrl={eventUrl}>
                          <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Archive className="w-5 h-5 text-gray-600" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900">{t('account.includeArchived')}</p>
                                <p className="text-sm text-gray-500">{t('account.showArchivedImages')}</p>
                              </div>
                            </div>
                            <LongPressHoverButton
                              onClick={() => handleIncludeArchivedChange(!includeArchived)}
                              className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${includeArchived ? 'bg-primary-600' : 'bg-gray-300'}`}
                              aria-pressed={includeArchived}
                              title={t('account.includeArchived')}
                              aria-label={t('account.includeArchived')}
                            >
                              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${includeArchived ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                            </LongPressHoverButton>
                          </div>
                        </PermissionGate>
                        
                        {/* Hide Timestamps in Gallery */}
                        <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Clock className="w-5 h-5 text-gray-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900">{t('account.hideTimestampsInGallery')}</p>
                              <p className="text-sm text-gray-500">{t('account.hideTimestampsInGalleryDescription')}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleHideTimestampsInGalleryChange(!hideTimestampsInGallery)}
                            className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${hideTimestampsInGallery ? 'bg-primary-600' : 'bg-gray-300'}`}
                            aria-pressed={hideTimestampsInGallery}
                            title={t('account.hideTimestampsInGallery')}
                            aria-label={t('account.hideTimestampsInGallery')}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${hideTimestampsInGallery ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* My Requests Section - only show if there are requests or new requests are enabled */}
                    {(() => {
                      // Requests are per-event, so only show if we have an eventId from URL
                      if (!eventId) {
                        return null;
                      }
                      
                      const isPublic = Boolean(currentProfile?.is_public);
                      
                      // Check enable_new_requests only for the event in the URL
                      const enableNewRequests = permissions.enable_new_requests || Boolean(
                        currentProfile?.events?.[eventId]?.enable_new_requests
                      );
                      
                      const hasRequests = userRequests.length > 0;
                      const shouldShow = enableNewRequests || (!isPublic && hasRequests);
                      
                      if (!shouldShow) return null;
                      
                      return (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-semibold text-gray-700">{t('account.myRequests')}</h4>
                            {enableNewRequests && (
                              <button
                                onClick={handleCreateRequest}
                                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1">
                                <span>{t('account.createRequest')}</span>
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {!isPublic && (userRequests.length === 0 ? (
                            <div key="no-requests-message" className="text-center py-4">
                              <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                              <p className="text-sm text-gray-500">{t('account.noRequestsYet')}</p>
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
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <FileText className="w-5 h-5 text-blue-600" />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
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
                                                pending: t('account.pending'),
                                                approved: t('account.approved'),
                                                rejected: t('account.rejected'),
                                                mixed: t('account.mixed')
                                              };
                                              return statusConfig[status] || statusConfig.pending;
                                            })()}
                                          </span>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                          {request.groups_count} {request.groups_count !== 1 ? t('account.groups') : t('account.group')} • {formatDate(request.requested_at)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {(() => {
                                        const status = request.status || 'pending';
                                        const isClosed = status !== 'pending';
                                        const isDeletable = request.is_deletable !== false; // Default to true if not set
                                        return isClosed ? (
                                          <button
                                            onClick={() => handleEditRequest(request)}
                                            className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                            title={t('account.viewRequest')}
                                            aria-label={t('account.viewRequest')}
                                          >
                                            <Eye className="w-4 h-4 text-blue-600" />
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => handleEditRequest(request)}
                                              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                              title={t('account.editRequest')}
                                              aria-label={t('account.editRequest')}
                                            >
                                              <Edit2 className="w-4 h-4 text-blue-600" />
                                            </button>
                                            {isDeletable && (
                                              <button
                                                onClick={() => handleDeleteRequest(request)}
                                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                                title={t('account.deleteRequest')}
                                                aria-label={t('account.deleteRequest')}
                                              >
                                                <Trash2 className="w-4 h-4 text-red-600" />
                                              </button>
                                            )}
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
                            <h4 className="text-sm font-semibold text-gray-700">{t('account.myFeedbacks')}</h4>
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
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                      feedback.type === 0 ? 'bg-red-100' : 'bg-green-100'
                                    }`}>
                                      <MessageSquare className={`w-5 h-5 ${
                                        feedback.type === 0 ? 'text-red-600' : 'text-green-600'
                                      }`} />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium text-gray-900">{feedback.title}</p>
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                          isClosed 
                                            ? (feedback.solved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700')
                                            : 'bg-blue-100 text-blue-700'
                                        }`}>
                                          {isClosed ? (feedback.solved ? t('account.solved') : t('account.closed')) : t('account.open')}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-500">
                                        {feedback.type === 0 ? t('account.bugReport') : t('account.suggestion')} • {formatDate(feedback.created_at)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {isClosed ? (
                                      <button
                                        onClick={() => handleEditMyFeedback(feedback)}
                                        className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                        title={t('account.viewFeedback')}
                                        aria-label={t('account.viewFeedback')}
                                      >
                                        <Eye className="w-4 h-4 text-blue-600" />
                                      </button>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => handleEditMyFeedback(feedback)}
                                          className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                          title={t('account.editFeedback')}
                                          aria-label={t('account.editFeedback')}
                                        >
                                          <Edit2 className="w-4 h-4 text-blue-600" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteMyFeedback(feedback)}
                                          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                          title={t('account.deleteFeedback')}
                                          aria-label={t('account.deleteFeedback')}
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
                  title={t('account.close')}
                  aria-label={t('account.close')}
                >
                  {t('account.close')}
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
          title={t('account.deleteRequestTitle')}
          message={t('account.deleteRequestMessage')}
          itemName={requestToDelete.applicant_name}
          confirmText={t('account.delete')}
          cancelText={t('account.cancel')}
          caption={t('account.thisActionCannotBeUndone')}
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
          title={t('account.deleteFeedbackTitle')}
          message={t('account.deleteFeedbackMessage')}
          itemName={myFeedbackToDelete.title}
          confirmText={t('account.delete')}
          cancelText={t('account.cancel')}
          caption={t('account.thisActionCannotBeUndone')}
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
          title={t('account.account')}
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
