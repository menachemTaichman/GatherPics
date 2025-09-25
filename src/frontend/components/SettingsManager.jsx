import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Settings, RotateCcw, Trash2 } from 'lucide-react';
import { getPreference, setPreference, resetAllPreferences, getPreferences, clearAllSettings } from '../utils/settings';
import { authAPI } from '../utils/apiService';
import { useDataStore } from '../utils/dataManager';

export default function SettingsManager() {
  const [showSettings, setShowSettings] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(getPreference('general.includeArchived', false));
  const [settings, setSettings] = useState(getPreferences());
  const settingsRef = useRef(null);
  const openStoreSnapshot = () => {
    const store = useDataStore.getState();
    const replacer = (_key, value) => {
      if (value instanceof Set) return Array.from(value);
      return value;
    };
    const snapshot = JSON.stringify(store || {}, replacer, 2);
    const blob = new Blob([snapshot], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Close settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
      }
    };

    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettings]);

  const handleResetSettings = () => {
    resetAllPreferences();
    setSettings(getPreferences());
  };

  const handleClearSettings = () => {
    clearAllSettings();
    setSettings(getPreferences());
  };

  const refreshSettings = () => {
    setSettings(getPreferences());
  };

  return (
    <div className="relative" ref={settingsRef}>
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center text-gray-700"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {showSettings && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Cached Settings</h3>
            <div className="flex space-x-2">
              <button
                onClick={refreshSettings}
                className="p-1 text-gray-500 hover:text-gray-700"
                title="Refresh"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={openStoreSnapshot}
                className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                title="Open current store JSON in a new tab"
              >
                Open store
              </button>
              <button
                onClick={handleResetSettings}
                className="p-1 text-gray-500 hover:text-gray-700"
                title="Reset to defaults"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleClearSettings}
                className="p-1 text-red-500 hover:text-red-700"
                title="Clear all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {Object.entries(settings).map(([key, value]) => (
              <div key={key} className="flex justify-between items-center text-sm">
                <span className="text-gray-600 font-mono">{key}:</span>
                <span className="text-gray-900 font-mono">
                  {typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)}
                </span>
              </div>
            ))}
          </div>

          {/* Quick toggles */}
          <div className="mt-4 pt-3 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Preferences</h4>
            <label className="flex items-center space-x-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={async (e) => {
                  const newValue = e.target.checked;
                  setPreference('general.includeArchived', newValue);
                  setIncludeArchived(newValue);
                  
                  // Update JWT token with new include_archived setting
                  try {
                    await authAPI.updateIncludeArchived(newValue);
                  } catch (error) {
                    console.error('Failed to update include_archived setting:', error);
                  }
                }}
              />
              <span>Include archived images</span>
            </label>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500">
            Settings are automatically saved to localStorage
          </div>
        </motion.div>
      )}
    </div>
  );
} 