/**
 * Settings cache utility for user preferences
 */

import { profilesAPI } from './apiService';

const PREFERENCES = 'preferences';

// Default values for all settings
const DEFAULT_PREFERENCES = {
  general: {
    select: false,
    size: 1.0,
    includeArchived: false
  },
  ImageViewer: {
    albumsHeight: 200,
    albumsOpen: false,
    facesOpen: false,
    sidebarOpen: false
  },
  GroupDetail: {
    sortDir: 'asc'
  },
  Moments: {
    sortDir: 'asc',
    carouselExpanded: true
  },
  EditMomentImagesModal: {
    filter: 'all',
    sortDir: 'asc'
  },
  GroupsGallery: {
    sortDir: 'desc',
    sortBy: 'name'
  },
  AlbumsGallery: {
    sortBy: 'name',
    sortDir: 'asc'
  },
  AlbumsDetail: {
    sortDir: 'asc'
  },
  BucketDrawer: {
    mode: 'download',
    quality: 'high',
    excludeAlready: true,
    alreadyDownloaded: [],
    alreadyUploaded: [],
    queue: []
  }
};

/**
 * Get preferences from cache or return defaults
 * @returns {object} Preferences object
 */
export const getPreferences = () => {
  try {
    const cached = localStorage.getItem(PREFERENCES);
    if (cached !== null && cached !== 'undefined') {
      const parsed = JSON.parse(cached);
      // Merge with defaults to ensure all keys exist
      return mergePreferences(DEFAULT_PREFERENCES, parsed);
    }
  } catch (error) {
    console.warn('Failed to get preferences:', error);
  }
  
  return DEFAULT_PREFERENCES;
};

/**
 * Get a specific preference value using dot notation (e.g., 'general.size')
 * @param {string} path - Dot notation path to the preference
 * @returns {any} Preference value
 */
export const getPreference = (path) => {
  const preferences = getPreferences();
  return getNestedValue(preferences, path);
};

/**
 * Save preferences to cache
 * @param {object} preferences - Preferences object
 */
export const setPreferences = (preferences) => {
  try {
    localStorage.setItem(PREFERENCES, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Failed to save preferences:', error);
  }
};

/**
 * Set a specific preference value using dot notation (e.g., 'general.size')
 * @param {string} path - Dot notation path to the preference
 * @param {any} value - Value to set
 */
export const setPreference = async (path, value) => {
  const preferences = getPreferences();
  setNestedValue(preferences, path, value);
  setPreferences(preferences);
  
  // Dispatch a custom event to notify same-tab listeners
  window.dispatchEvent(new CustomEvent('preferenceChanged', {
    detail: { path, value, preferences }
  }));
  
  // Sync to backend if user has save_preferences permission
  try {
    const pathParts = path.split('.');
    if (pathParts.length >= 2) {
      const preferenceGroup = pathParts[0];
      const preferenceKey = pathParts.slice(1).join('.');
      
      await profilesAPI.updatePreference(preferenceGroup, preferenceKey, value);
    }
  } catch (error) {
    // Silently fail - profile might not have save_preferences permission or not logged in
    // The preference is still saved locally, which is fine
    if (error.response?.status !== 403) {
      console.warn('Failed to sync preference to backend:', error);
    }
  }
};

/**
 * Initialize preferences at startup - ensures preferences exist in localStorage
 * Optionally loads from API if user has save_preferences permission
 * @param {boolean} loadFromAPI - Whether to attempt loading from API
 */
export const initializePreferences = async (loadFromAPI = false) => {
  try {
    if (loadFromAPI) {
      // Try to load preferences from API
      try {
        const result = await profilesAPI.getPreferences();
        if (result.preferences) {
          // Merge API preferences with defaults to ensure all keys exist
          const merged = mergePreferences(DEFAULT_PREFERENCES, result.preferences);
          setPreferences(merged);
          return;
        }
      } catch (error) {
        // If API fails (no permission, not logged in, etc.), fall back to local
        if (error.response?.status !== 403) {
          console.warn('Failed to load preferences from API:', error);
        }
      }
    }
    
    // Fallback: use existing localStorage or defaults
    const existingPreferences = localStorage.getItem(PREFERENCES);
    if (!existingPreferences) {
      // No preferences exist, create them with defaults
      setPreferences(DEFAULT_PREFERENCES);
    }
  } catch (error) {
    console.warn('Failed to initialize preferences:', error);
  }
};

/**
 * Reset all preferences to defaults
 */
export const resetAllPreferences = () => {
  try {
    localStorage.removeItem(PREFERENCES);
  } catch (error) {
    console.warn('Failed to reset preferences:', error);
  }
};


// Helper functions for nested object manipulation
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
}

function mergePreferences(defaults, userPrefs) {
  const result = { ...defaults };
  
  for (const key in userPrefs) {
    if (userPrefs.hasOwnProperty(key)) {
      if (typeof userPrefs[key] === 'object' && userPrefs[key] !== null && !Array.isArray(userPrefs[key])) {
        result[key] = mergePreferences(defaults[key] || {}, userPrefs[key]);
      } else {
        result[key] = userPrefs[key];
      }
    }
  }
  
  return result;
}

/**
 * Clear all cached settings
 */
export const clearAllSettings = () => {
  try {
    localStorage.removeItem(PREFERENCES);
  } catch (error) {
    console.warn('Failed to clear preferences:', error);
  }
};

/**
 * Get the appropriate image count based on includeArchived setting
 * @param {object} entity - Entity object (group, moment, album, etc.)
 * @returns {number} The appropriate image count
 */
export const getImageCount = (entity) => {
  if (!entity) return 0;
  
  const includeArchived = getPreference('general.includeArchived');
  if (includeArchived) {
    return entity.images_count || 0;
  } else {
    return entity.active_images_count ?? entity.images_count ?? 0;
  }
}; 