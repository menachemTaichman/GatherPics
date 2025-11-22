import { motion } from 'framer-motion';
import { forwardRef, useEffect, useState, useRef, useCallback } from 'react';
import { Image, Clock, Calendar, CheckCheck, X, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SingleImageTile } from '../images';
import { useToast } from '../../contexts/ToastContext';
import { useApplyScopes } from '../../utils/storeUtils';
import { useDataStore } from '../../utils/dataManager';
import { momentsAPI } from '../../utils/apiService';
import { ImageComponent } from '../../hooks/useImage.jsx';

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
  totalImageCount,
  imageSize,
  globalSelection,
  onImageSelect,
  onOpenImageViewer,
  selectionMode,
  onSelectAllInMoment,
  onClearMomentSelection,
  eventUrl,
  urlHelpers,
  includeArchived,
  highlightedIds,
  registerImageRef
}, ref) => {
  // Note: Individual moment scopes are managed by TimelineManager for UI observation optimization
  // Data loading is handled by 'all:moments' scope from the parent Moments component
  
  const { showToast } = useToast();
  
  // State for image aspect ratio classes (same approach as GroupDetail)
  const [imageClasses, setImageClasses] = useState({});
  const pendingClassUpdatesRef = useRef({});
  const flushClassesRafRef = useRef(null);
  
  // Refs for arrow key navigation
  const imageTileRefs = useRef([]);
  
  // Update refs array when images change
  useEffect(() => {
    imageTileRefs.current = imageTileRefs.current.slice(0, images.length);
  }, [images.length]);

  // Handle arrow key navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Arrow key navigation for images
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const currentElement = document.activeElement;
        const currentIndex = imageTileRefs.current.findIndex(ref => ref === currentElement);
        
        if (currentIndex === -1) return;
        
        // Calculate grid dimensions (approximate based on viewport)
        const gridContainer = currentElement.closest('.photo-gallery-grid');
        if (!gridContainer) return;
        
        const containerRect = gridContainer.getBoundingClientRect();
        const itemRect = currentElement.getBoundingClientRect();
        
        // Estimate columns based on container width and item width
        const itemWidth = itemRect.width;
        const containerWidth = containerRect.width;
        const estimatedCols = Math.floor(containerWidth / itemWidth) || 1;
        
        let nextIndex = currentIndex;
        
        switch (event.key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, images.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + estimatedCols, images.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - estimatedCols, 0);
            break;
        }
        
        if (nextIndex !== currentIndex && imageTileRefs.current[nextIndex]) {
          event.preventDefault();
          imageTileRefs.current[nextIndex].focus();
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [images.length]);
  
  // Note: Individual moment data (including images) is loaded on-demand by TimelineManager
  // when moments become visible. The 'all:moments' scope only loads moment summaries.
  // Calculate selection stats for this moment
  const momentimageKeys = images.map(image => `${moment.id}:${image.id}`);
  const selectedInMoment = momentimageKeys.filter(key => globalSelection.has(key));
  const allSelectedInMoment = images.length > 0 && selectedInMoment.length === images.length;
  const someSelectedInMoment = selectedInMoment.length > 0 && selectedInMoment.length < images.length;

  // Handle image load to determine aspect ratio (same approach as GroupDetail)
  const handleImageLoad = useCallback((imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    // Skip if unchanged to avoid extra renders
    const current = imageClasses[imageId];
    if (current === imageClass) return;

    // Batch updates per frame to coalesce N image onLoad events
    pendingClassUpdatesRef.current[imageId] = imageClass;
    if (!flushClassesRafRef.current) {
      try {
        flushClassesRafRef.current = requestAnimationFrame(() => {
          const updates = pendingClassUpdatesRef.current;
          pendingClassUpdatesRef.current = {};
          flushClassesRafRef.current = null;
          setImageClasses(prev => {
            let changed = false;
            const next = { ...prev };
            for (const id in updates) {
              if (Object.prototype.hasOwnProperty.call(updates, id)) {
                if (prev[id] !== updates[id]) {
                  next[id] = updates[id];
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        });
      } catch {
        // Fallback if RAF fails
        pendingClassUpdatesRef.current = {};
        flushClassesRafRef.current = null;
        setImageClasses(prev => ({ ...prev, [imageId]: imageClass }));
      }
    }
  }, [imageClasses]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 }}
      className="relative flex"
    >
      <div className="flex-1">
        <motion.div
          ref={ref}
          data-moment-key={moment.label}
          data-moment-id={moment.id}
          className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow duration-300"
          whileHover={{ y: -2 }}
        >
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start space-x-4">
              {/* Representative Image */}
              <div className="flex-shrink-0">
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 shadow-md">
                  {ImageComponent(
                    urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('moments', moment.id)}?v=${moment.representative_image || 'none'}` : null,
                    {
                      width: 64,
                      height: 64,
                      className: 'w-full h-full object-cover',
                      alt: moment.label
                    }
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold text-gray-900">{moment.label}</h3>
                </div>
                                 <div className="flex items-center space-x-4 text-sm text-gray-500 h-8">
                   <div className="flex items-center space-x-1">
                     <Clock className="w-4 h-4" />
                     <span>{formatTimeOnly(moment.start_date)} - {formatTimeOnly(moment.end_date)}</span>
                   </div>
                   <div className="flex items-center space-x-1">
                     <Calendar className="w-4 h-4" />
                     <span>{formatDate(moment.start_date)}</span>
                   </div>
                   {(() => {
                     const photoCount = includeArchived ? moment.images_count : moment.active_images_count;
                     return photoCount > 0 && (
                       <div className="flex items-center space-x-1">
                         <Image className="w-4 h-4" />
                         <span>{photoCount} photos</span>
                       </div>
                     );
                   })()}
                   
                   {/* Per-moment selection controls */}
                   {images.length > 0 && (
                     <div className="flex items-center space-x-3">
                       {/* Select all button - only visible when checkboxes are shown AND not all are selected */}
                       {selectionMode && !allSelectedInMoment && (
                         <button
                           onClick={() => onSelectAllInMoment(moment.id)}
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
                           onClick={() => onClearMomentSelection(moment.id)}
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
              className="w-full photo-gallery-grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize)}px, 1fr))`,
                gridAutoRows: `${Math.max(100, 266 * imageSize)}px`
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {images.map((image, index) => {
                return (
                <motion.div
                  key={image.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className={`photo-card ${imageClasses[image.id] || 'square'}`}
                  >
                    <SingleImageTile
                      ref={(el) => {
                        registerImageRef?.(image.id, el);
                        // Store ref for arrow key navigation
                        if (el && imageTileRefs.current[index] !== el) {
                          imageTileRefs.current[index] = el;
                        }
                      }}
                      image={image}
                      aspectClass={imageClasses[image.id] || 'square'}
                      thumbSrc={image.isPlaceholder ? null : (urlHelpers ? urlHelpers.getThumbnailUrl(image.id) : null)}
                      selectionMode={selectionMode}
                      isSelected={globalSelection.has(`${moment.id}:${image.id}`)}
                      onToggleSelect={(e) => onImageSelect(image.id, moment.id, e)}
                      onOpen={() => onOpenImageViewer(images, image, index)}
                      onImageLoad={(e) => handleImageLoad(image.id, e)}
                      eventUrl={eventUrl}
                      urlHelpers={urlHelpers}
                      isHighlighted={highlightedIds?.has(image.id)}
                      photoIndex={index}
                      contextType="Moment"
                      contextLabel={moment?.label || moment?.name}
                    />
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



