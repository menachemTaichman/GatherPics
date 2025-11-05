import { Link, useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Settings, Clock, User, ShoppingBag, Home, Album, Upload, Bell } from 'lucide-react';
import { SettingsManager, BucketDrawer } from './';
import useBucketStore from '../../utils/bucketStore';
import { usePermissions } from '../../hooks/usePermissions';
import NotificationsDropdown from '../notifications/NotificationsDropdown.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { profilesAPI } from '../../utils/apiService';
import { getCurrentProfile } from '../../utils/profileService';
import { useDataStore } from '../../utils/dataManager';
import { useAuth } from '../../contexts/authContext';
import { usePendingRequestsCount } from '../../utils/storeUtils';

export default function Header() {
  const location = useLocation();
  const params = useParams();
  const eventUrl = params.eventUrl;
  const { toggle, lastPulseTs, queue, isOpen } = useBucketStore();
  const permissions = usePermissions();

  const getEventPath = (path) => `/${eventUrl}${path}`;

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifButtonRef, setNotifButtonRef] = useState(null);
  const { isAuthenticated } = useAuth();
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => { unmountedRef.current = true; };
  }, []);

  // Local counts sourced from current_profile
  const [notifCounts, setNotifCounts] = useState({ unreadCount: 0, totalCount: 0 });
  // Synchronous fallback from cached profile
  const cachedProfile = getCurrentProfile() || {};
  const effectiveCounts = {
    totalCount: Number(notifCounts?.totalCount || cachedProfile?.total_notifications || 0),
    unreadCount: Number(notifCounts?.unreadCount || cachedProfile?.unread_notifications || 0),
  };
  const effectivePendingRequestsCount = usePendingRequestsCount();
  const pendingFeedbacksCount = Number(cachedProfile?.pending_feedbacks || 0);

  // No debug logs

  // Fetch counts once per (eventUrl, isAuthenticated) combo
  const lastFetchSigRef = useRef('');
  useEffect(() => {
    const sig = `${eventUrl || ''}|${isAuthenticated ? '1' : '0'}`;
    if (!isAuthenticated) return;
    if (lastFetchSigRef.current === sig) {
      return;
    }
    lastFetchSigRef.current = sig;
    (async () => {
      try {
        await profilesAPI.getCurrentProfile(eventUrl);
        // currentProfile updated via changes, read from localStorage
        const p = getCurrentProfile() || {};
        const totalNum = Number(p.total_notifications || 0);
        const unreadNum = Number(p.unread_notifications || 0);
        if (!unmountedRef.current) {
          setNotifCounts({ unreadCount: unreadNum, totalCount: totalNum });
        }
      } catch (e) {
        // fallback to local cache
        const p = getCurrentProfile() || {};
        const totalNum = Number(p.total_notifications || 0);
        const unreadNum = Number(p.unread_notifications || 0);
        if (!unmountedRef.current) {
          setNotifCounts({ unreadCount: unreadNum, totalCount: totalNum });
        }
      }
    })();
  }, [eventUrl, isAuthenticated]);

  useEffect(() => {
    const closeOnOutside = (e) => {
      if (notifOpen) setNotifOpen(false);
    };
    if (notifOpen) {
      document.addEventListener('click', closeOnOutside);
      return () => document.removeEventListener('click', closeOnOutside);
    }
  }, [notifOpen]);

  return (
    <motion.header 
      className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="w-full px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Title */}
          <Link to={getEventPath('/people')} className="flex items-center space-x-3 group">
            <motion.div
              className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Users className="w-6 h-6 text-white" />
            </motion.div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                Face Gallery
              </h1>
              <p className="text-sm text-gray-500">AI-Powered Face Recognition</p>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center space-x-3">
            <Link
              to={getEventPath('')}
              className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                location.pathname === `/${eventUrl}` || location.pathname === `/${eventUrl}/`
                  ? 'bg-primary-100 text-primary-700' 
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
              title="Home"
            >
              <Home className="w-4 h-4" />
            </Link>

            {permissions.has_groups && (
              <Link
                to={getEventPath('/people')}
                className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                  location.pathname.includes('/people') 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title="People"
              >
                <User className="w-4 h-4" />
              </Link>
            )}

            {/* Albums Navigation */}
            {(permissions.has_albums || permissions.hasArchiveAlbum || permissions.hasFavoritesAlbum || permissions.canEdit) && (
              <Link
                to={getEventPath('/albums')}
                className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                  location.pathname.includes('/albums') 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title="Albums"
              >
                <Album className="w-4 h-4" />
              </Link>
            )}

            {permissions.has_images && (
              <Link
                to={getEventPath('/timeline')}
                className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                  location.pathname.includes('/timeline')
                    ? 'bg-primary-100 text-primary-700'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title="Timeline"
              >
                <Clock className="w-4 h-4" />
              </Link>
            )}

            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className={`w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center ${isOpen ? 'text-primary-700 bg-primary-100' : 'text-gray-700'}`}
              title="Bucket"
              animate={{ scale: lastPulseTs ? [1, 1.15, 1] : 1 }}
              transition={{ duration: 0.4 }}
              key={lastPulseTs}
              data-bucket-toggle="true"
            >
              <div className="relative">
                <ShoppingBag className="w-4 h-4" />
                {queue.length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                    {queue.length}
                  </span>
                )}
              </div>
            </motion.button>

            {permissions.canUploadAndDeleteImages && (
              <Link
                to={getEventPath('/uploads')}
                className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                  location.pathname.includes('/uploads')
                    ? 'bg-primary-100 text-primary-700'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title="Uploads"
              >
                <Upload className="w-4 h-4" />
              </Link>
            )}

            <SettingsManager />

            {/* Notifications Button - last after settings */}
            {(effectiveCounts?.totalCount || 0) > 0 && (
              <button
                ref={setNotifButtonRef}
                onClick={(e) => { e.stopPropagation(); setNotifOpen((v) => !v); }}
                className={`w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center ${notifOpen ? 'text-primary-700 bg-primary-100' : 'text-gray-700'}`}
                title="Notifications"
              >
                <div className="relative">
                  <Bell className="w-4 h-4" />
                  {(effectiveCounts?.unreadCount || 0) > 0 && (
                    <span className="absolute -top-2 -right-2 bg-primary-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                      {effectiveCounts.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            )}
          </nav>
        </div>
      </div>
      <BucketDrawer />
      {notifOpen && notifButtonRef && (
        <NotificationsDropdown buttonRef={notifButtonRef} isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
    </motion.header>
  );
} 


