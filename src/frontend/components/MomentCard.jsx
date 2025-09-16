import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { Image, Clock, Calendar, Grid, List, CheckCheck, X, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { albumsAPI } from '../utils/apiService';
import SingleImageTile from './SingleImageTile';
import SingleImageRow from './SingleImageRow';

function formatTimeOnly(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateString;
  }
}

const MomentCard = forwardRef(({
  moment,
  images,
  viewMode,
  imageSize,
  globalSelection,
  onImageSelect,
  onOpenImageViewer,
  selectionMode,
  onSelectAllInMoment,
  onClearMomentSelection,
  onToggleFavorites,
  onToggleArchive,
  showToast,
  eventUrl
}, ref) => {
  // Calculate selection stats for this moment
  const momentimageKeys = images.map(image => `${moment.momentID}:${image.label}`);
  const selectedInMoment = momentimageKeys.filter(key => globalSelection.has(key));
  const allSelectedInMoment = images.length > 0 && selectedInMoment.length === images.length;
  const someSelectedInMoment = selectedInMoment.length > 0 && selectedInMoment.length < images.length;

  // Helper function to check if image is favorite
  const isImageFavorite = (img) => {
    if (!img) return false;
    if (img.is_favorite !== undefined && img.is_favorite !== null) {
      return !!img.is_favorite;
    }
    if (img.is_favorites !== undefined && img.is_favorites !== null) {
      return !!img.is_favorites;
    }
    return Array.isArray(img.albums) && img.albums.some(a => (a || '').toLowerCase() === 'favorites');
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 }}
      className="relative flex"
    >
      <div className="flex-1">
        <motion.div
          className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow duration-300"
          whileHover={{ y: -2 }}
        >
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start space-x-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold text-gray-900">{moment.label}</h3>
                </div>
                                 <div className="flex items-center space-x-4 text-sm text-gray-500 h-8">
                   <div className="flex items-center space-x-1">
                     <Clock className="w-4 h-4" />
                     <span>{formatTimeOnly(moment.start)} - {formatTimeOnly(moment.end)}</span>
                   </div>
                   <div className="flex items-center space-x-1">
                     <Calendar className="w-4 h-4" />
                     <span>{formatDate(moment.start)}</span>
                   </div>
                   {images.length > 0 && (
                     <div className="flex items-center space-x-1">
                       <Image className="w-4 h-4" />
                       <span>{images.length} photos</span>
                     </div>
                   )}
                   
                   {/* Per-moment selection controls */}
                   {images.length > 0 && (
                     <div className="flex items-center space-x-3">
                       {/* Select all button - only visible when checkboxes are shown AND not all are selected */}
                       {selectionMode && !allSelectedInMoment && (
                         <button
                           onClick={() => onSelectAllInMoment(moment.momentID)}
                           className={`w-8 h-8 rounded transition-colors flex items-center justify-center ${
                             selectedInMoment.length > 0 
                               ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                               : 'hover:bg-gray-100 text-gray-700'
                           }`}
                           title="Select all"
                         >
                           <CheckCheck className="w-4 h-4" />
                         </button>
                       )}
                       
                       {/* Clear button - always visible when any images are selected */}
                       {selectedInMoment.length > 0 && (
                         <button
                           onClick={() => onClearMomentSelection(moment.momentID)}
                           className="w-8 h-8 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors flex items-center justify-center"
                           title="Clear selection"
                         >
                           <X className="w-4 h-4" />
                         </button>
                       )}
                     </div>
                   )}
                   
                   {selectedInMoment.length > 0 && (
                     <span className="text-primary-600 font-medium">
                       • {selectedInMoment.length} selected
                     </span>
                   )}
                 </div>
                {moment.description && (
                  <p className="text-gray-600 mt-2">{moment.description}</p>
                )}
              </div>
            </div>
          </div>
          <div className="p-6">
            <motion.div
              className={`w-full ${viewMode === 'grid' ? 'photo-gallery-grid' : 'space-y-4 max-w-3xl mx-auto block'}`}
              style={viewMode === 'grid' ? {
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(100, 266 * imageSize)}px`
              } : {}}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {images.map((image, index) => {
                // Determine aspect ratio class for masonry layout
                let aspectRatioClass = 'square';
                if (image.width && image.height) {
                  const ratio = image.width / image.height;
                  if (ratio > 1.2) aspectRatioClass = 'landscape';
                  else if (ratio < 0.8) aspectRatioClass = 'portrait';
                } else if (image.aspect_ratio) {
                  const ratio = image.aspect_ratio;
                  if (ratio > 1.2) aspectRatioClass = 'landscape';
                  else if (ratio < 0.8) aspectRatioClass = 'portrait';
                }
                
                return (
                  <motion.div
                    key={image.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className={`${viewMode === 'grid' ? `photo-card ${aspectRatioClass}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
                  >
                    {viewMode === 'grid' ? (
                      <SingleImageTile
                        image={image}
                        aspectClass={aspectRatioClass}
                        thumbSrc={image.urls?.thumbnail || `/${image.thumbFilename || image.id}.webp`}
                        selectionMode={selectionMode || viewMode === 'list'}
                        isSelected={globalSelection.has(`${moment.momentID}:${image.label}`)}
                        onToggleSelect={(e) => onImageSelect(image.label, moment.momentID, e)}
                        onOpen={() => onOpenImageViewer(images, image, index)}
                        isFavorite={isImageFavorite(image)}
                        onToggleFavorite={async () => { if (onToggleFavorites) await onToggleFavorites([image.id]); }}
                        isArchived={!!image.is_archived}
                        onToggleArchive={async (isRemove) => { if (onToggleArchive) await onToggleArchive([image.id], !!isRemove); }}
                        dateLabel={image.date_taken ? formatTimeOnly(image.date_taken) : ''}
                        showDate={!!image.date_taken}
                      />
                    ) : (
                      <SingleImageRow
                        image={image}
                        thumbSrc={image.urls?.thumbnail || `/${image.thumbFilename || image.id}.webp`}
                        isSelected={globalSelection.has(`${moment.momentID}:${image.label}`)}
                        onToggleSelect={(e) => onImageSelect(image.label, moment.momentID, e)}
                        onOpen={() => onOpenImageViewer(images, image, index)}
                      />
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
});

export default MomentCard;
