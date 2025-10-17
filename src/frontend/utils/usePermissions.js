import { useMemo } from 'react';
import { getCurrentProfile } from './profileService';

/**
 * Custom hook to get current user's permissions
 * Returns an object with boolean flags for all permission checks
 * 
 * @returns {Object} Permission flags object
 * @property {boolean} canCreateEvents - Can create new events (from general_db)
 * @property {boolean} isProfilesManager - Can manage other profiles (hierarchy_rank != 0)
 * @property {boolean} canUploadAndDeleteImages - Can upload and delete images
 * @property {boolean} canEdit - Can edit entities (labels, moments, albums, etc.)
 * @property {boolean} hasArchiveAlbum - Has access to archive album
 * @property {boolean} hasFavoritesAlbum - Has access to favorites album
 */
export function usePermissions() {
  const profile = getCurrentProfile();

  const permissions = useMemo(() => {
    if (!profile) {
      // No profile loaded - return all false
      return {
        canCreateEvents: false,
        isProfilesManager: false,
        canUploadAndDeleteImages: false,
        canEdit: false,
        hasArchiveAlbum: false,
        hasFavoritesAlbum: false,
      };
    }

    return {
      // From general_db profiles table
      canCreateEvents: Boolean(profile.can_create_events),
      
      // From event_db - derived from hierarchy_rank in profiles_details view
      isProfilesManager: Boolean(profile.is_profiles_manager),
      
      // From event_db profiles table
      canUploadAndDeleteImages: Boolean(profile.can_upload_and_delete_images),
      canEdit: Boolean(profile.can_edit),
      
      // From event_db - calculated in profiles_details view
      hasArchiveAlbum: Boolean(profile.has_archive_album),
      hasFavoritesAlbum: Boolean(profile.has_favorites_album),
    };
  }, [profile]);

  return permissions;
}

export default usePermissions;

