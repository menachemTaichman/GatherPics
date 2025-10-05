import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { getImageCount } from '../utils/settings';
import { useImageComponent } from '../utils/useImage.jsx';
import { getRepresentativeUrl } from '../utils/storeUtils';


export default function FaceCard({ group, cardSize = 1.0, onEdit, onDownload, urlHelpers: injectedUrlHelpers, eventUrl }) {
  // Resolve eventUrl from props or route params
  const params = useParams();
  const evUrl = eventUrl || params?.eventUrl || '';
  // Require urlHelpers from parent to avoid many hook instances resolving eventId independently
  const urlHelpers = injectedUrlHelpers || null;
  
  // Get representative URL for the group and append a version to avoid cached 204s on back nav
  const baseRep = getRepresentativeUrl(urlHelpers, 'groups', group.id);
  const version = (group?.images instanceof Set ? group.images.size : getImageCount(group)) || 0;
  const imageSrc = baseRep ? `${baseRep}${baseRep.includes('?') ? '&' : '?'}v=${version}` : null;

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
        <Link to={`/${evUrl}/persons/${group.label}`} className="block mb-3 w-full flex justify-center">
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
        // Force reload when URL or group count changes (fix stale placeholders on back nav)
        key: `${imageSrc || 'null'}:${getImageCount(group)}`,
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

