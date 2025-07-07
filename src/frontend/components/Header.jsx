import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, Home, Users, Settings, Clock, Smile } from 'lucide-react';

export default function Header() {
  const location = useLocation();

  const handleDownloadAll = async () => {
    try {
      const response = await fetch('/api/download-all');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const blob = await response.blob();
      
      if (blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'face-gallery.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading all photos:', error);
      alert(`Failed to download photos: ${error.message}. Please try again.`);
    }
  };

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
          <Link to="/" className="flex items-center space-x-3 group">
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
          <nav className="flex items-center space-x-4">
            <Link
              to="/"
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                location.pathname === '/' 
                  ? 'bg-primary-100 text-primary-700' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Smile className="w-4 h-4" />
              <span className="hidden sm:inline">Faces</span>
            </Link>

            <Link
              to="/moments"
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                location.pathname.startsWith('/moments')
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Moments</span>
            </Link>

            <button
              onClick={handleDownloadAll}
              className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Download all photos"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Download All</span>
            </button>

            <button
              className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </nav>
        </div>
      </div>
    </motion.header>
  );
} 