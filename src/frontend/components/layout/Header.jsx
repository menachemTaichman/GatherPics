import { Link, useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Settings, Clock, User, ShoppingBag, Home, Album, Upload } from 'lucide-react';
import { SettingsManager, BucketDrawer } from './';
import useBucketStore from '../../utils/bucketStore';
import { usePermissions } from '../../hooks/usePermissions';

export default function Header() {
  const location = useLocation();
  const params = useParams();
  const eventUrl = params.eventUrl;
  const { toggle, lastPulseTs, queue, isOpen } = useBucketStore();
  const permissions = usePermissions();

  const getEventPath = (path) => `/${eventUrl}${path}`;

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
          </nav>
        </div>
      </div>
      <BucketDrawer />
    </motion.header>
  );
} 


