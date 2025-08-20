import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { Image, Clock, Calendar, Grid, List, CheckCheck, X } from 'lucide-react';

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
  photos,
  viewMode,
  photoSize,
  globalSelection,
  onPhotoSelect,
  onOpenPhotoViewer,
  selectionMode,
  onSelectAllInMoment,
  onClearMomentSelection
}, ref) => {
  // Calculate selection stats for this moment
  const momentPhotoKeys = photos.map(photo => `${moment.momentID}:${photo.name}`);
  const selectedInMoment = momentPhotoKeys.filter(key => globalSelection.has(key));
  const allSelectedInMoment = photos.length > 0 && selectedInMoment.length === photos.length;
  const someSelectedInMoment = selectedInMoment.length > 0 && selectedInMoment.length < photos.length;

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
                   {photos.length > 0 && (
                     <div className="flex items-center space-x-1">
                       <Image className="w-4 h-4" />
                       <span>{photos.length} photos</span>
                     </div>
                   )}
                   
                   {/* Per-moment selection controls - moved after photos count with proper spacing */}
                   {photos.length > 0 && (
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
                       
                       {/* Clear button - always visible when any photos are selected, regardless of checkbox visibility */}
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
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * photoSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(100, 266 * photoSize)}px`
              } : {}}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {photos.map((photo, index) => {
                // Determine aspect ratio class for masonry layout
                let aspectRatioClass = 'square';
                if (photo.width && photo.height) {
                  const ratio = photo.width / photo.height;
                  if (ratio > 1.2) aspectRatioClass = 'landscape';
                  else if (ratio < 0.8) aspectRatioClass = 'portrait';
                } else if (photo.aspect_ratio) {
                  const ratio = photo.aspect_ratio;
                  if (ratio > 1.2) aspectRatioClass = 'landscape';
                  else if (ratio < 0.8) aspectRatioClass = 'portrait';
                }
                
                return (
                  <motion.div
                    key={photo.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className={`${viewMode === 'grid' ? `photo-card ${aspectRatioClass}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}`}
                  >
                    {viewMode === 'grid' ? (
                      <div className="relative group cursor-pointer h-full" onClick={() => onOpenPhotoViewer(photos, photo, index)}>
                                                                                                                                                                                                       <input
                             type="checkbox"
                             id={`photo-checkbox-${moment.momentID}-${photo.name}`}
                             name={`photo-checkbox-${moment.momentID}-${photo.name}`}
                             checked={globalSelection.has(`${moment.momentID}:${photo.name}`)}
                             onChange={() => {}} // Empty handler to satisfy React
                             onClick={(e) => {
                               e.stopPropagation();
                               onPhotoSelect(photo.name, moment.momentID, e);
                             }}
                             className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
                               selectionMode || viewMode === 'list' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                             }`}
                           />
                        <img
                          src={photo.urls?.thumbnail || `/${photo.thumbFilename || photo.id}.webp`}
                          alt={`Photo ${index + 1}`}
                          className="w-full h-full object-cover rounded-lg"
                          loading="lazy"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                          }}
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                            <Image className="w-8 h-8 mx-auto mb-1" />
                            <span className="text-sm">Click to view</span>
                          </div>
                        </div>
                        {photo.date_taken && (
                          <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                            {formatTimeOnly(photo.date_taken)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                                                                                                                                                                                                       <input
                             type="checkbox"
                             id={`photo-checkbox-list-${moment.momentID}-${photo.name}`}
                             name={`photo-checkbox-list-${moment.momentID}-${photo.name}`}
                             checked={globalSelection.has(`${moment.momentID}:${photo.name}`)}
                             onChange={() => {}} // Empty handler to satisfy React
                             onClick={(e) => {
                               onPhotoSelect(photo.name, moment.momentID, e);
                             }}
                             className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                           />
                        <div className="relative">
                          <img
                            src={photo.urls?.thumbnail || `/${photo.thumbFilename || photo.id}.webp`}
                            alt={`Photo ${index + 1}`}
                            className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                            loading="lazy"
                            onClick={() => onOpenPhotoViewer(photos, photo, index)}
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{photo.name}</p>
                          <p className="text-sm text-gray-500">
                            {photo.date_taken ? formatTimeOnly(photo.date_taken) : 'Unknown date'}
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
