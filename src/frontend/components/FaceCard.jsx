import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useEventUrls } from '../utils/useEventUrls';
import { getImageCount } from '../utils/settings';
import { useImageComponent } from '../utils/useImage.jsx';


export default function FaceCard({ group, cardSize = 1.0, onEdit, onDownload }) {
  const params = useParams();
  const eventUrl = params.eventUrl;
  const { urlHelpers } = useEventUrls(eventUrl);
  
  // Get representative URL for the group
  const imageSrc = urlHelpers?.getRepresentativeUrl('groups', group.id) || null;

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
      {useImageComponent(imageSrc, {
        width: 144 * cardSize,
        height: 144 * cardSize,
        className: 'w-full h-full object-cover',
        alt: group.label || `Person ${group.group_id}`,
        iconType: 'person',
        style: {
          objectPosition: 'center center'
        }
      })}
            
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
                {getImageCount(group)} photos
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