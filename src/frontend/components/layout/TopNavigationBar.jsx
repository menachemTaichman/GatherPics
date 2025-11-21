import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingBag, Bell, Calendar, Users, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import HamburgerMenu from './HamburgerMenu.jsx';
import { BucketDrawer } from './';
import useBucketStore from '../../utils/bucketStore';
import { profilesAPI } from '../../utils/apiService';
import { getCurrentProfile } from '../../utils/profileService';
import { useAuth } from '../../contexts/authContext';
import { usePermissions } from '../../hooks/usePermissions';
import NotificationsDropdown from '../notifications/NotificationsDropdown.jsx';

// Debug flag - set to true to enable debug logging
const DEBUG_LANGUAGE = true;

export default function TopNavigationBar({ eventName, eventUrl, onNotifButtonRef, notifOpen: notifOpenProp, setNotifOpen: setNotifOpenProp, variant = 'dark', showBackground = false, mode = 'full' }) {
  const { toggle, lastPulseTs, queue } = useBucketStore();
  const { isAuthenticated } = useAuth();
  const { t, i18n } = useTranslation();
  const { isRTL } = useRTL();
  const location = useLocation();
  const [notifCounts, setNotifCounts] = useState({ unreadCount: 0, totalCount: 0 });
  const [notifButtonRef, setNotifButtonRef] = useState(null);
  const [internalNotifOpen, setInternalNotifOpen] = useState(false);
  const permissions = usePermissions();
  
  // Debug refs to track changes
  const prevLanguageRef = useRef(i18n.language);
  const prevRTLRef = useRef(isRTL);
  const renderCountRef = useRef(0);
  const containerRef = useRef(null);
  
  // Track renders
  renderCountRef.current += 1;
  
  // Debug: Log language and RTL changes
  useEffect(() => {
    if (!DEBUG_LANGUAGE) return;
    
    const currentLang = i18n.language;
    const docDir = document.documentElement.dir;
    const docLang = document.documentElement.lang;
    
    if (prevLanguageRef.current !== currentLang) {
      console.log('[TopNavBar] Language changed:', {
        from: prevLanguageRef.current,
        to: currentLang,
        docDir,
        docLang,
        isRTL,
        timestamp: new Date().toISOString(),
        renderCount: renderCountRef.current
      });
      prevLanguageRef.current = currentLang;
    }
    
    if (prevRTLRef.current !== isRTL) {
      console.log('[TopNavBar] RTL changed:', {
        from: prevRTLRef.current,
        to: isRTL,
        language: currentLang,
        docDir,
        timestamp: new Date().toISOString(),
        renderCount: renderCountRef.current
      });
      prevRTLRef.current = isRTL;
    }
  }, [i18n.language, isRTL]);
  
  // Debug: Log layout measurements when language/RTL changes
  useEffect(() => {
    if (!DEBUG_LANGUAGE || !containerRef.current) return;
    
    const measureLayout = () => {
      const container = containerRef.current;
      if (!container) return;
      
      const rect = container.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(container);
      
      console.log('[TopNavBar] Layout measurements:', {
        language: i18n.language,
        isRTL,
        docDir: document.documentElement.dir,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        paddingLeft: computedStyle.paddingLeft,
        paddingRight: computedStyle.paddingRight,
        justifyContent: computedStyle.justifyContent,
        direction: computedStyle.direction,
        timestamp: new Date().toISOString()
      });
    };
    
    // Measure immediately
    measureLayout();
    
    // Measure after a short delay to catch any layout shifts
    const timeoutId = setTimeout(measureLayout, 100);
    
    return () => clearTimeout(timeoutId);
  }, [i18n.language, isRTL]);
  
  // Debug: Listen to language change events
  useEffect(() => {
    if (!DEBUG_LANGUAGE) return;
    
    const handleLanguageChanged = (lng) => {
      console.log('[TopNavBar] languageChanged event:', {
        newLanguage: lng,
        currentLanguage: i18n.language,
        docDir: document.documentElement.dir,
        isRTL,
        timestamp: new Date().toISOString()
      });
    };
    
    i18n.on('languageChanged', handleLanguageChanged);
    
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n, isRTL]);
  
  // Debug: Log render info
  useEffect(() => {
    if (!DEBUG_LANGUAGE) return;
    
    console.log('[TopNavBar] Render:', {
      renderCount: renderCountRef.current,
      language: i18n.language,
      isRTL,
      docDir: document.documentElement.dir,
      mode,
      variant,
      timestamp: new Date().toISOString()
    });
  });
  
  // Use prop if provided, otherwise use internal state
  const notifOpen = notifOpenProp !== undefined ? notifOpenProp : internalNotifOpen;
  const setNotifOpen = setNotifOpenProp || setInternalNotifOpen;
  
  // mode can be: 'full' (default), 'minimal' (EventHomePage - only bucket and notifications)
  const isMinimal = mode === 'minimal';
  
  const isLight = variant === 'light';
  const iconColorClass = isLight ? 'text-gray-700' : 'text-white';
  const iconStyle = isLight ? {} : { filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8)) drop-shadow(0 0 1px rgba(0,0,0,0.5))' };
  
  // Consistent button styling
  const buttonClass = isLight 
    ? 'w-10 h-10 flex items-center justify-center transition-all text-gray-700 hover:text-gray-900 hover:bg-gray-100 bg-transparent border-none p-0 rounded-lg'
    : 'w-10 h-10 flex items-center justify-center transition-all text-white hover:opacity-80 bg-transparent border-none p-0';
  
  // Navigation link styling - icon only (no text)
  const navLinkClass = isLight
    ? 'w-10 h-10 flex items-center justify-center transition-all text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg'
    : 'w-10 h-10 flex items-center justify-center transition-all text-white hover:opacity-80 rounded-lg';
  
  // Active navigation link styling - icon only, use fill instead of background
  const activeNavLinkClass = isLight
    ? 'w-10 h-10 flex items-center justify-center transition-all text-primary-600 hover:text-primary-700 rounded-lg'
    : 'w-10 h-10 flex items-center justify-center transition-all text-white hover:opacity-80 rounded-lg';
  
  // Container styling - all items on the left
  const containerClass = isMinimal
    ? 'fixed top-0 left-0 right-0 z-50 px-8 sm:px-10 md:px-12 py-3 flex items-center justify-start pointer-events-none'
    : showBackground 
    ? 'fixed top-0 left-0 right-0 z-50 px-8 sm:px-10 md:px-12 py-3 flex items-center justify-start pointer-events-none bg-white shadow-sm border-b border-gray-200/50'
      : 'fixed top-0 left-0 right-0 z-50 px-8 sm:px-10 md:px-12 py-3 flex items-center justify-start pointer-events-none bg-white shadow-sm border-b border-gray-200';

  // Sync notifButtonRef with parent callback
  useEffect(() => {
    if (onNotifButtonRef) {
      onNotifButtonRef(notifButtonRef);
    }
  }, [notifButtonRef, onNotifButtonRef]);

  // Notification counts
  const cachedProfile = getCurrentProfile() || {};
  const effectiveCounts = {
    totalCount: Number(notifCounts?.totalCount || cachedProfile?.total_notifications || 0),
    unreadCount: Number(notifCounts?.unreadCount || cachedProfile?.unread_notifications || 0),
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        await profilesAPI.getCurrentProfile(eventUrl);
        const p = getCurrentProfile() || {};
        const totalNum = Number(p.total_notifications || 0);
        const unreadNum = Number(p.unread_notifications || 0);
        setNotifCounts({ unreadCount: unreadNum, totalCount: totalNum });
      } catch (e) {
        const p = getCurrentProfile() || {};
        const totalNum = Number(p.total_notifications || 0);
        const unreadNum = Number(p.unread_notifications || 0);
        setNotifCounts({ unreadCount: unreadNum, totalCount: totalNum });
      }
    })();
  }, [eventUrl, isAuthenticated]);

  // Check if a route is active
  const isActiveRoute = (path) => {
    if (!eventUrl) return false;
    const fullPath = `/${eventUrl}${path}`;
    return location.pathname === fullPath || location.pathname.startsWith(fullPath + '/');
  };

  // For minimal mode (EventHomePage), show hamburger, bucket and notifications on the left
  if (isMinimal) {
  return (
      <>
    <div className={containerClass} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 pointer-events-auto" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Hamburger Menu */}
            <HamburgerMenu eventName={eventName} eventUrl={eventUrl} variant="dark" />
        {/* Bucket */}
        {eventUrl && (
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className={buttonClass}
            style={iconStyle}
            title={t('navigation.bucket')}
            animate={{ scale: lastPulseTs ? [1, 1.15, 1] : 1 }}
            transition={{ duration: 0.4 }}
            key={lastPulseTs}
            data-bucket-toggle="true"
          >
            <div className="relative">
                  <ShoppingBag className={`w-5 h-5 ${iconColorClass}`} style={iconStyle} />
              {queue.length > 0 && (
                <span className={`absolute -top-1 ${isRTL ? '-left-1' : '-right-1'} bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full font-semibold shadow-sm`}>
                  {queue.length}
                </span>
              )}
            </div>
          </motion.button>
        )}
        {/* Notifications */}
        {(effectiveCounts?.totalCount || 0) > 0 && (
          <button
            ref={setNotifButtonRef}
            onClick={(e) => { e.stopPropagation(); setNotifOpen((v) => !v); }}
            className={buttonClass}
            style={iconStyle}
            title={t('navigation.notifications')}
            data-notif-toggle="true"
          >
            <div className="relative">
                  <Bell className={`w-5 h-5 ${iconColorClass}`} style={iconStyle} />
                  {(effectiveCounts?.unreadCount || 0) > 0 && (
                    <span className={`absolute -top-1 ${isRTL ? '-left-1' : '-right-1'} bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full font-semibold shadow-sm`}>
                      {effectiveCounts.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            )}
          </div>
        </div>
        <BucketDrawer />
        {notifOpen && notifButtonRef && (
          <NotificationsDropdown buttonRef={notifButtonRef} isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
        )}
      </>
    );
  }

  // Full mode - show hamburger, navigation links (icon only), bucket, and notifications - all on the left
  // Universal fix: Add padding-top wrapper to prevent content from starting inside header
  return (
    <>
      <div className={containerClass} dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 pointer-events-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          {/* Hamburger Menu */}
          <HamburgerMenu eventName={eventName} eventUrl={eventUrl} variant={isLight ? 'light' : 'dark'} />
          
          {/* Navigation Links - icon only, no text */}
          {eventUrl && (
            <>
              {permissions.has_images && (
                <Link
                  to={`/${eventUrl}/timeline`}
                  className={isActiveRoute('/timeline') ? activeNavLinkClass : navLinkClass}
                  title={t('navigation.timeline')}
                >
                  <Calendar 
                    className={`w-5 h-5 ${isActiveRoute('/timeline') ? (isLight ? 'text-primary-600' : 'text-white') : ''}`}
                    strokeWidth={isActiveRoute('/timeline') ? 2.5 : 2}
                  />
                </Link>
              )}
              {permissions.has_groups && (
                <Link
                  to={`/${eventUrl}/people`}
                  className={isActiveRoute('/people') ? activeNavLinkClass : navLinkClass}
                  title={t('navigation.people')}
                >
                  <Users 
                    className={`w-5 h-5 ${isActiveRoute('/people') ? (isLight ? 'text-primary-600' : 'text-white') : ''}`}
                    strokeWidth={isActiveRoute('/people') ? 2.5 : 2}
                  />
                </Link>
              )}
              {(permissions.has_albums || permissions.hasArchiveAlbum || permissions.hasFavoritesAlbum || permissions.canEdit) && (
                <Link
                  to={`/${eventUrl}/albums`}
                  className={isActiveRoute('/albums') ? activeNavLinkClass : navLinkClass}
                  title={t('navigation.albums')}
                >
                  <ImageIcon 
                    className={`w-5 h-5 ${isActiveRoute('/albums') ? (isLight ? 'text-primary-600' : 'text-white') : ''}`}
                    strokeWidth={isActiveRoute('/albums') ? 2.5 : 2}
                  />
                </Link>
              )}
            </>
          )}
          
          {/* Bucket */}
          {eventUrl && (
            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className={buttonClass}
              style={iconStyle}
              title={t('navigation.bucket')}
              animate={{ scale: lastPulseTs ? [1, 1.15, 1] : 1 }}
              transition={{ duration: 0.4 }}
              key={lastPulseTs}
              data-bucket-toggle="true"
            >
              <div className="relative">
                <ShoppingBag className={`w-5 h-5 ${iconColorClass}`} style={iconStyle} />
                {queue.length > 0 && (
                  <span className={`absolute -top-1 ${isRTL ? '-left-1' : '-right-1'} bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full font-semibold shadow-sm`}>
                    {queue.length}
                  </span>
                )}
              </div>
            </motion.button>
          )}
          
          {/* Notifications */}
          {(effectiveCounts?.totalCount || 0) > 0 && (
            <button
              ref={setNotifButtonRef}
              onClick={(e) => { e.stopPropagation(); setNotifOpen((v) => !v); }}
              className={buttonClass}
              style={iconStyle}
              title={t('navigation.notifications')}
              data-notif-toggle="true"
            >
              <div className="relative">
                <Bell className={`w-5 h-5 ${iconColorClass}`} style={iconStyle} />
              {(effectiveCounts?.unreadCount || 0) > 0 && (
                <span className={`absolute -top-1 ${isRTL ? '-left-1' : '-right-1'} bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full font-semibold shadow-sm`}>
                  {effectiveCounts.unreadCount}
                </span>
              )}
            </div>
          </button>
        )}
        </div>
      </div>
      <BucketDrawer />
      {notifOpen && notifButtonRef && (
        <NotificationsDropdown buttonRef={notifButtonRef} isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
    </>
  );
}

// Export header height constant for pages to use for spacing
export const TOP_NAV_BAR_HEIGHT = '4.5rem';
