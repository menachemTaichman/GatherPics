/**
 * Application Configuration
 * Centralized place for app-wide settings
 */

export const APP_CONFIG = {
  // Website name - change this to update across the entire application
  name: 'Gather Pics',
  
  // Alternative taglines/descriptions
  tagline: 'Share Memories Together',
  description: 'Effortlessly organize, share, and discover photos from your events',
};

// Generate storage key prefix from app name
export const getStoragePrefix = () => {
  // Convert app name to lowercase, replace spaces with underscores
  return APP_CONFIG.name.toLowerCase().replace(/\s+/g, '_');
};

