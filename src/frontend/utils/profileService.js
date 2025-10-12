// Profile service for managing current profile in localStorage

const CURRENT_PROFILE_KEY = 'currentProfile';

/**
 * Get the current profile from localStorage
 * @returns {Object|null} Profile object or null if not found
 */
export function getCurrentProfile() {
  try {
    const stored = localStorage.getItem(CURRENT_PROFILE_KEY);
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
    localStorage.setItem(CURRENT_PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn('Failed to save current profile to localStorage:', error);
  }
}

/**
 * Clear the current profile from localStorage
 */
export function clearCurrentProfile() {
  try {
    localStorage.removeItem(CURRENT_PROFILE_KEY);
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

