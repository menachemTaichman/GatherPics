import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, Edit, Trash2, MoreVertical, User } from 'lucide-react';

export default function FaceCard({ group, onEdit, onDelete, onDownload }) {
  const [showActions, setShowActions] = useState(false);

  const handleImageError = (e) => {
    e.target.src = '/placeholder-face.jpg'; // Fallback image
  };

  return (
    <motion.div
      className="face-card group relative"
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      {/* Main Image */}
      <Link to={`/face/${group.id}`} className="block">
        <div className="relative overflow-hidden">
          <img
            src={`/images/${group.representative}`}
            alt={group.label || `Person ${group.id}`}
            className="face-image"
            onError={handleImageError}
          />
          
          {/* Overlay with photo count */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="absolute bottom-3 left-3 text-white">
              <div className="flex items-center space-x-1">
                <User className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {group.image_ids?.length || 0} photos
                </span>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* Card Content */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {group.label || `Person ${group.id}`}
            </h3>
            <p className="text-sm text-gray-500">
              {group.image_ids?.length || 0} photos
            </p>
          </div>
          
          {/* Action Menu */}
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            >
              <MoreVertical className="w-4 h-4 text-gray-500" />
            </button>
            
            {showActions && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[140px]"
              >
                <button
                  onClick={() => {
                    onEdit();
                    setShowActions(false);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  <span>Edit</span>
                </button>
                
                <button
                  onClick={() => {
                    onDownload();
                    setShowActions(false);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
                
                <hr className="my-1" />
                
                <button
                  onClick={() => {
                    onDelete();
                    setShowActions(false);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Click outside to close actions */}
      {showActions && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowActions(false)}
        />
      )}
    </motion.div>
  );
} 