import { motion } from 'framer-motion';
import { forwardRef, useEffect, useState, useRef, useCallback } from 'react';
import { Image, Clock, Calendar, CheckCheck, X, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SingleImageTile } from '../images';
import AbsoluteMasonryGrid from '../images/AbsoluteMasonryGrid';
import { useToast } from '../../contexts/ToastContext';
import { useApplyScopes } from '../../utils/storeUtils';
import { useDataStore } from '../../utils/dataManager';
import { momentsAPI } from '../../utils/apiService';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { formatTime as formatTimeOnly, formatDate } from '../../utils/dateUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';

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
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  
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
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="flex-1">
        <motion.div
          ref={ref}
          data-moment-key={moment.label}
          data-moment-id={moment.id}
          className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow duration-300"
          whileHover={{ y: -2 }}
        >
          <div className="p-3 sm:p-4 md:p-6 border-b border-gray-100">
            <div className="flex items-start gap-2 sm:gap-3 md:gap-4">
              {/* Representative Image */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg overflow-hidden border border-gray-200 shadow-md">
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
                <div className="flex items-center justify-between mb-1 sm:mb-2">
                  <h3 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 truncate">{moment.label}</h3>
                </div>
                                 <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-4 text-xs sm:text-sm text-gray-500 min-h-[2rem] sm:min-h-[2.5rem]">
                   <div className="flex items-center gap-1">
                     <Clock className="w-4 h-4" />
                     <span>{formatTimeOnly(moment.start_date)} - {formatTimeOnly(moment.end_date)}</span>
                   </div>
                   <div className="flex items-center gap-1">
                     <Calendar className="w-4 h-4" />
                     <span>{formatDate(moment.start_date)}</span>
                   </div>
                   {(() => {
                     const photoCount = includeArchived ? moment.images_count : moment.active_images_count;
                     return photoCount > 0 && (
                       <div className="flex items-center gap-1">
                         <Image className="w-4 h-4" />
                         <span>{photoCount} {t('moments.photos')}</span>
                       </div>
                     );
                   })()}
                   
                   {/* Per-moment selection controls */}
                   {images.length > 0 && (
                     <div className="flex items-center gap-2 sm:gap-3">
                       {/* Select all button - only visible when checkboxes are shown AND not all are selected */}
                       {selectionMode && !allSelectedInMoment && (
                         <button
                           onClick={() => onSelectAllInMoment(moment.id)}
                           className={`w-7 h-7 sm:w-8 sm:h-8 rounded transition-colors flex items-center justify-center ${
                             selectedInMoment.length > 0 
                               ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                               : 'hover:bg-gray-100 text-gray-700'
                           }`}
                           title={t('moments.selectAll')}
                           aria-label={t('moments.selectAll')}
                         >
                           <CheckCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                         </button>
                       )}
                       
                       {/* Clear button - always visible when any images are selected */}
                       {selectedInMoment.length > 0 && (
                         <button
                           onClick={() => onClearMomentSelection(moment.id)}
                           className="w-7 h-7 sm:w-8 sm:h-8 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors flex items-center justify-center"
                           title={t('moments.clearSelection')}
                           aria-label={t('moments.clearSelection')}
                         >
                           <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                         </button>
                       )}
                     </div>
                   )}
                   
                   {selectedInMoment.length > 0 && (
                     <span className="text-xs sm:text-sm text-primary-600 font-medium">
                       • {selectedInMoment.length} {t('moments.selected')}
                     </span>
                   )}
                 </div>
                {moment.description && (
                  <p className="text-sm sm:text-base text-gray-600 mt-1 sm:mt-2">{moment.description}</p>
                )}
              </div>
            </div>
          </div>
          <div className="p-3 sm:p-4 md:p-6">
            <AbsoluteMasonryGrid
              items={images}
              baseSize={Math.max(80, 266 * imageSize)}
              imageClasses={imageClasses}
              containerHeight="auto"
              className="w-full"
              style={{
                '--grid-scale': 1,
                '--grid-z-index': 1,
              }}
              onItemRef={(image, index, el) => {
                if (el) {
                  registerImageRef?.(image.id, el);
                  // Store ref for arrow key navigation
                  if (imageTileRefs.current[index] !== el) {
                    imageTileRefs.current[index] = el;
                  }
                }
              }}
              renderItem={(image, index, isPortrait, setRef) => {
                return (
                  <div
                    className={`photo-card ${imageClasses[image.id] || 'square'}`}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <SingleImageTile
                      ref={setRef}
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
                  </div>
                );
              }}
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
});

export default MomentCard;



