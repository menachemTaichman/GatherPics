import { motion } from 'framer-motion';
import { Image, Clock, Calendar, Grid, List } from 'lucide-react';

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

export default function MomentCard({
  moment,
  photos,
  viewMode,
  photoSize,
  globalSelection,
  onPhotoSelect,
  onOpenPhotoViewer
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 }}
      className="relative flex"
    >
      <div className="relative flex-shrink-0">
        <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full border-4 border-white shadow-lg z-10 mt-6"></div>
      </div>
      <div className="flex-1 pl-6">
        <motion.div
          className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow duration-300"
          whileHover={{ y: -2 }}
        >
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg overflow-hidden flex items-center justify-center">
                  {moment.representative_photo ? (
                    <img
                      src={moment.representative_photo}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Image className="w-8 h-8 text-white" />
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-bold text-gray-900 mb-1">{moment.label}</h3>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <div className="flex items-center space-x-1">
                    <Clock className="w-4 h-4" />
                    <span>{formatTimeOnly(moment.start)} - {formatTimeOnly(moment.end)}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(moment.start)}</span>
                  </div>
                </div>
                {moment.description && (
                  <p className="text-gray-600 mt-2">{moment.description}</p>
                )}
              </div>
            </div>
          </div>
          <div className="p-6">
            <div
              className={viewMode === 'grid' ? `photo-gallery-grid size-${Math.round(photoSize * 100).toString().padStart(3, '0')}` : "space-y-4 max-w-3xl mx-auto block"}
            >
              {photos.map((photo, index) => {
                // Determine aspect ratio class for masonry layout
                let aspectRatioClass = 'square';
                if (photo.aspect_ratio) {
                  const ratio = photo.aspect_ratio;
                  if (ratio > 1.2) aspectRatioClass = 'landscape';
                  else if (ratio < 0.8) aspectRatioClass = 'portrait';
                }
                
                return (
                  <div
                    key={photo.id}
                    className={viewMode === 'grid' ? `photo-card ${aspectRatioClass}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}
                  >
                    <div className="relative group cursor-pointer h-full" onClick={() => onOpenPhotoViewer(photos, photo, index)}>
                      <input
                        type="checkbox"
                        id={`photo-checkbox-${moment.momentID}-${photo.name}`}
                        name={`photo-checkbox-${moment.momentID}-${photo.name}`}
                        checked={globalSelection.has(`${moment.momentID}:${photo.name}`)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onPhotoSelect(photo.name, moment.momentID);
                        }}
                        onClick={e => e.stopPropagation()}
                        className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
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
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
