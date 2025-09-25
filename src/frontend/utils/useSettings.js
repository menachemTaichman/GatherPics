import { useState, useEffect } from 'react';
import { getPreference, setPreference } from './settings';

/**
 * Custom hook for managing preferences using dot notation
 * @param {string} path - Dot notation path to the preference (e.g., 'general.size')
 * @param {any} defaultValue - Default value if not cached
 * @returns {[any, function]} [value, setValue] tuple
 */
export const usePreference = (path, defaultValue) => {
  const [value, setValueState] = useState(() => {
    const cached = getPreference(path);
    return cached !== undefined ? cached : defaultValue;
  });

  const setValue = (newValue) => {
    setValueState(newValue);
    setPreference(path, newValue);
  };

  // Update state if preferences change externally (from other tabs/windows)
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

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [path, value]);

  return [value, setValue];
}; 