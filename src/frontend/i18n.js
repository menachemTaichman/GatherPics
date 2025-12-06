import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enTranslations from './locales/en.json';
import heTranslations from './locales/he.json';
import { getPreference, setPreference } from './utils/settings';

// Get initial language from preferences or fallback to localStorage/navigator
const getInitialLanguage = () => {
  // First check preferences
  const prefLanguage = getPreference('general.language');
  if (prefLanguage && (prefLanguage === 'en' || prefLanguage === 'he')) {
    return prefLanguage;
  }
  
  // Fallback to localStorage (for backward compatibility)
  try {
    const stored = localStorage.getItem('gather_pics_language');
    if (stored && (stored === 'en' || stored === 'he')) {
      return stored;
    }
  } catch (e) {
    // Ignore errors
  }
  
  // Fallback to navigator language
  const navLang = navigator.language || navigator.userLanguage;
  if (navLang && navLang.startsWith('he')) {
    return 'he';
  }
  
  return 'en';
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations
      },
      he: {
        translation: heTranslations
      }
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false // React already escapes values
    },
    detection: {
      // Order of detection methods
      order: ['localStorage', 'navigator'],
      // Keys to lookup language from
      lookupLocalStorage: 'gather_pics_language',
      // Cache user language
      caches: ['localStorage']
    }
  });

// Set document direction based on language
const updateDocumentDirection = (lng) => {
  const isRTL = lng === 'he';
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
};

// Set initial direction
updateDocumentDirection(i18n.language || 'en');

// Cross-tab language synchronization via BroadcastChannel
let languageChannel = null;
let isReceivingBroadcast = false;
let isUpdatingFromPreference = false;

try {
  languageChannel = new BroadcastChannel('language-sync');
  
  // Listen for language changes from other tabs
  languageChannel.onmessage = (event) => {
    if (event.data?.type === 'languageChanged' && event.data?.language) {
      const newLanguage = event.data.language;
      // Only update if different from current language
      if (i18n.language !== newLanguage) {
        isReceivingBroadcast = true;
        i18n.changeLanguage(newLanguage).finally(() => {
          isReceivingBroadcast = false;
        });
      }
    }
  };
} catch (e) {
  // BroadcastChannel not supported, continue without cross-tab sync
}

// Update direction when language changes
i18n.on('languageChanged', (lng) => {
  updateDocumentDirection(lng);
  
  // Only sync to preferences if the change wasn't initiated by a preference change
  // This prevents infinite loops where preference change -> i18n change -> preference change
  if (!isUpdatingFromPreference) {
    // Sync to preferences (async, don't await)
    setPreference('general.language', lng).catch(err => {
      // Silently fail - preference sync is best effort
      console.warn('Failed to sync language to preferences:', err);
    });
  }
  
  // Also update localStorage for backward compatibility
  try {
    localStorage.setItem('gather_pics_language', lng);
  } catch (e) {
    // Ignore errors
  }
  
  // Broadcast language change to other tabs (only if not from a broadcast)
  if (languageChannel && !isReceivingBroadcast) {
    try {
      languageChannel.postMessage({
        type: 'languageChanged',
        language: lng
      });
    } catch (e) {
      // Ignore errors
    }
  }
});

// Listen for preference changes to update language
window.addEventListener('preferenceChanged', (e) => {
  const { path, value } = e.detail;
  if (path === 'general.language' && value && (value === 'en' || value === 'he')) {
    if (i18n.language !== value) {
      isUpdatingFromPreference = true;
      i18n.changeLanguage(value).finally(() => {
        isUpdatingFromPreference = false;
      });
    }
  }
});

// Also listen for storage changes (cross-tab sync)
window.addEventListener('storage', (e) => {
  if (e.key === 'preferences' && e.newValue) {
    try {
      const preferences = JSON.parse(e.newValue);
      const prefLanguage = preferences?.general?.language;
      if (prefLanguage && (prefLanguage === 'en' || prefLanguage === 'he') && i18n.language !== prefLanguage) {
        isUpdatingFromPreference = true;
        i18n.changeLanguage(prefLanguage).finally(() => {
          isUpdatingFromPreference = false;
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }
});

export default i18n;

