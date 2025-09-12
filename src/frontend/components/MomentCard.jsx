import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { Image, Clock, Calendar, Grid, List, CheckCheck, X, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { albumsAPI } from '../utils/apiService';

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
  eventUrl,
  includeArchived
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
                      <div className="relative group cursor-pointer h-full" onClick={() => onOpenImageViewer(images, image, index)}>
                                                                                                                                                                                                       <input
                             type="checkbox"
                             id={`image-checkbox-${moment.momentID}-${image.label}`}
                             name={`image-checkbox-${moment.momentID}-${image.label}`}
                             checked={globalSelection.has(`${moment.momentID}:${image.label}`)}
                             onChange={() => {}} // Empty handler to satisfy React
                             onClick={(e) => {
                               e.stopPropagation();
                               onImageSelect(image.label, moment.momentID, e);
                             }}
                             className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                               selectionMode || viewMode === 'list' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                             }`}
                           />
                        <img
                          src={image.urls?.thumbnail || `/${image.thumbFilename || image.id}.webp`}
                          alt={`Photo ${index + 1}`}
                          className="w-full h-full object-cover rounded-lg"
                          loading="lazy"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                          }}
                        />
                         {/* Bottom-left icons: archive first, then heart */}
                         {image.is_archived ? (
                           <button
                             type="button"
                             aria-label="Remove from archive"
                             aria-pressed={image.is_archived}
                             className="absolute bottom-2 left-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 opacity-100"
                             title="Remove from Archive"
                             onClick={async (e) => {
                               e.stopPropagation();
                               if (onToggleArchive) {
                                 await onToggleArchive([image.id], true);
                               }
                             }}
                           >
                             <svg
                               viewBox="0 0 24 24"
                               className="w-5 h-5 text-white"
                               fill="none"
                               stroke="white"
                               strokeWidth="2"
                               role="img"
                               focusable="false"
                             >
                               <title>Archive</title>
                               <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"></path>
                             </svg>
                           </button>
                         ) : (
                           <button
                             type="button"
                             aria-label={isImageFavorite(image) ? 'Remove from favorites' : 'Add to favorites'}
                             aria-pressed={isImageFavorite(image)}
                             className={`absolute bottom-2 left-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                               selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                             }`}
                             title={isImageFavorite(image) ? 'Remove from Favorites' : 'Add to Favorites'}
                             onClick={async (e) => {
                               e.stopPropagation();
                               if (onToggleFavorites) {
                                 await onToggleFavorites([image.id]);
                               }
                             }}
                           >
                             <svg
                               viewBox="0 0 24 24"
                               className={`w-5 h-5 ${isImageFavorite(image) ? 'text-red-500' : 'text-white'}`}
                               fill={isImageFavorite(image) ? 'currentColor' : 'none'}
                               stroke={isImageFavorite(image) ? 'currentColor' : 'white'}
                               strokeWidth="2"
                               role="img"
                               focusable="false"
                               style={{ color: isImageFavorite(image) ? '#ef4444' : '#ffffff' }}
                             >
                               <title>Favorite</title>
                               <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                             </svg>
                           </button>
                         )}
                         
                         {/* Heart icon appears second when image is archived */}
                         {image.is_archived && (
                           <button
                             type="button"
                             aria-label={isImageFavorite(image) ? 'Remove from favorites' : 'Add to favorites'}
                             aria-pressed={isImageFavorite(image)}
                             className={`absolute bottom-2 left-10 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                               selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                             }`}
                             title={isImageFavorite(image) ? 'Remove from Favorites' : 'Add to Favorites'}
                             onClick={async (e) => {
                               e.stopPropagation();
                               if (onToggleFavorites) {
                                 await onToggleFavorites([image.id]);
                               }
                             }}
                           >
                             <svg
                               viewBox="0 0 24 24"
                               className={`w-5 h-5 ${isImageFavorite(image) ? 'text-red-500' : 'text-white'}`}
                               fill={isImageFavorite(image) ? 'currentColor' : 'none'}
                               stroke={isImageFavorite(image) ? 'currentColor' : 'white'}
                               strokeWidth="2"
                               role="img"
                               focusable="false"
                               style={{ color: isImageFavorite(image) ? '#ef4444' : '#ffffff' }}
                             >
                               <title>Favorite</title>
                               <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                             </svg>
                           </button>
                         )}
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                            <Image className="w-8 h-8 mx-auto mb-1" />
                            <span className="text-sm">Click to view photo</span>
                          </div>
                        </div>
                        {image.date_taken && (
                          <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                            {formatTimeOnly(image.date_taken)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                                                                                                                                                                                                       <input
                             type="checkbox"
                             id={`image-checkbox-list-${moment.momentID}-${image.label}`}
                             name={`image-checkbox-list-${moment.momentID}-${image.label}`}
                             checked={globalSelection.has(`${moment.momentID}:${image.label}`)}
                             onChange={() => {}} // Empty handler to satisfy React
                             onClick={(e) => {
                               onImageSelect(image.label, moment.momentID, e);
                             }}
                             className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                           />
                        <div className="relative">
                          <img
                            src={image.urls?.thumbnail || `/${image.thumbFilename || image.id}.webp`}
                            alt={`Photo ${index + 1}`}
                            className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                            loading="lazy"
                            onClick={() => onOpenImageViewer(images, image, index)}
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50\%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{image.label}</p>
                          <p className="text-sm text-gray-500">
                            {image.date_taken ? formatTimeOnly(image.date_taken) : 'Unknown date'}
                          </p>
                        </div>
                      </>
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
