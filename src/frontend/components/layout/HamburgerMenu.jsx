import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useParams, useLocation } from 'react-router-dom';
import { Menu, X, Home, UserCircle, LayoutDashboard, Calendar, MessageSquare, FileText, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { getCurrentProfile } from '../../utils/profileService';
import { useAuth } from '../../contexts/authContext';
import { usePermissions } from '../../hooks/usePermissions';
import { APP_CONFIG } from '../../config/appConfig';
import { useRTL } from '../../hooks/useRTL';
import { setPreference } from '../../utils/settings';
import { LongPressHoverButton } from '../common';

export default function HamburgerMenu({ eventName, eventUrl, variant = 'dark' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const { isAuthenticated, openLoginModal } = useAuth();
  const permissions = usePermissions();
  const { t, i18n: i18nInstance } = useTranslation();
  const location = useLocation();
  const params = useParams();
  const currentEventUrl = params.eventUrl || eventUrl;
  const { isRTL } = useRTL();
  
  const isLight = variant === 'light';
  const buttonClass = isLight 
    ? 'w-10 h-10 flex items-center justify-center transition-all text-gray-700 hover:text-gray-900 hover:bg-gray-100 bg-transparent border-none p-0 rounded-lg'
    : 'w-10 h-10 flex items-center justify-center transition-all text-white hover:opacity-80 bg-transparent border-none p-0';
  const iconStyle = isLight ? {} : { filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8)) drop-shadow(0 0 1px rgba(0,0,0,0.5))' };

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const menuWidth = 256; // w-64 = 256px
        if (isRTL) {
          // Position from right edge in RTL
          setMenuPosition({
            top: rect.bottom + 8,
            right: window.innerWidth - rect.right,
            left: 'auto'
          });
        } else {
          // Position from left edge in LTR
          setMenuPosition({
            top: rect.bottom + 8,
            left: rect.left,
            right: 'auto'
          });
        }
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [isOpen, isRTL]);

  // Update position immediately when language/direction changes
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 256;
      if (document.documentElement.dir === 'rtl') {
        setMenuPosition({
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
          left: 'auto'
        });
      } else {
        setMenuPosition({
          top: rect.bottom + 8,
          left: rect.left,
          right: 'auto'
        });
      }
    }
  }, [i18nInstance.language, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isOpen && menuRef.current && buttonRef.current && 
          !menuRef.current.contains(e.target) && 
          !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const currentProfile = getCurrentProfile();
  const hasDashboard = isAuthenticated && currentProfile?.has_dashboard;

  const getEventPath = (path) => {
    if (!currentEventUrl) return path;
    return `/${currentEventUrl}${path}`;
  };

  const handleAccountClick = () => {
    setIsOpen(false);
    if (isAuthenticated) {
      window.dispatchEvent(new CustomEvent('account:open'));
    } else {
      openLoginModal();
    }
  };

  const handleFeedbackClick = () => {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('feedback:open-form'));
  };

  const menuItems = [
    {
      id: 'home',
      label: APP_CONFIG.name,
      icon: Home,
      to: '/',
      show: true
    },
    {
      id: 'account',
      label: isAuthenticated ? t('menu.myAccount') : t('homePage.logIn'),
      icon: UserCircle,
      onClick: handleAccountClick,
      show: true
    },
    {
      id: 'event',
      label: eventName || t('menu.eventPage'),
      icon: Calendar,
      to: currentEventUrl ? `/${currentEventUrl}` : null,
      show: Boolean(currentEventUrl)
    },
    {
      id: 'dashboard',
      label: t('menu.dashboard'),
      icon: LayoutDashboard,
      to: '/dashboard',
      show: hasDashboard
    },
    {
      id: 'feedback',
      label: t('menu.sendFeedback'),
      icon: MessageSquare,
      onClick: handleFeedbackClick,
      show: true
    },
    {
      id: 'about',
      label: t('menu.about'),
      icon: FileText,
      to: '/about',
      show: true
    }
  ].filter(item => item.show);

  const menuContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ duration: 0.2 }}
          className="fixed w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50"
          dir={isRTL ? 'rtl' : 'ltr'}
          style={{
            top: `${menuPosition.top}px`,
            ...(isRTL ? { right: `${menuPosition.right}px` } : { left: `${menuPosition.left}px` })
          }}
        >
          <div 
            className="max-h-[80vh] overflow-y-auto" 
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = item.to && location.pathname === item.to;
              
              if (item.onClick) {
                return (
                  <LongPressHoverButton
                    key={item.id}
                    onClick={item.onClick}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-gray-700"
                    dir={isRTL ? 'rtl' : 'ltr'}
                    title={item.label}
                    aria-label={item.label}
                  >
                    <Icon className="w-5 h-5 text-gray-500" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </LongPressHoverButton>
                );
              }

              if (!item.to) return null;

              return (
                <Link
                  key={item.id}
                  to={item.to}
                  onClick={() => setIsOpen(false)}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                  }`}
                  dir={isRTL ? 'rtl' : 'ltr'}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
            
            {/* Language Selector */}
            <div className="border-t border-gray-200 mt-2">
              <div className="px-4 py-2">
                <div className="flex items-center gap-3 mb-3" dir={isRTL ? 'rtl' : 'ltr'}>
                  <Languages className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">{t('menu.language')}</span>
                </div>
                <div className="flex gap-1.5 p-1 bg-gray-100 rounded-lg">
                  <LongPressHoverButton
                    onClick={async () => {
                      await setPreference('general.language', 'en');
                      i18n.changeLanguage('en');
                    }}
                    className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                      i18nInstance.language === 'en'
                        ? 'bg-white text-primary-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    title={t('menu.english')}
                    aria-label={t('menu.english')}
                  >
                    {t('menu.english')}
                  </LongPressHoverButton>
                  <LongPressHoverButton
                    onClick={async () => {
                      await setPreference('general.language', 'he');
                      i18n.changeLanguage('he');
                    }}
                    className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                      i18nInstance.language === 'he'
                        ? 'bg-white text-primary-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    title={t('menu.hebrew')}
                    aria-label={t('menu.hebrew')}
                  >
                    {t('menu.hebrew')}
                  </LongPressHoverButton>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClass}
        style={iconStyle}
        title={t('menu.menu')}
        aria-label={t('menu.menu')}
      >
        {isOpen ? (
          <X className="w-5 h-5" style={iconStyle} />
        ) : (
          <Menu className="w-5 h-5" style={iconStyle} />
        )}
      </button>
      {isClient && createPortal(menuContent, document.body)}
    </div>
  );
}

