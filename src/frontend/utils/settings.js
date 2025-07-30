/**
 * Settings cache utility for user preferences
 */

const SETTINGS_PREFIX = 'face_gallery_settings_';

// Default values for all settings
const DEFAULT_SETTINGS = {
  // Gallery settings
  gallery_sortBy: 'name',
  gallery_sortOrder: 'desc',
  gallery_cardSize: 1.0,
  
  // FaceDetail settings
  faceDetail_viewMode: 'grid',
  faceDetail_photoSize: 1.0,
  faceDetail_sortBy: 'date',
  faceDetail_sortOrder: 'asc',
  
  // Moments settings
  moments_viewMode: 'grid',
  moments_photoSize: 1.0,
  moments_carouselVisible: true,
  
  // EditMomentPhotosModal settings
  editMomentPhotos_sortOrder: 'asc',
  editMomentPhotos_filterType: 'all',
  
  // TransferFacesModal settings
  transferModal_sortBy: 'name',
  transferModal_sortOrder: 'asc'
};

/**
 * Get a setting value from cache or return default
 * @param {string} key - Setting key
 * @returns {any} Setting value
 */
export const getSetting = (key) => {
  try {
    const cached = localStorage.getItem(SETTINGS_PREFIX + key);
    if (cached !== null && cached !== 'undefined') {
      // Parse the cached value, handling different data types
      const parsed = JSON.parse(cached);
      return parsed;
    }
  } catch (error) {
    console.warn(`Failed to get setting ${key}:`, error);
  }
  
  // Return default value
  return DEFAULT_SETTINGS[key];
};

/**
 * Save a setting value to cache
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export const setSetting = (key, value) => {
  try {
    localStorage.setItem(SETTINGS_PREFIX + key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save setting ${key}:`, error);
  }
};

/**
 * Get all settings with current values
 * @returns {Object} All settings
 */
export const getAllSettings = () => {
  const settings = {};
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    settings[key] = getSetting(key);
  });
  return settings;
};

/**
 * Reset all settings to defaults
 */
export const resetAllSettings = () => {
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    try {
      localStorage.removeItem(SETTINGS_PREFIX + key);
    } catch (error) {
      console.warn(`Failed to reset setting ${key}:`, error);
    }
  });
};

/**
 * Clear all cached settings
 */
export const clearAllSettings = () => {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(SETTINGS_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn('Failed to clear settings:', error);
  }
}; 