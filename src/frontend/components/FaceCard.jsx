const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Edit, MoreVertical, User } from 'lucide-react';

export default function FaceCard({ group, cardSize = 1, onEdit, onDownload }) {
  const [showActions, setShowActions] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

  // Inline SVG placeholder (gray background with a question mark)
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  const handleImageError = (e) => {
    e.target.src = PLACEHOLDER_DATA_URL; // Fallback image
  };

  const updateMenuPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right - 140 // 140px is the min-width of the menu
      });
    }
  };

  const handleToggleActions = () => {
    if (!showActions) {
      updateMenuPosition();
    }
    setShowActions(!showActions);
  };
          // Use face_representative for the group representative image
        const imageSrc = group.face_representative
            ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representative}.webp`
    : PLACEHOLDER_DATA_URL;

  return (
    <>
      <motion.div
        className="face-card group relative flex flex-col items-center w-full"
        style={{ 
          transition: 'transform 0.2s ease-out'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-4px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Circular Image Container */}
        <Link to={`/group/${group.label}`} className="block mb-3 w-full flex justify-center">
          <div 
            className="relative rounded-full overflow-hidden shadow-lg group"
            style={{ 
              width: `${144 * cardSize}px`, 
              height: `${144 * cardSize}px` 
            }}
          >
            <img
              src={imageSrc}
              alt={group.label || `Person ${group.groupID}`}
              className="w-full h-full object-cover"
              style={{
                objectPosition: 'center center'
              }}
              loading="lazy"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = PLACEHOLDER_DATA_URL;
              }}
            />
            
            {/* Shadow overlay on hover */}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 rounded-full"></div>
          </div>
        </Link>

        {/* Card Content - Below the circle */}
        <div className="text-center w-full">
          <div className="flex items-center justify-center space-x-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 truncate text-sm">
                {group.label || `Person ${group.groupID}`}
              </h3>
              <p className="text-xs text-gray-500">
                {group.image_ids?.length || 0} photos
              </p>
            </div>
            
            {/* Action Menu Button */}
            <div className="relative">
              <button
                ref={buttonRef}
                onClick={handleToggleActions}
                className="p-1 rounded-full hover:bg-gray-100 transition-colors"
              >
                <MoreVertical className="w-3 h-3 text-gray-500" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Dropdown Menu - Rendered as Portal */}
      <AnimatePresence>
        {showActions && (
          <div key="dropdown-menu">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[1000] min-w-[140px]"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
                transformOrigin: 'top right'
              }}
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
                <span>Add to Bucket</span>
              </button>
            </motion.div>

            {/* Click outside to close */}
            <div
              className="fixed inset-0 z-[999]"
              onClick={() => setShowActions(false)}
            />
          </div>
        )}
      </AnimatePresence>
    </>
  );
} 