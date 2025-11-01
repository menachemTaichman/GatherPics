// Profile service for managing current profile in localStorage
import { STORAGE_KEYS } from './dataManager';

/**
 * Get the current profile from localStorage
 * @returns {Object|null} Profile object or null if not found
 */
export function getCurrentProfile() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to get current profile from localStorage:', error);
    return null;
  }
}

/**
 * Save the current profile to localStorage
 * @param {Object} profile - Profile object to save
 */
export function setCurrentProfile(profile) {
  try {
    if (!profile) {
      clearCurrentProfile();
      return;
    }
    localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, JSON.stringify(profile));
  } catch (error) {
    console.warn('Failed to save current profile to localStorage:', error);
  }
}

/**
 * Clear the current profile from localStorage
 */
export function clearCurrentProfile() {
  try {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_PROFILE);
  } catch (error) {
    console.warn('Failed to clear current profile from localStorage:', error);
  }
}

/**
 * Get current profile ID
 * @returns {string|null} Profile ID or null if not found
 */
export function getCurrentProfileId() {
  const profile = getCurrentProfile();
  return profile?.id || profile?.profile_id || null;
}

/**
 * Check if current profile has archived access
 * @returns {boolean}
 */
export function hasArchivedAccess() {
  // This will be computed from accessible albums in useProfilePermissions
  // Kept here for potential standalone use
  const profile = getCurrentProfile();
  return profile?.archived_access === true || profile?.archived_access === 1;
}

/**
 * Check if current profile has favorites access
 * @returns {boolean}
 */
export function hasFavoritesAccess() {
  // This will be computed from accessible albums in useProfilePermissions
  // Kept here for potential standalone use
  const profile = getCurrentProfile();
  return profile?.favorites_access === true || profile?.favorites_access === 1;
}

export default {
  getCurrentProfile,
  setCurrentProfile,
  clearCurrentProfile,
  getCurrentProfileId,
  hasArchivedAccess,
  hasFavoritesAccess
};




