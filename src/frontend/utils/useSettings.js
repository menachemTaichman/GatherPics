import { useState, useEffect } from 'react';
import { getPreference, setPreference } from './settings';

/**
 * Custom hook for managing preferences using dot notation
 * @param {string} path - Dot notation path to the preference (e.g., 'general.size')
 * @param {any} defaultValue - Default value if not cached
 * @returns {any} The preference value
 */
export const usePreference = (path, defaultValue) => {
  const [value, setValueState] = useState(() => {
    const cached = getPreference(path);
    return cached !== undefined ? cached : defaultValue;
  });

  // Update state if preferences change externally (from other tabs/windows) or internally (same tab)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'preferences') {
        const newValue = e.newValue ? JSON.parse(e.newValue) : undefined;
        if (newValue) {
          // Extract the specific preference value from the new preferences object
          const pathParts = path.split('.');
          let extractedValue = newValue;
          for (const part of pathParts) {
            if (extractedValue && typeof extractedValue === 'object') {
              extractedValue = extractedValue[part];
            } else {
              extractedValue = undefined;
              break;
            }
          }
          
          if (extractedValue !== value) {
            setValueState(extractedValue);
          }
        }
      }
    };

    const handlePreferenceChange = (e) => {
      const { path: changedPath, preferences } = e.detail;
      // Check if the changed path matches our path or is a parent path
      if (changedPath === path || path.startsWith(changedPath + '.')) {
        // Extract the specific preference value from the new preferences object
        const pathParts = path.split('.');
        let extractedValue = preferences;
        for (const part of pathParts) {
          if (extractedValue && typeof extractedValue === 'object') {
            extractedValue = extractedValue[part];
          } else {
            extractedValue = undefined;
            break;
          }
        }
        
        if (extractedValue !== value) {
          setValueState(extractedValue);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('preferenceChanged', handlePreferenceChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('preferenceChanged', handlePreferenceChange);
    };
  }, [path, value]);

  return value;
}; 