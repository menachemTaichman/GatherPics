import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enTranslations from './locales/en.json';
import heTranslations from './locales/he.json';

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

export default i18n;

