import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Settings, RotateCcw, Trash2, Eye } from 'lucide-react';
import { getAllSettings, resetAllSettings, clearAllSettings } from '../utils/settings';

export default function SettingsManager() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(getAllSettings());
  const settingsRef = useRef(null);

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
    resetAllSettings();
    setSettings(getAllSettings());
  };

  const handleClearSettings = () => {
    clearAllSettings();
    setSettings(getAllSettings());
  };

  const refreshSettings = () => {
    setSettings(getAllSettings());
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

          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500">
            Settings are automatically saved to localStorage
          </div>
        </motion.div>
      )}
    </div>
  );
} 