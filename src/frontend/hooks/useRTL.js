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
    const paddingClasses = {
      '0': { ltr: 'pl-0', rtl: 'pr-0' },
      '1': { ltr: 'pl-1', rtl: 'pr-1' },
      '2': { ltr: 'pl-2', rtl: 'pr-2' },
      '3': { ltr: 'pl-3', rtl: 'pr-3' },
      '4': { ltr: 'pl-4', rtl: 'pr-4' },
      '10': { ltr: 'pl-10', rtl: 'pr-10' },
      '12': { ltr: 'pl-12', rtl: 'pr-12' },
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
      '10': { ltr: 'pr-10', rtl: 'pl-10' },
      '12': { ltr: 'pr-12', rtl: 'pl-12' },
    };
    const classes = paddingEndClasses[size];
    return classes ? (isRTL ? classes.rtl : classes.ltr) : '';
  };

  /**
   * Returns RTL-aware position string ('left' or 'right')
   * @returns {string} 'left' in LTR, 'right' in RTL
   */
  const start = () => isRTL ? 'right' : 'left';

  /**
   * Returns RTL-aware position string ('right' or 'left')
   * @returns {string} 'right' in LTR, 'left' in RTL
   */
  const end = () => isRTL ? 'left' : 'right';

  /**
   * Returns RTL-aware Tailwind class for start positioning
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind position class (e.g., 'left-4' or 'right-4')
   */
  const startClass = (size) => isRTL ? `right-${size}` : `left-${size}`;

  /**
   * Returns RTL-aware Tailwind class for end positioning
   * @param {string} size - Tailwind spacing size (e.g., '1', '2', '3', '4')
   * @returns {string} Tailwind position class (e.g., 'right-4' or 'left-4')
   */
  const endClass = (size) => isRTL ? `left-${size}` : `right-${size}`;

  /**
   * Returns transform class to flip icon horizontally for RTL
   * @returns {string} 'scale-x-[-1]' in RTL, empty string in LTR
   */
  const flipX = () => isRTL ? 'scale-x-[-1]' : '';

  /**
   * Returns flex direction class for button with icon after text
   * @returns {string} 'flex-row-reverse' in RTL, empty string in LTR
   */
  const buttonIconOrder = () => isRTL ? 'flex-row-reverse' : '';

  return {
    isRTL,
    ms, // margin-start
    me, // margin-end
    ps, // padding-start
    pe, // padding-end
    start, // position string 'left'/'right'
    end, // position string 'right'/'left'
    startClass, // position class 'left-*'/'right-*'
    endClass, // position class 'right-*'/'left-*'
    flipX, // icon flip transform
    buttonIconOrder, // button layout (deprecated - use dir instead)
  };
}
