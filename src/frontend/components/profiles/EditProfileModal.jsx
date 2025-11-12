import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Lock, Shield, Image as ImageIcon, FolderOpen, Users, AlertTriangle, AlertCircle, Save, Trash2 } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { profilesAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile } from '../../utils/profileService';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { useDataStore, useProfileById } from '../../utils/dataManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ChangePasswordModal } from './';
import { RemovableThumbnail } from '../common';

export default function EditProfileModal({ isOpen, onClose, profile, eventUrl, urlHelpers, onSave, isCreating = false }) {
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const MODAL_ID = 'edit-profile-modal';
  const currentProfile = getCurrentProfile();
  
  // Get general profile data (includes email and other general fields)
  const generalProfile = useProfileById(profile?.id);
  
  // Local editing state
  const [editingProfile, setEditingProfile] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Apply scopes for profile relations
  useApplyScopes(profile?.id ? [
    { entity: 'event_profile', id: String(profile.id), eventId },
    { entity: 'profile', id: String(profile.id), eventId: 'general' }
  ] : []);
  
  // Get profile images, albums, and groups from store
  const profileImages = useChilds(eventId, 'event_profiles', profile?.id, 'images', { sortBy: 'date', sortOrder: 'asc' });
  const profileAlbums = useChilds(eventId, 'event_profiles', profile?.id, 'albums', { sortBy: 'name', sortOrder: 'asc' });
  const profileGroups = useChilds(eventId, 'event_profiles', profile?.id, 'groups', { sortBy: 'name', sortOrder: 'asc' });

  const restrictedToEventId = generalProfile?.restricted_to_event ?? null;
  const matchesCurrentEvent =
    !!restrictedToEventId && !!eventId
      ? String(restrictedToEventId) === String(eventId)
      : false;
  const disablePublicToggle = !isCreating && !!generalProfile && !matchesCurrentEvent;

  // Custom keyboard handler to allow child modal to work
  const handleEditProfileKeys = (e) => {
    // If password modal is open, let events pass through to child modal
    if (showPasswordModal) {
      return true; // Return true to prevent this modal from stopping propagation to child modal
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, save the profile
      if (e.key === 'Enter' && !loading && !nameConflict && editingProfile?.label.trim()) {
        e.preventDefault();
        handleSave();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
  };

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: MODAL_ID,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: !showPasswordModal, // Disable when child modal is open
    customKeyHandler: handleEditProfileKeys
  });

  // Register modal (scopes managed by useApplyScopes above)
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
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, profile?.id]);

  // Initialize editing state from merged profile data (only once when modal opens)
  useEffect(() => {
    if (isOpen && profile) {
      // Use the merged profile for initial data, but only set it once
      const initialProfile = generalProfile ? { ...profile, ...generalProfile } : profile;
      setEditingProfile({
        id: initialProfile.id || initialProfile.profile_id,
        label: initialProfile.label || '',
        email: initialProfile.email || '',
        hierarchy_rank: initialProfile.hierarchy_rank || 0,
        can_upload_and_delete_images: initialProfile.can_upload_and_delete_images || 0,
        can_edit: initialProfile.can_edit || 0,
        all_images: initialProfile.all_images || 0,
        all_groups: initialProfile.all_groups || 0,
        all_albums: initialProfile.all_albums || 0,
        is_public: initialProfile.is_public || 0
      });
      setNameConflict(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profile?.id]); // Only re-initialize when modal opens or profile ID changes (generalProfile intentionally excluded to prevent input resets)

  // Update email when generalProfile loads (after initial render)
  useEffect(() => {
    if (isOpen && !isCreating && generalProfile?.email && editingProfile && !editingProfile.email) {
      setEditingProfile(prev => ({ ...prev, email: generalProfile.email }));
    }
  }, [isOpen, isCreating, generalProfile?.email, editingProfile?.email]);

  // Fetch profile with scopes (images and albums relations) when modal opens
  useEffect(() => {
    const fetchProfileWithScopes = async () => {
      if (!isOpen || !profile || isCreating) return;
      
      try {
        await profilesAPI.getById(profile.id, eventUrl);
      } catch (error) {
        console.error('Failed to fetch profile with scopes:', error);
        showToast(formatErrorMessage('load profile details', error), 'error');
      }
    };

    fetchProfileWithScopes();
  }, [isOpen, profile?.id, eventUrl, isCreating, showToast]);

  const checkNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      const result = await profilesAPI.checkName(label.trim(), editingProfile.id);
      setNameConflict(result.conflict || false);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setEditingProfile(prev => ({ ...prev, [field]: value }));
    
    // Debounce name conflict check
    if (field === 'label') {
      if (handleFieldChange._timeout) clearTimeout(handleFieldChange._timeout);
      handleFieldChange._timeout = setTimeout(() => {
        checkNameConflict(value);
      }, 300);
    }
  };

  const handleSave = async () => {
    if (nameConflict) {
      showToast('Cannot save: Profile name already exists', 'error');
      return;
    }

    if (!editingProfile.label.trim()) {
      showToast('Profile name cannot be empty', 'error');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const profileData = {
        label: editingProfile.label,
        email: editingProfile.email || null,
        hierarchy_rank: editingProfile.hierarchy_rank,
        can_upload_and_delete_images: editingProfile.can_upload_and_delete_images,
        can_edit: editingProfile.can_edit,
        all_images: editingProfile.all_images,
        all_groups: editingProfile.all_groups,
        all_albums: editingProfile.all_albums,
        is_public: editingProfile.is_public
      };

      if (isCreating) {
        // Create new profile
        await profilesAPI.create(profileData, eventUrl);
        showToast(`Profile "${editingProfile.label}" created successfully`, 'success');
      } else {
        // Update existing profile
        await profilesAPI.update(editingProfile.id, profileData, eventUrl);
        showToast('Profile updated successfully', 'success');
      }
      
      // Changes are automatically applied by apiService interceptor
      
      if (onSave) onSave();
      onClose();
    } catch (error) {
      console.error(`Failed to ${isCreating ? 'create' : 'update'} profile:`, error);
      const errorMsg = error.response?.data?.error || error.message || `Failed to ${isCreating ? 'create' : 'update'} profile`;
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveImage = async (imageId) => {
    try {
      await profilesAPI.removeImagesFromProfile(editingProfile.id, [imageId], eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast('Image removed from profile', 'success');
    } catch (error) {
      console.error('Failed to remove image:', error);
      showToast(formatErrorMessage('remove image', error), 'error');
    }
  };

  const handleRemoveAlbum = async (albumId) => {
    try {
      await profilesAPI.removeAlbumsFromProfile(editingProfile.id, [albumId], eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast('Album removed from profile', 'success');
    } catch (error) {
      console.error('Failed to remove album:', error);
      showToast(formatErrorMessage('remove album', error), 'error');
    }
  };

  const handleClearAllImages = async () => {
    if (profileImages.length === 0) return;
    
    try {
      const imageIds = profileImages.map(img => img.id);
      await profilesAPI.removeImagesFromProfile(editingProfile.id, imageIds, eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(`${imageIds.length} images cleared from profile`, 'success');
    } catch (error) {
      console.error('Failed to clear images:', error);
      showToast(formatErrorMessage('clear images', error), 'error');
    }
  };

  const handleClearAllAlbums = async () => {
    if (profileAlbums.length === 0) return;
    
    try {
      const albumIds = profileAlbums.map(album => album.id);
      await profilesAPI.removeAlbumsFromProfile(editingProfile.id, albumIds, eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(`${albumIds.length} albums cleared from profile`, 'success');
    } catch (error) {
      console.error('Failed to clear albums:', error);
      showToast(formatErrorMessage('clear albums', error), 'error');
    }
  };

  const handleRemoveGroup = async (groupId) => {
    try {
      await profilesAPI.removeGroupsFromProfile(editingProfile.id, [groupId], eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast('Group removed from profile', 'success');
    } catch (error) {
      console.error('Failed to remove group:', error);
      showToast(formatErrorMessage('remove group', error), 'error');
    }
  };

  const handleClearAllGroups = async () => {
    if (profileGroups.length === 0) return;
    
    try {
      const groupIds = profileGroups.map(group => group.id);
      await profilesAPI.removeGroupsFromProfile(editingProfile.id, groupIds, eventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(`${groupIds.length} groups cleared from profile`, 'success');
    } catch (error) {
      console.error('Failed to clear groups:', error);
      showToast(formatErrorMessage('clear groups', error), 'error');
    }
  };

  if (!isOpen || !editingProfile) return null;

  const maxRank = (currentProfile?.hierarchy_rank || 0) - 1;
  const rankOptions = Array.from({ length: Math.max(0, maxRank) + 1 }, (_, i) => i);

  return (
    <AnimatePresence>
      <div key="edit-profile-modal-overlay" className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div
          key="edit-profile-modal-content"
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {isCreating ? 'Create Profile' : 'Edit Profile'}
                </h2>
                {!isCreating && <p className="text-sm text-gray-500">{profile?.label}</p>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {/* Basic Info Section - Compact */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
                  <User className="w-4 h-4" />
                  <span>Basic Information</span>
                </h3>

                <div className="flex gap-3">
                  {/* Label */}
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Profile Name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingProfile.label}
                        onChange={(e) => handleFieldChange('label', e.target.value)}
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          nameConflict ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="Enter profile name"
                      />
                      {nameConflict && (
                        <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs whitespace-nowrap">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Name exists</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Email - only for non-public profiles */}
                  {editingProfile.is_public !== 1 && (
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={editingProfile.email || ''}
                        onChange={(e) => handleFieldChange('email', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter email (optional)"
                      />
                    </div>
                  )}

                  {/* Hierarchy Rank */}
                  <div className="w-32">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Rank
                    </label>
                    <select
                      value={editingProfile.hierarchy_rank}
                      onChange={(e) => handleFieldChange('hierarchy_rank', parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {rankOptions.map(rank => (
                        <option key={`rank-${rank}`} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Password */}
                  <div className="w-40">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Password
                    </label>
                    <button
                      onClick={() => setShowPasswordModal(true)}
                      disabled={isCreating}
                      className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center space-x-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isCreating ? 'Save profile first to set password' : 'Change password'}
                    >
                      <Lock className="w-4 h-4" />
                      <span>Change</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Authorizations Section */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Authorizations</span>
                </h3>

                <div className="space-y-3">
                  {/* Can Upload and Delete Images */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Upload & Delete Images</p>
                      <p className="text-sm text-gray-500">Can upload new photos and delete existing ones</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingProfile.can_upload_and_delete_images === 1}
                        onChange={(e) => handleFieldChange('can_upload_and_delete_images', e.target.checked ? 1 : 0)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Can Edit */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Can Edit</p>
                      <p className="text-sm text-gray-500">Can edit albums, groups, moments, and transfer faces</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingProfile.can_edit === 1}
                        onChange={(e) => handleFieldChange('can_edit', e.target.checked ? 1 : 0)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* All Images */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">All Images Access</p>
                      <p className="text-sm text-gray-500">If ON: Access all images except listed below. If OFF: Only access listed images</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingProfile.all_images === 1}
                        onChange={(e) => handleFieldChange('all_images', e.target.checked ? 1 : 0)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* All Albums */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">All Albums Access</p>
                      <p className="text-sm text-gray-500">If ON: Access all albums except listed below. If OFF: Only access listed albums</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingProfile.all_albums === 1}
                        onChange={(e) => handleFieldChange('all_albums', e.target.checked ? 1 : 0)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* All Groups */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">All Groups Access</p>
                      <p className="text-sm text-gray-500">If ON: Access all groups except listed below. If OFF: Only access listed groups</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingProfile.all_groups === 1}
                        onChange={(e) => handleFieldChange('all_groups', e.target.checked ? 1 : 0)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Save Preferences */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Public Profile</p>
                      <p className="text-sm text-gray-500">Accessible via link, managed by admins only</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <label
                        className={`relative inline-flex items-center ${disablePublicToggle ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                        title={disablePublicToggle ? 'Public access is only available for profiles restricted to this event.' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={editingProfile.is_public === 1}
                          onChange={(e) => handleFieldChange('is_public', e.target.checked ? 1 : 0)}
                          className="sr-only peer"
                          disabled={disablePublicToggle}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                      {disablePublicToggle && (
                        <p className="mt-1 text-xs text-gray-500 text-right">
                          Public access is only available for profiles restricted to this event.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Specific Access - Images (only show for existing profiles) */}
              {!isCreating && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <ImageIcon className="w-5 h-5" />
                    <span>Specific Image Access ({profileImages.length})</span>
                  </h3>
                  {profileImages.length > 0 && (
                    <button
                      onClick={handleClearAllImages}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {editingProfile.all_images === 1 
                    ? '🚫 These images are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY images accessible to this profile'}
                </p>
                {profileImages.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific images configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileImages.map((image) => (
                      <ProfileImageThumb
                        key={image.id}
                        imageId={image.id}
                        eventUrl={eventUrl}
                        urlHelpers={urlHelpers}
                        onRemove={() => handleRemoveImage(image.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Albums (only show for existing profiles) */}
              {!isCreating && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <FolderOpen className="w-5 h-5" />
                    <span>Specific Album Access ({profileAlbums.length})</span>
                  </h3>
                  {profileAlbums.length > 0 && (
                    <button
                      onClick={handleClearAllAlbums}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {editingProfile.all_albums === 1 
                    ? '🚫 These albums are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY albums accessible to this profile'}
                </p>
                {profileAlbums.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific albums configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileAlbums.map((album) => (
                      <ProfileAlbumThumb
                        key={album.id}
                        album={album}
                        eventUrl={eventUrl}
                        urlHelpers={urlHelpers}
                        onRemove={() => handleRemoveAlbum(album.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Groups (only show for existing profiles) */}
              {!isCreating && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Specific Group Access ({profileGroups.length})</span>
                  </h3>
                  {profileGroups.length > 0 && (
                    <button
                      onClick={handleClearAllGroups}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {editingProfile.all_groups === 1 
                    ? '🚫 These groups are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY groups accessible to this profile'}
                </p>
                {profileGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific groups configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileGroups.map((group) => (
                      <ProfileGroupThumb
                        key={group.id}
                        group={group}
                        eventUrl={eventUrl}
                        urlHelpers={urlHelpers}
                        onRemove={() => handleRemoveGroup(group.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

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
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || nameConflict || !editingProfile.label.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{isCreating ? 'Creating...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{isCreating ? 'Create' : 'Save'}</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Change Password Modal (nested) */}
      {showPasswordModal && (
        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          profileId={editingProfile.id}
          profileLabel={editingProfile.label}
          eventUrl={eventUrl}
        />
      )}
    </AnimatePresence>
  );
}

// ProfileImageThumb component for grid display
function ProfileImageThumb({ imageId, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers) return null;
    return urlHelpers.getRelativeThumbnailUrl(imageId);
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={imageId}
      onRemove={onRemove}
      size="medium"
      title="Click to remove"
    />
  );
}

// ProfileAlbumThumb component for grid display
function ProfileAlbumThumb({ album, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}`;
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={album.label}
      onRemove={onRemove}
      text={album.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title="Click to remove"
    />
  );
}

// ProfileGroupThumb component for grid display
function ProfileGroupThumb({ group, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}`;
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={group.label}
      onRemove={onRemove}
      text={group.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title="Click to remove"
    />
  );
}




