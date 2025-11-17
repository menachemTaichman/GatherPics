import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getCurrentProfile } from '../utils/profileService';
import { useEventId } from '../utils/storeUtils';

/**
 * Custom hook to get current user's permissions
 * Returns an object with boolean flags for all permission checks
 * 
 * @param {string} eventUrl - Optional event URL to get event-specific permissions
 * @returns {Object} Permission flags object
 * @property {boolean} canCreateEvents - Can create new events (from general_db)
 * @property {boolean} isProfilesManager - Can manage other profiles (hierarchy_rank != 0)
 * @property {boolean} canUploadAndDeleteImages - Can upload and delete images
 * @property {boolean} canEdit - Can edit entities (labels, moments, albums, etc.)
 * @property {boolean} hasArchiveAlbum - Has access to archive album
 * @property {boolean} hasFavoritesAlbum - Has access to favorites album
 * @property {boolean} has_groups - Has access to groups/people
 * @property {boolean} has_albums - Has access to albums
 * @property {boolean} has_images - Has access to images/timeline
 * @property {boolean} enable_new_requests - Can manage access requests
 * @property {boolean} has_settings - Can access app settings
 */
export function usePermissions(eventUrl = null) {
  const params = useParams();
  const effectiveEventUrl = eventUrl || params.eventUrl;
  const eventId = useEventId(effectiveEventUrl);
  const profile = getCurrentProfile();

  const permissions = useMemo(() => {
    if (!profile) {
      // No profile loaded - return all false
      return {
        canCreateEvents: false,
        isProfilesManager: false,
        canUploadAndDeleteImages: false,
        canEdit: false,
        canManageEvent: false,
        hasArchiveAlbum: false,
        hasFavoritesAlbum: false,
        has_groups: false,
        has_albums: false,
        has_images: false,
        enable_new_requests: false,
        has_settings: false,
      };
    }

    // Get event-specific permissions from profile.events[eventId]
    const eventPermissions = (eventId && profile.events && profile.events[eventId]) || {};

    return {
      // From general_db profiles table (at root level)
      canCreateEvents: Boolean(profile.can_create_events),
      
      // From event_db - derived from hierarchy_rank in profiles_details view
      isProfilesManager: Boolean(profile.is_profiles_manager),
      
      // From event_db profiles table
      canUploadAndDeleteImages: Boolean(eventPermissions.can_upload_and_delete_images),
      canEdit: Boolean(eventPermissions.can_edit),
      canManageEvent: Boolean(eventPermissions.can_manage_event),
      
      // From event_db - calculated in profiles_details view
      hasArchiveAlbum: Boolean(eventPermissions.has_archive_album),
      hasFavoritesAlbum: Boolean(eventPermissions.has_favorites_album),
      
      // Entity access flags
      has_groups: Boolean(eventPermissions.has_groups),
      has_albums: Boolean(eventPermissions.has_albums),
      has_images: Boolean(eventPermissions.has_images),
      
      // Enable requests flag
      enable_new_requests: Boolean(eventPermissions.enable_new_requests),
      
      // From general_db - calculated in current_profile view
      has_settings: Boolean(profile.has_settings),
    };
  }, [profile, eventId]);

  return permissions;
}

export default usePermissions;




