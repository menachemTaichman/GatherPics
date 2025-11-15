import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, Check, Minus, Info, Loader2 } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { useEventProfilesList, useProfilesList } from '../../utils/dataManager';
import { profilesAPI } from '../../utils/apiService';
import { getCurrentProfileId } from '../../utils/profileService';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';

/**
 * Profile Access Row Component
 * Handles displaying and managing access for a single profile
 */
function ProfileAccessRow({ profile, entityType, entityIds, eventUrl, showToast }) {
  const [loading, setLoading] = useState({});
  const [status, setStatus] = useState('unknown');

  // Stabilize entityIds to prevent unnecessary re-renders
  const entityIdsKey = useMemo(() => entityIds.join(','), [entityIds]);

  // Check access status from backend using the new API
  useEffect(() => {
    const checkAccess = async () => {
      if (!profile || !entityIds || entityIds.length === 0) {
        setStatus('unknown');
        return;
      }

      try {
        let result;
        if (entityType === 'image') {
          result = await profilesAPI.checkImageAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'album') {
          result = await profilesAPI.checkAlbumAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'group') {
          result = await profilesAPI.checkGroupAccess(profile.id, entityIds, eventUrl);
        }

        if (result) {
          const { len_accessible, len_inaccessible } = result;
          
          if (len_accessible === entityIds.length) {
            setStatus('allowed');
          } else if (len_inaccessible === entityIds.length) {
            setStatus('denied');
          } else {
            setStatus('mixed');
          }
        }
      } catch (err) {
        console.error('Failed to check access:', err);
        setStatus('unknown');
      }
    };

    checkAccess();
  }, [profile?.id, entityType, entityIdsKey, eventUrl]);

  const handleAllow = async () => {
    const key = `${profile.id}-allow`;
    setLoading(prev => ({ ...prev, [key]: true }));

    try {
      // Backend handles whitelist/blacklist logic internally
      // PUT = grant access
      if (entityType === 'image') {
        await profilesAPI.setImagesAccessible(profile.id, entityIds, eventUrl);
      } else if (entityType === 'album') {
        await profilesAPI.setAlbumsAccessible(profile.id, entityIds, eventUrl);
      } else if (entityType === 'group') {
        await profilesAPI.setGroupsAccessible(profile.id, entityIds, eventUrl);
      }

      showToast(`Access granted for ${profile.label}`, 'success');
      
      // Refresh status after successful operation
      try {
        let result;
        if (entityType === 'image') {
          result = await profilesAPI.checkImageAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'album') {
          result = await profilesAPI.checkAlbumAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'group') {
          result = await profilesAPI.checkGroupAccess(profile.id, entityIds, eventUrl);
        }
        
        if (result) {
          const { len_accessible, len_inaccessible } = result;
          if (len_accessible === entityIds.length) {
            setStatus('allowed');
          } else if (len_inaccessible === entityIds.length) {
            setStatus('denied');
          } else {
            setStatus('mixed');
          }
        }
      } catch (refreshErr) {
        console.error('Failed to refresh status:', refreshErr);
      }
    } catch (err) {
      console.error('Failed to grant access:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to grant access';
      showToast(errorMsg, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleDeny = async () => {
    const key = `${profile.id}-deny`;
    setLoading(prev => ({ ...prev, [key]: true }));

    try {
      // Backend handles whitelist/blacklist logic internally
      // DELETE = deny access
      if (entityType === 'image') {
        await profilesAPI.setImagesInaccessible(profile.id, entityIds, eventUrl);
      } else if (entityType === 'album') {
        await profilesAPI.setAlbumsInaccessible(profile.id, entityIds, eventUrl);
      } else if (entityType === 'group') {
        await profilesAPI.setGroupsInaccessible(profile.id, entityIds, eventUrl);
      }

      showToast(`Access denied for ${profile.label}`, 'success');
      
      // Refresh status after successful operation
      try {
        let result;
        if (entityType === 'image') {
          result = await profilesAPI.checkImageAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'album') {
          result = await profilesAPI.checkAlbumAccess(profile.id, entityIds, eventUrl);
        } else if (entityType === 'group') {
          result = await profilesAPI.checkGroupAccess(profile.id, entityIds, eventUrl);
        }
        
        if (result) {
          const { len_accessible, len_inaccessible } = result;
          if (len_accessible === entityIds.length) {
            setStatus('allowed');
          } else if (len_inaccessible === entityIds.length) {
            setStatus('denied');
          } else {
            setStatus('mixed');
          }
        }
      } catch (refreshErr) {
        console.error('Failed to refresh status:', refreshErr);
      }
    } catch (err) {
      console.error('Failed to deny access:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to deny access';
      showToast(errorMsg, 'error');
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const allowKey = `${profile.id}-allow`;
  const denyKey = `${profile.id}-deny`;
  const isLoadingAllow = loading[allowKey];
  const isLoadingDeny = loading[denyKey];
  const isLoadingAny = isLoadingAllow || isLoadingDeny;

  return (
    <div
      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
    >
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          status === 'allowed' ? 'bg-green-100' :
          status === 'denied' ? 'bg-red-100' :
          'bg-yellow-100'
        }`}>
          {status === 'allowed' ? (
            <Check className="w-5 h-5 text-green-600" />
          ) : status === 'denied' ? (
            <Minus className="w-5 h-5 text-red-600" />
          ) : (
            <Key className="w-5 h-5 text-yellow-600" />
          )}
        </div>
        <div>
          <p className="font-medium text-gray-900">{profile.label}</p>
          <p className="text-xs text-gray-500">
            Rank {profile.hierarchy_rank} • 
            {status === 'allowed' ? ' Has access' :
             status === 'denied' ? ' No access' :
             ' Mixed access'}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={handleAllow}
          disabled={isLoadingAny || status === 'allowed'}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2 ${
            status === 'allowed'
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-green-600 text-white hover:bg-green-700'
          } disabled:opacity-50`}
        >
          {isLoadingAllow ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>Allow</span>
        </button>
        <button
          onClick={handleDeny}
          disabled={isLoadingAny || status === 'denied'}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2 ${
            status === 'denied'
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-red-600 text-white hover:bg-red-700'
          } disabled:opacity-50`}
        >
          {isLoadingDeny ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Minus className="w-4 h-4" />
          )}
          <span>Deny</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Modal for managing entity access for profiles
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Function to call when modal closes
 * @param {string} entityType - Type of entity: 'image', 'album', or 'group'
 * @param {string[]} entityIds - Array of entity IDs to manage access for
 * @param {string} eventUrl - Current event URL
 */
export default function ManageAccessModal({ isOpen, onClose, entityType, entityIds = [], eventUrl }) {
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const MODAL_ID = 'manage-access-modal';
  const { registerModal, unregisterModal } = useModalStore();

  // Get all event profiles and filter out the current one
  const allProfiles = useEventProfilesList(eventId);
  const generalProfiles = useProfilesList();
  const generalProfilesById = useMemo(() => {
    const map = {};
    generalProfiles.forEach((profile) => {
      if (profile?.id) {
        map[profile.id] = profile;
      }
    });
    return map;
  }, [generalProfiles]);
  const currentProfileId = getCurrentProfileId();
  const mergedProfiles = useMemo(() => {
    return allProfiles.map((profile) => {
      const baseId = profile?.profile_id || profile?.id;
      const generalProfile = baseId ? generalProfilesById[baseId] : null;
      if (!generalProfile) return profile;
      if (generalProfile.label === profile.label) return profile;
      return {
        ...profile,
        label: generalProfile.label,
      };
    });
  }, [allProfiles, generalProfilesById]);
  const otherProfiles = mergedProfiles.filter((profile) => {
    const baseId = profile?.profile_id || profile?.id;
    return profile?.id !== currentProfileId && baseId !== currentProfileId;
  });

  const [error, setError] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: MODAL_ID,
    modalType: 'popup'
  });

  // Apply scopes to allow event_profiles to be inserted into the store
  const scopes = useMemo(() => {
    if (!isOpen) return [];
    const activeScopes = [];
    if (eventId) {
      activeScopes.push({ entity: 'all', id: 'event_profiles', eventId });
    }
    activeScopes.push({ entity: 'all', id: 'profiles', eventId: 'general' });
    return activeScopes;
  }, [isOpen, eventId]);

  useApplyScopes(scopes);

  // Register modal (scopes managed by useApplyScopes above)
  useEffect(() => {
    if (isOpen) {
      registerModal(MODAL_ID, { 
        priority: 60
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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError('');
    }
  }, [isOpen]);

  // Fetch profiles when modal opens
  useEffect(() => {
    if (isOpen && eventUrl) {
      const loadProfiles = async () => {
        setProfilesLoading(true);
        setProfilesLoaded(false);
        
        try {
          // Fetch profiles from backend
          // Changes are automatically applied by apiService interceptor
          await profilesAPI.getAll(eventUrl);
          setProfilesLoaded(true);
        } catch (err) {
          console.error('Failed to load profiles:', err);
          setError('Failed to load profiles. Please try again.');
        } finally {
          setProfilesLoading(false);
        }
      };
      
      loadProfiles();
    }
  }, [isOpen, eventUrl]);

  if (!isOpen) return null;

  const entityLabel = entityType === 'image' ? 'photo' : entityType === 'album' ? 'album' : 'person';
  const entityCount = entityIds.length;

  return (
    <AnimatePresence>
      <div 
        key="manage-access-modal-overlay"
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="manage-access-modal-content"
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Key className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Manage Access
                </h2>
                <p className="text-sm text-gray-500">
                  {entityCount} {entityLabel}{entityCount !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {profilesLoading ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-3" />
                <p className="text-gray-500">Loading profiles...</p>
              </div>
            ) : profilesLoaded && otherProfiles.length === 0 ? (
              <div className="text-center py-12">
                <Key className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">No other profiles available</p>
              </div>
            ) : profilesLoaded ? (
              <div className="space-y-3">
                {otherProfiles.map(profile => (
                  <ProfileAccessRow
                    key={profile.id}
                    profile={profile}
                    entityType={entityType}
                    entityIds={entityIds}
                    eventUrl={eventUrl}
                    showToast={showToast}
                  />
                ))}
              </div>
            ) : null}

            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2 text-red-700">
                <X className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 p-4">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}



