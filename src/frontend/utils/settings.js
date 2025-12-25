/**
 * Settings cache utility for user preferences
 */

import { profilesAPI } from './apiService';
import { STORAGE_KEYS } from './dataManager';

const PREFERENCES = STORAGE_KEYS.PREFERENCES;

// Flag to prevent API calls when preferences are being updated from API responses
let isApplyingApiChanges = false;

/**
 * Set the flag to prevent API calls when applying changes from API responses
 * @param {boolean} value - Whether we're currently applying API changes
 */
export const setIsApplyingApiChanges = (value) => {
  isApplyingApiChanges = value;
};

// Debounce map for API calls - tracks pending timeouts per preference path
const pendingApiCalls = new Map();

// Debounce delay in milliseconds (300ms should be enough to batch rapid updates)
const DEBOUNCE_DELAY = 300;

// Default values for all settings
const DEFAULT_PREFERENCES = {
  general: {
    select: false,
    size: 1.0,
    includeArchived: false,
    language: 'en'
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
  const currentValue = getNestedValue(preferences, path);
  
  // Normalize falsy values for comparison (treat undefined, null, and empty string as equivalent for preferences)
  const normalizeForComparison = (val) => {
    // Treat undefined, null, and empty string as equivalent
    if (val === undefined || val === null || val === '') {
      return '';
    }
    return val;
  };
  
  const normalizedCurrent = normalizeForComparison(currentValue);
  const normalizedNew = normalizeForComparison(value);
  
  // Only update if value actually changed
  if (normalizedCurrent === normalizedNew) {
    return; // No change, skip update
  }
  
  // Also check JSON stringify for deep equality of objects/arrays
  try {
    if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNew)) {
      return; // No change, skip update
    }
  } catch (e) {
    // If stringify fails (circular refs, etc.), fall through to update
  }
  
  setNestedValue(preferences, path, value);
  setPreferences(preferences);
  
  // Dispatch a custom event to notify same-tab listeners
  window.dispatchEvent(new CustomEvent('preferenceChanged', {
    detail: { path, value, preferences }
  }));
  
  // Sync to backend if user is not public
  // Skip API call if we're currently applying changes from API (prevents infinite loops)
  if (!isApplyingApiChanges) {
    const pathParts = path.split('.');
    if (pathParts.length >= 2) {
      const preferenceGroup = pathParts[0];
      const preferenceKey = pathParts.slice(1).join('.');
      
      // Clear any pending API call for this preference path
      if (pendingApiCalls.has(path)) {
        clearTimeout(pendingApiCalls.get(path));
      }
      
      // Schedule a debounced API call
      const timeoutId = setTimeout(async () => {
        try {
          await profilesAPI.updatePreference(preferenceGroup, preferenceKey, value);
        } catch (error) {
          // Silently fail - profile is public or not logged in
          // The preference is still saved locally, which is fine
          if (error.response?.status !== 403) {
            console.warn('Failed to sync preference to backend:', error);
          }
        } finally {
          // Clean up the pending call entry
          pendingApiCalls.delete(path);
        }
      }, DEBOUNCE_DELAY);
      
      pendingApiCalls.set(path, timeoutId);
    }
  }
};

/**
 * Initialize preferences at startup - ensures preferences exist in localStorage
 * Optionally loads from API if user is not public
 * @param {boolean} loadFromAPI - Whether to attempt loading from API
 */
export const initializePreferences = async (loadFromAPI = false) => {
  try {
    if (loadFromAPI) {
      // Try to load preferences from API
      try {
        await profilesAPI.getPreferences();
        // preferences updated via changes in response interceptor
        return;
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


