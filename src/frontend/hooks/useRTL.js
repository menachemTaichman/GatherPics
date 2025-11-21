import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Hook that provides RTL-aware utilities for spacing and layout
 * @returns {Object} Object containing isRTL flag and spacing utility functions
 */
export function useRTL() {
  const { i18n } = useTranslation();
  const [isRTL, setIsRTL] = useState(() => document.documentElement.dir === 'rtl');
  
  // Update RTL state when language changes
  useEffect(() => {
    const updateDirection = () => {
      setIsRTL(document.documentElement.dir === 'rtl');
    };
    updateDirection();
    
    // Listen to language changes
    i18n.on('languageChanged', updateDirection);
    
    // Also watch for dir attribute changes
    const observer = new MutationObserver(updateDirection);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir']
    });
    
    return () => {
      i18n.off('languageChanged', updateDirection);
      observer.disconnect();
    };
  }, [i18n]);

  // Mapping of size to Tailwind classes for margins
  const marginClasses = {
    '0': { ltr: 'ml-0', rtl: 'mr-0' },
    '1': { ltr: 'ml-1', rtl: 'mr-1' },
    '2': { ltr: 'ml-2', rtl: 'mr-2' },
    '3': { ltr: 'ml-3', rtl: 'mr-3' },
    '4': { ltr: 'ml-4', rtl: 'mr-4' },
    '5': { ltr: 'ml-5', rtl: 'mr-5' },
    '6': { ltr: 'ml-6', rtl: 'mr-6' },
    '8': { ltr: 'ml-8', rtl: 'mr-8' },
  };

  const marginEndClasses = {
    '0': { ltr: 'mr-0', rtl: 'ml-0' },
    '1': { ltr: 'mr-1', rtl: 'ml-1' },
    '2': { ltr: 'mr-2', rtl: 'ml-2' },
    '3': { ltr: 'mr-3', rtl: 'ml-3' },
    '4': { ltr: 'mr-4', rtl: 'ml-4' },
    '5': { ltr: 'mr-5', rtl: 'ml-5' },
    '6': { ltr: 'mr-6', rtl: 'ml-6' },
    '8': { ltr: 'mr-8', rtl: 'ml-8' },
  };

  /**
   * Returns RTL-aware margin class for start (left in LTR, right in RTL)
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind margin class
   */
  const ms = (size) => {
    const classes = marginClasses[size];
    return classes ? (isRTL ? classes.rtl : classes.ltr) : '';
  };

  /**
   * Returns RTL-aware margin class for end (right in LTR, left in RTL)
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind margin class
   */
  const me = (size) => {
    const classes = marginEndClasses[size];
    return classes ? (isRTL ? classes.rtl : classes.ltr) : '';
  };

  /**
   * Returns RTL-aware padding class for start (left in LTR, right in RTL)
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind padding class
   */
  const ps = (size) => {
    // For now, return empty - can be extended if needed
    const paddingClasses = {
      '0': { ltr: 'pl-0', rtl: 'pr-0' },
      '1': { ltr: 'pl-1', rtl: 'pr-1' },
      '2': { ltr: 'pl-2', rtl: 'pr-2' },
      '3': { ltr: 'pl-3', rtl: 'pr-3' },
      '4': { ltr: 'pl-4', rtl: 'pr-4' },
    };
    const classes = paddingClasses[size];
    return classes ? (isRTL ? classes.rtl : classes.ltr) : '';
  };

  /**
   * Returns RTL-aware padding class for end (right in LTR, left in RTL)
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind padding class
   */
  const pe = (size) => {
    const paddingEndClasses = {
      '0': { ltr: 'pr-0', rtl: 'pl-0' },
      '1': { ltr: 'pr-1', rtl: 'pl-1' },
      '2': { ltr: 'pr-2', rtl: 'pl-2' },
      '3': { ltr: 'pr-3', rtl: 'pl-3' },
      '4': { ltr: 'pr-4', rtl: 'pl-4' },
    };
    const classes = paddingEndClasses[size];
    return classes ? (isRTL ? classes.rtl : classes.ltr) : '';
  };

  return {
    isRTL,
    ms, // margin-start
    me, // margin-end
    ps, // padding-start
    pe, // padding-end
  };
}

