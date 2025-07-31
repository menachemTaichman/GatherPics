import { useState, useEffect } from 'react';
import { getSetting, setSetting } from './settings';

/**
 * Custom hook for managing cached settings
 * @param {string} key - Setting key
 * @param {any} defaultValue - Default value if not cached
 * @returns {[any, function]} [value, setValue] tuple
 */
export const useSetting = (key, defaultValue) => {
  const [value, setValueState] = useState(() => {
    const cached = getSetting(key);
    return cached !== undefined ? cached : defaultValue;
  });

  const setValue = (newValue) => {
    setValueState(newValue);
    setSetting(key, newValue);
  };

  // Update state if setting changes externally (from other tabs/windows)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === `face_gallery_settings_${key}`) {
        const newValue = e.newValue ? JSON.parse(e.newValue) : undefined;
        if (newValue !== value) {
          setValueState(newValue);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, value]);

  return [value, setValue];
}; 