import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useParams, useLocation } from 'react-router-dom';
import { Menu, X, Home, UserCircle, LayoutDashboard, Calendar, MessageSquare, FileText } from 'lucide-react';
import { getCurrentProfile } from '../../utils/profileService';
import { useAuth } from '../../contexts/authContext';
import { usePermissions } from '../../hooks/usePermissions';
import { APP_CONFIG } from '../../config/appConfig';

export default function HamburgerMenu({ eventName, eventUrl, variant = 'dark' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const { isAuthenticated } = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const params = useParams();
  const currentEventUrl = params.eventUrl || eventUrl;
  
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
        setMenuPosition({
          top: rect.bottom + 8,
          left: rect.left
        });
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
  }, [isOpen]);

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
    window.dispatchEvent(new CustomEvent('account:open'));
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
      label: 'My Account',
      icon: UserCircle,
      onClick: handleAccountClick,
      show: true
    },
    {
      id: 'event',
      label: eventName || 'Event Page',
      icon: Calendar,
      to: currentEventUrl ? `/${currentEventUrl}` : null,
      show: Boolean(currentEventUrl)
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      to: '/dashboard',
      show: hasDashboard
    },
    {
      id: 'feedback',
      label: 'Send Feedback',
      icon: MessageSquare,
      onClick: handleFeedbackClick,
      show: true
    },
    {
      id: 'about',
      label: 'About',
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
          style={{
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`
          }}
        >
          <div className="max-h-[80vh] overflow-y-auto">
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = item.to && location.pathname === item.to;
              
              if (item.onClick) {
                return (
                  <button
                    key={item.id}
                    onClick={item.onClick}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <Icon className="w-5 h-5 text-gray-500" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                );
              }

              if (!item.to) return null;

              return (
                <Link
                  key={item.id}
                  to={item.to}
                  onClick={() => setIsOpen(false)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
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
        aria-label="Menu"
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

