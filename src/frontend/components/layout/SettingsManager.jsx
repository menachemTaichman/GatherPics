import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, X, Archive, User, Info, MessageSquare, Edit2, Plus, LogOut, Lock, Trash2, Copy, RotateCcw, Link, HelpCircle, Minus, FileText } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { getPreference, setPreference } from '../../utils/settings';
import { profilesAPI, requestsAPI } from '../../utils/apiService';
import { useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile, setCurrentProfile } from '../../utils/profileService';
import { useProfilesList, useRequestsList } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { useEventUrls } from '../../hooks/useEventUrls';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/authContext';
import { ChangePasswordModal, EditProfileModal } from '../profiles';
import { ConfirmDelete } from '../modals';
import { RequestFormModal } from '../requests';
import { PermissionGate } from '../common';
import { usePermissions } from '../../hooks/usePermissions';

export default function SettingsManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [includeArchived, setIncludeArchived] = useState(getPreference('general.includeArchived', false));
  const { eventUrl } = useParams();
  const { showToast } = useToast();
  const { urlHelpers } = useEventUrls(eventUrl);
  const permissions = usePermissions();
  const { logout } = useAuth();
  
  // Profile management state
  const currentProfile = getCurrentProfile();
  const allProfiles = useProfilesList();
  const [editingCurrentProfile, setEditingCurrentProfile] = useState(false);
  const [currentProfileLabel, setCurrentProfileLabel] = useState('');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profileToDelete, setProfileToDelete] = useState(null);
  const [profileNameConflict, setProfileNameConflict] = useState(false);
  const [isCreatingNewProfile, setIsCreatingNewProfile] = useState(false);
  const [showPublicAccessTooltip, setShowPublicAccessTooltip] = useState(false);
  
  // Requests state
  const [showRequestFormModal, setShowRequestFormModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [showDeleteRequestModal, setShowDeleteRequestModal] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState(null);
  const [openRequestsCount, setOpenRequestsCount] = useState(0);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'settings-manager';

  // Register modal when opened, unregister when closed
  useEffect(() => {
    if (isOpen) {
      // Apply scopes based on active tab
      let scopes = [];
      if (activeTab === 'profiles') {
        scopes = [{ entity: 'all', id: 'profiles' }];
      } else if (activeTab === 'account' && currentProfile?.id) {
        scopes = [
          { entity: 'profile', id: String(currentProfile.id) },
          { entity: 'all', id: 'access_requests' }
        ];
      }
      
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes
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
  }, [isOpen, activeTab, registerModal, unregisterModal, currentProfile?.id]);

  // Apply scopes based on active tab
  useApplyScopes(
    isOpen && activeTab === 'profiles' 
      ? [{ entity: 'all', id: 'profiles' }] 
      : isOpen && activeTab === 'account' && currentProfile?.id
      ? [
          { entity: 'profile', id: String(currentProfile.id) },
          { entity: 'all', id: 'access_requests' }
        ]
      : []
  );

  // Fetch profiles when profiles tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'profiles' && eventUrl) {
      fetchProfiles();
    }
  }, [isOpen, activeTab, eventUrl]);

  // Fetch current profile when account tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'account' && eventUrl && currentProfile?.id) {
      fetchCurrentProfile();
    }
  }, [isOpen, activeTab, eventUrl, currentProfile?.id]);

  // Fetch open requests count when profiles tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'profiles' && eventUrl && permissions.isProfilesManager) {
      fetchOpenRequestsCount();
    }
  }, [isOpen, activeTab, eventUrl, permissions.isProfilesManager]);

  const fetchCurrentProfile = async () => {
    try {
      await profilesAPI.getById(currentProfile.id, eventUrl);
      // Changes are automatically applied by apiService interceptor
    } catch (error) {
      console.error('Failed to fetch current profile:', error);
    }
  };

  const fetchProfiles = async () => {
    try {
      await profilesAPI.getAll(eventUrl);
      // Changes are automatically applied by apiService interceptor
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
    }
  };

  const fetchOpenRequestsCount = async () => {
    try {
      const result = await requestsAPI.getOpenCount(eventUrl);
      setOpenRequestsCount(result.count || 0);
    } catch (error) {
      console.error('Failed to fetch open requests count:', error);
      setOpenRequestsCount(0);
    }
  };

  // Custom keyboard handler to prevent ESC from closing modal when editing
  const handleSettingsKeys = useCallback((e) => {
    // If a child modal is open (like ChangePasswordModal or EditProfileModal), let events pass through
    if (showChangePasswordModal || showEditProfileModal || showDeleteConfirmModal) {
      return true; // Return true to prevent this modal from stopping propagation to child modal
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
  }, [showChangePasswordModal, showEditProfileModal, showDeleteConfirmModal]);

  const { modalRef } = useModalFocus(isOpen, () => setIsOpen(false), {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    // Disable focus trapping when child modal is open so child can receive focus
    enableFocusTrapping: !showChangePasswordModal && !showEditProfileModal && !showDeleteConfirmModal,
    customKeyHandler: handleSettingsKeys
  });

  // Filter tabs based on permissions
  const allTabs = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'profiles', label: 'Profiles', icon: User },
    { id: 'about', label: 'About', icon: Info },
    { id: 'feedback', label: 'Feedback', icon: MessageSquare }
  ];
  
  const tabs = allTabs.filter(tab => {
    // Hide profiles tab if not a profiles manager
    if (tab.id === 'profiles' && !permissions.isProfilesManager) {
      return false;
    }
    return true;
  });

  // Ensure active tab is valid when modal opens
  useEffect(() => {
    if (isOpen) {
      const activeTabExists = tabs.some(tab => tab.id === activeTab);
      if (!activeTabExists && tabs.length > 0) {
        setActiveTab(tabs[0].id);
      }
    }
  }, [isOpen, tabs, activeTab]);


  const handleIncludeArchivedChange = (checked) => {
    setIncludeArchived(checked);
    setPreference('general.includeArchived', checked);
  };

  // Profile management functions
  const handleCurrentProfileSave = async () => {
    if (!currentProfileLabel.trim() || profileNameConflict) {
      if (!currentProfileLabel.trim()) {
        showToast('Profile name cannot be empty', 'error');
      }
      return;
    }

    try {
      await profilesAPI.update(currentProfile.id, { label: currentProfileLabel.trim() }, eventUrl);
      // Update local storage
      setCurrentProfile({ ...currentProfile, label: currentProfileLabel.trim() });
      showToast('Profile name updated', 'success');
      setEditingCurrentProfile(false);
      setProfileNameConflict(false);
    } catch (error) {
      console.error('Failed to update profile name:', error);
      showToast(formatErrorMessage('update profile name', error), 'error');
    }
  };

  const handleCurrentProfileCancel = () => {
    setEditingCurrentProfile(false);
    setCurrentProfileLabel(currentProfile?.label || '');
    setProfileNameConflict(false);
  };

  const checkCurrentProfileNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setProfileNameConflict(false);
      return;
    }

    // Debounce the check
    if (checkCurrentProfileNameConflict._timeout) {
      clearTimeout(checkCurrentProfileNameConflict._timeout);
    }
    
    checkCurrentProfileNameConflict._timeout = setTimeout(async () => {
      try {
        const result = await profilesAPI.checkName(label.trim(), currentProfile.id);
        setProfileNameConflict(result.conflict || false);
      } catch (error) {
        console.error('Error checking name conflict:', error);
        setProfileNameConflict(false);
      }
    }, 300);
  };

  const handleEditProfile = (profile) => {
    setSelectedProfile(profile);
    setShowEditProfileModal(true);
  };

  const handleCreateProfile = () => {
    // Create a blank profile template for the modal
    const newProfileTemplate = {
      id: null, // null signals creation mode
      label: 'New Profile',
      hierarchy_rank: 0,
      can_upload_and_delete_images: 0,
      can_edit: 0,
      all_images: 0,
      all_groups: 0,
      all_albums: 0,
      is_public: 0
    };
    
    setSelectedProfile(newProfileTemplate);
    setIsCreatingNewProfile(true);
    setShowEditProfileModal(true);
  };

  const handleDeleteProfile = (profile) => {
    setProfileToDelete(profile);
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDeleteProfile = async () => {
    if (!profileToDelete) return;

    try {
      await profilesAPI.delete(profileToDelete.id, eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(`Profile "${profileToDelete.label}" deleted`, 'success');
    } catch (error) {
      console.error('Failed to delete profile:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to delete profile';
      showToast(errorMsg, 'error');
    } finally {
      setProfileToDelete(null);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setIsOpen(false); // Close settings modal
  };

  // Public access code management functions
  const handleCopyPublicLink = async (profile) => {
    try {
      const publicCode = profile.public_access_code;
      if (!publicCode) {
        showToast('No public access code available. Generate one first.', 'error');
        return;
      }
      
      const publicUrl = `${window.location.origin}/${eventUrl}/public-access/${publicCode}`;
      await navigator.clipboard.writeText(publicUrl);
      showToast('Public link copied to clipboard', 'success');
    } catch (error) {
      console.error('Failed to copy link:', error);
      showToast('Failed to copy link', 'error');
    }
  };

  const handleResetPublicCode = async (profile) => {
    try {
      const result = await profilesAPI.resetPublicAccessCode(profile.id, eventUrl);
      showToast('Public access code reset', 'success');
      
      // Auto-copy the new link
      if (result.public_code) {
        const publicUrl = `${window.location.origin}/${eventUrl}/public-access/${result.public_code}`;
        try {
          await navigator.clipboard.writeText(publicUrl);
          showToast('Public link copied to clipboard', 'success');
        } catch (copyError) {
          console.error('Failed to copy link:', copyError);
          showToast('Link created but failed to copy', 'warning');
        }
      }
      
      // Refresh profiles list
      await fetchProfiles();
    } catch (error) {
      console.error('Failed to reset public access code:', error);
      showToast(formatErrorMessage('reset public access code', error), 'error');
    }
  };

  const handleRemovePublicCode = async (profile) => {
    try {
      await profilesAPI.removePublicAccessCode(profile.id, eventUrl);
      showToast('Public access code removed', 'success');
      // Refresh profiles list
      await fetchProfiles();
    } catch (error) {
      console.error('Failed to remove public access code:', error);
      showToast(formatErrorMessage('remove public access code', error), 'error');
    }
  };

  // Get other profiles (exclude current) and sort by rank desc, then label asc
  const currentProfileIdToCompare = currentProfile?.id || currentProfile?.profile_id;
  const otherProfiles = allProfiles
    .filter(p => {
      const profileIdToCheck = p.id || p.profile_id;
      return profileIdToCheck !== currentProfileIdToCompare;
    })
    .sort((a, b) => {
      // Sort by rank descending, then by label ascending
      const rankA = a.hierarchy_rank || 0;
      const rankB = b.hierarchy_rank || 0;
      if (rankA !== rankB) {
        return rankB - rankA; // descending
      }
      return (a.label || '').localeCompare(b.label || ''); // ascending
    });

  // Requests handlers
  const handleCreateRequest = () => {
    setEditingRequest(null);
    setShowRequestFormModal(true);
  };

  const handleEditRequest = (request) => {
    setEditingRequest(request);
    setShowRequestFormModal(true);
  };

  const handleDeleteRequest = (request) => {
    setRequestToDelete(request);
    setShowDeleteRequestModal(true);
  };

  const handleConfirmDeleteRequest = async () => {
    if (!requestToDelete) return;

    try {
      await requestsAPI.delete(requestToDelete.access_request_id, eventUrl);
      showToast(`Request deleted`, 'success');
    } catch (error) {
      console.error('Failed to delete request:', error);
      showToast(formatErrorMessage('delete request', error), 'error');
    } finally {
      setRequestToDelete(null);
    }
  };

  // Get user's requests
  const allRequests = useRequestsList();
  const userRequests = allRequests.filter(req => req.profile_id === (currentProfile?.id || currentProfile?.profile_id));

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center text-gray-700"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

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
                      <Settings className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
                      <p className="text-sm text-gray-500">Manage your preferences</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200 px-6">
                  <div className="flex space-x-1">
                    {tabs.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                            activeTab === tab.id
                              ? 'border-primary-500 text-primary-600'
                              : 'border-transparent text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="font-medium">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  <AnimatePresence mode="wait">
                    {activeTab === 'account' && (
                      <motion.div
                        key="account"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ 
                          opacity: 1, 
                          y: 0
                        }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-6"
                      >
                        {/* Current Profile Section */}
                        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-100">
                          <h3 className="text-sm font-semibold text-gray-700 mb-3">Current Profile</h3>
                          
                          <div className="flex items-center space-x-3">
                            {/* Profile Name - Read Only */}
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                              <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
                                {currentProfile?.label || 'Not set'}
                              </div>
                            </div>

                            {/* Hierarchy Rank - Read Only */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Rank</label>
                              <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
                                {currentProfile?.hierarchy_rank || 0}
                              </div>
                            </div>

                            {/* Change Password Button - Only show if not public */}
                            {!currentProfile?.is_public && (
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">&nbsp;</label>
                                <button
                                  onClick={() => setShowChangePasswordModal(true)}
                                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 whitespace-nowrap"
                                  title="Change password"
                                >
                                  <Lock className="w-4 h-4" />
                                  <span>Change Password</span>
                                </button>
                              </div>
                            )}
                          </div>
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

                        {/* My Requests Section */}
                        <PermissionGate requires="enable_requests">
                          <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="text-sm font-semibold text-gray-700">My Requests</h4>
                              <button
                                onClick={handleCreateRequest}
                                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-1"
                              >
                                <Plus className="w-4 h-4" />
                                <span>Create Request</span>
                              </button>
                            </div>
                            
                            {currentProfile?.is_public ? (
                              <div className="text-center py-4">
                                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">Public profiles can only create requests for new profiles</p>
                              </div>
                            ) : userRequests.length === 0 ? (
                              <div className="text-center py-4">
                                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">No requests yet</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {userRequests.map((request) => (
                                  <div
                                    key={request.access_request_id}
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
                                            request.is_closed 
                                              ? (request.groups_approved_count === request.groups_count ? 'bg-green-100 text-green-700' : 
                                                 request.groups_approved_count === 0 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700')
                                              : 'bg-blue-100 text-blue-700'
                                          }`}>
                                            {request.is_closed 
                                              ? (request.groups_approved_count === request.groups_count ? 'Approved' : 
                                                 request.groups_approved_count === 0 ? 'Denied' : 'Partial')
                                              : 'Pending'}
                                          </span>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                          {request.groups_count} group{request.groups_count !== 1 ? 's' : ''} • {new Date(request.requested_at).toLocaleDateString()}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-1">
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
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </PermissionGate>

                        {/* Sign Out */}
                        <div className="pt-4 border-t border-gray-200">
                          <button
                            onClick={handleSignOut}
                            className="w-full px-4 py-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium flex items-center justify-center space-x-2 border border-red-200"
                          >
                            <LogOut className="w-4 h-4" />
                            <span>Sign Out</span>
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'profiles' && (
                      <motion.div
                        key="profiles"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                      >
                        <PermissionGate requires="isProfilesManager">
                          {/* Other Profiles Section */}
                          <div className="bg-gray-50 rounded-lg p-4">
                          {/* Header with explanation tooltip */}
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-sm font-semibold text-gray-700">Profiles</h3>
                              {openRequestsCount > 0 && (
                                <div className="flex items-center space-x-2">
                                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                                    <span className="text-xs font-medium text-blue-600">{openRequestsCount}</span>
                                  </div>
                                  <span className="text-xs text-gray-500">open requests</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => urlHelpers.navigateToRequests()}
                                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-1"
                              >
                                <FileText className="w-4 h-4" />
                                <span>View Requests</span>
                              </button>
                              <div className="relative">
                                <button
                                  onMouseEnter={() => setShowPublicAccessTooltip(true)}
                                  onMouseLeave={() => setShowPublicAccessTooltip(false)}
                                  className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                  <HelpCircle className="w-5 h-5" />
                                </button>
                                {showPublicAccessTooltip && (
                                  <div className="absolute right-0 top-6 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                                    <p className="mb-2 font-medium">Public Access Codes</p>
                                    <p className="mb-1">• Public profiles can be accessed via direct links</p>
                                    <p className="mb-1">• Copy link: Share the public access URL</p>
                                    <p className="mb-1">• Reset link: Generate a new access code</p>
                                    <p>• Remove link: Disable public access</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Create Profile Button */}
                          <button
                            onClick={handleCreateProfile}
                            className="w-full mb-4 px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors flex items-center justify-center space-x-2 text-gray-600 hover:text-green-600 font-medium"
                          >
                            <Plus className="w-5 h-5" />
                            <span>Create New Profile</span>
                          </button>

                          {otherProfiles.length === 0 ? (
                            <p className="text-gray-500 text-sm text-center py-4">No other profiles</p>
                          ) : (
                            <div className="space-y-2">
                              {otherProfiles.map((profile) => (
                                <div
                                  key={profile.id}
                                  className="flex items-center justify-between py-3 px-4 bg-white rounded-lg hover:shadow-sm transition-shadow"
                                >
                                  <div className="flex items-center space-x-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                      profile.is_public ? 'bg-green-100' : 'bg-purple-100'
                                    }`}>
                                      <User className={`w-5 h-5 ${
                                        profile.is_public ? 'text-green-600' : 'text-purple-600'
                                      }`} />
                                    </div>
                                    <div>
                                      <div className="flex items-center space-x-2">
                                        <p className="font-medium text-gray-900">{profile.label}</p>
                                        {profile.is_public ? (
                                          <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">
                                            Public
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="text-xs text-gray-500">Rank {profile.hierarchy_rank || 0}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    {/* Public access code buttons - only show for public profiles */}
                                    {profile.is_public ? (
                                      <>
                                        {profile.public_access_code ? (
                                          <>
                                            <button
                                              onClick={() => handleCopyPublicLink(profile)}
                                              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                              title={`Copy public link: ${window.location.origin}/${eventUrl}/public-access/${profile.public_access_code}`}
                                            >
                                              <Link className="w-4 h-4 text-blue-600" />
                                            </button>
                                            <button
                                              onClick={() => handleResetPublicCode(profile)}
                                              className="p-2 hover:bg-yellow-100 rounded-lg transition-colors"
                                              title="Reset public access code"
                                            >
                                              <RotateCcw className="w-4 h-4 text-yellow-600" />
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => handleResetPublicCode(profile)}
                                            className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                                            title="Create public access code"
                                          >
                                            <Link className="w-4 h-4 text-green-600" />
                                          </button>
                                        )}
                                        {profile.public_access_code ? (
                                          <button
                                            onClick={() => handleRemovePublicCode(profile)}
                                            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                            title="Remove public access code"
                                          >
                                            <Minus className="w-4 h-4 text-red-600" />
                                          </button>
                                        ) : null}
                                      </>
                                    ) : null}
                                    <button
                                      onClick={() => handleEditProfile(profile)}
                                      className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                      title="Edit profile"
                                    >
                                      <Edit2 className="w-4 h-4 text-blue-600" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteProfile(profile)}
                                      className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                      title="Delete profile"
                                    >
                                      <Trash2 className="w-4 h-4 text-red-600" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          </div>
                        </PermissionGate>
                      </motion.div>
                    )}

                    {activeTab === 'about' && (
                      <motion.div
                        key="about"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                      >
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">About Face Gallery</h3>
                          
                          <div className="space-y-4">
                            {/* App Info */}
                            <div className="bg-gradient-to-br from-primary-50 to-primary-100 rounded-lg p-6">
                              <h4 className="text-2xl font-bold text-primary-900 mb-2">Face Gallery</h4>
                              <p className="text-primary-700 mb-4">AI-Powered Face Recognition System</p>
                              <p className="text-sm text-primary-600">
                                An intelligent photo management system that automatically organizes your photos by recognizing faces and creating smart albums.
                              </p>
                            </div>

                            {/* Contact */}
                            <div className="bg-gray-50 rounded-lg p-6">
                              <h4 className="font-semibold text-gray-900 mb-3">Contact</h4>
                              <div className="flex items-center space-x-2 text-gray-700">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                <a href="mailto:meTaichman@gmail.com" className="hover:text-primary-600 transition-colors">
                                  meTaichman@gmail.com
                                </a>
                              </div>
                            </div>

                            {/* Copyright */}
                            <div className="bg-gray-50 rounded-lg p-6">
                              <h4 className="font-semibold text-gray-900 mb-3">Copyright</h4>
                              <p className="text-sm text-gray-600">
                                © {new Date().getFullYear()} Face Gallery. All rights reserved.
                              </p>
                              <p className="text-xs text-gray-500 mt-2">
                                This software is provided as-is without any warranties.
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'feedback' && (
                      <motion.div
                        key="feedback"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Feedback</h3>
                          <div className="bg-gray-50 rounded-lg p-8 text-center">
                            <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-600">Feedback form will be available soon.</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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

      {/* Change Password Modal for Current Profile */}
      {showChangePasswordModal && currentProfile && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          profileId={currentProfile.id}
          profileLabel={currentProfile.label}
          eventUrl={eventUrl}
        />
      )}

      {/* Edit Profile Modal for Other Profiles */}
      {showEditProfileModal && selectedProfile && (
        <EditProfileModal
          isOpen={showEditProfileModal}
          onClose={() => {
            setShowEditProfileModal(false);
            setSelectedProfile(null);
            setIsCreatingNewProfile(false);
          }}
          profile={selectedProfile}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          isCreating={isCreatingNewProfile}
          onSave={() => {
            // Changes are automatically applied by apiService interceptor
            setIsCreatingNewProfile(false);
          }}
        />
      )}

      {/* Delete Profile Confirmation Modal */}
      {showDeleteConfirmModal && profileToDelete && (
        <ConfirmDelete
          isOpen={showDeleteConfirmModal}
          onClose={() => {
            setShowDeleteConfirmModal(false);
            setProfileToDelete(null);
          }}
          onConfirm={handleConfirmDeleteProfile}
          title="Delete Profile"
          message="Are you sure you want to delete profile"
          itemName={profileToDelete.label}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}

      {/* Delete Request Confirmation Modal */}
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

      {/* Request Form Modal */}
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
    </>
  );
}



