import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, X, Upload, Archive, User, Info, MessageSquare, Loader2, Check, AlertCircle, AlertTriangle, Edit2, Plus, Save, RotateCcw, LogOut, Lock, Trash2 } from 'lucide-react';
import { useModalFocus } from '../utils/useModalFocus';
import { useModalManager } from '../utils/modalManager';
import { getPreference, setPreference } from '../utils/settings';
import { imagesAPI, profilesAPI } from '../utils/apiService';
import { useParams } from 'react-router-dom';
import { useToast } from '../utils/ToastContext';
import { getCurrentProfile, setCurrentProfile } from '../utils/profileService';
import { useProfilesList } from '../utils/dataManager';
import { useApplyScopes } from '../utils/storeUtils';
import { useEventUrls } from '../utils/useEventUrls';
import jwtService from '../utils/jwtService';
import { formatErrorMessage } from '../utils/errorHandler';
import { useAuth } from '../utils/authContext';
import { sortByField } from '../utils/sorting';
import ChangePasswordModal from './ChangePasswordModal';
import EditProfileModal from './EditProfileModal';
import ConfirmDelete from './ConfirmDelete';
import PermissionGate from './PermissionGate';
import { usePermissions } from '../utils/usePermissions';
import UploadImagesModal from './UploadImagesModal';

export default function SettingsManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [includeArchived, setIncludeArchived] = useState(getPreference('general.includeArchived', false));
  const [uploadLimits, setUploadLimits] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
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
        scopes = [{ entity: 'profile', id: String(currentProfile.id) }];
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
      ? [{ entity: 'profile', id: String(currentProfile.id) }]
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

  // Custom keyboard handler to prevent ESC from closing modal when editing
  const handleSettingsKeys = useCallback((e) => {
    // If a child modal is open (like ChangePasswordModal or EditProfileModal), let events pass through
    if (showChangePasswordModal || showEditProfileModal || showDeleteConfirmModal || showUploadModal) {
      return true; // Return true to prevent this modal from stopping propagation to child modal
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
  }, [showChangePasswordModal, showEditProfileModal, showDeleteConfirmModal, showUploadModal]);

  const { modalRef } = useModalFocus(isOpen, () => setIsOpen(false), {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    // Disable focus trapping when child modal is open so child can receive focus
    enableFocusTrapping: !showChangePasswordModal && !showEditProfileModal && !showDeleteConfirmModal && !showUploadModal,
    customKeyHandler: handleSettingsKeys
  });

  // Filter tabs based on permissions
  const allTabs = [
    { id: 'general', label: 'General', icon: Settings },
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
    // Hide general tab if can't upload AND has no archive access (nothing to show)
    if (tab.id === 'general' && !permissions.canUploadAndDeleteImages && !permissions.hasArchiveAlbum) {
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

  // Fetch upload limits when opening settings
  useEffect(() => {
    if (isOpen && eventUrl) {
      fetchUploadLimits();
    }
  }, [isOpen, eventUrl]);

  const fetchUploadLimits = async () => {
    try {
      const limits = await imagesAPI.getUploadLimits(eventUrl);
      setUploadLimits(limits);
    } catch (error) {
      console.error('Failed to fetch upload limits:', error);
    }
  };

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
      all_albums: 0,
      save_preferences: 0
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

  // Get other profiles (exclude current) and sort by rank desc, then label asc
  const otherProfiles = allProfiles
    .filter(p => p.id !== currentProfile?.id)
    .sort((a, b) => {
      // Sort by rank descending, then by label ascending
      const rankA = a.hierarchy_rank || 0;
      const rankB = b.hierarchy_rank || 0;
      if (rankA !== rankB) {
        return rankB - rankA; // descending
      }
      return (a.label || '').localeCompare(b.label || ''); // ascending
    });

  const handleUploadComplete = async (result) => {
    // Refresh upload limits after successful upload
    await fetchUploadLimits();
  };

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
                    {activeTab === 'general' && (
                      <motion.div
                        key="general"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ 
                          opacity: 1, 
                          y: 0
                        }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-6"
                      >
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">General Settings</h3>
                          
                          {/* Include Archived */}
                          <PermissionGate requires="hasArchiveAlbum">
                            <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
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
                          </PermissionGate>

                          {/* Upload Photos */}
                          <PermissionGate requires="canUploadAndDeleteImages">
                            <button
                              onClick={() => setShowUploadModal(true)}
                              className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors w-full"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                                  <Upload className="w-5 h-5 text-gray-600" />
                                </div>
                                <div className="text-left">
                                  <p className="font-medium text-gray-900">Upload Photos</p>
                                  <p className="text-sm text-gray-500">Add new photos to the gallery</p>
                                </div>
                              </div>
                              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </PermissionGate>
                        </div>
                      </motion.div>
                    )}

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
                        {permissions.isProfilesManager ? (
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

                              {/* Change Password Button */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">&nbsp;</label>
                                <button
                                  onClick={() => setShowChangePasswordModal(true)}
                                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 whitespace-nowrap"
                                >
                                  <Lock className="w-4 h-4" />
                                  <span>Change Password</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-6 border border-blue-100">
                            <div className="flex items-center space-x-4">
                              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                <User className="w-8 h-8 text-white" />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-gray-600 mb-1">Current Profile</p>
                                <h3 className="text-2xl font-bold text-gray-900">{currentProfile?.label || 'Not set'}</h3>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Sign Out */}
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3">Sign Out</h4>
                          <button
                            onClick={handleSignOut}
                            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center justify-center space-x-2"
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
                                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                                      <User className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-gray-900">{profile.label}</p>
                                      <p className="text-xs text-gray-500">Rank {profile.hierarchy_rank}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2">
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

      {/* Upload Images Modal */}
      {showUploadModal && (
        <UploadImagesModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          eventUrl={eventUrl}
          uploadLimits={uploadLimits}
          onUploadComplete={handleUploadComplete}
        />
      )}
    </>
  );
}
