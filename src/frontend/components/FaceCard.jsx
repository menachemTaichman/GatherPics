import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useEventUrls } from '../utils/useEventUrls';


export default function FaceCard({ group, cardSize = 1.0, onEdit, onDownload }) {
  const params = useParams();
  const eventUrl = params.eventUrl;
  const { urlHelpers, loading, error } = useEventUrls(eventUrl);


  // Inline SVG placeholder (gray background with a question mark)
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  const handleImageError = (e) => {
    e.target.src = PLACEHOLDER_DATA_URL; // Fallback image
  };


  
  // Use representative_face for the group representative image
  const imageSrc = group.representative_face && urlHelpers
    ? urlHelpers.getFaceCropUrl(group.representative_face)
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
        <Link to={`/${eventUrl}/persons/${group.label}`} className="block mb-3 w-full flex justify-center">
          <div 
            className="relative rounded-full overflow-hidden shadow-lg group"
            style={{ 
              width: `${144 * cardSize}px`, 
              height: `${144 * cardSize}px` 
            }}
          >
            <img
              src={imageSrc}
              alt={group.label || `Person ${group.group_id}`}
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
                {group.label || `Person ${group.group_id}`}
              </h3>
              <p className="text-xs text-gray-500">
                {group.images_count || 0} photos
              </p>
            </div>
            
            {/* Action Menu Button */}
            <div className="relative">
              <button
                onClick={() => onEdit()}
                className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                title="Edit group"
              >
                <Pencil className="w-3 h-3 text-gray-500" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>


    </>
  );
} 