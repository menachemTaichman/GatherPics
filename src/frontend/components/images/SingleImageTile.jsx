import React, { forwardRef, useState, useEffect, memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useImageActions from './ImageActions';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { PermissionGate, LongPressHoverButton } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { generateImageAltText } from '../../utils/accessibility';
import { formatTime } from '../../utils/dateUtils';
import { useRTL } from '../../hooks/useRTL';
import { usePreference } from '../../hooks/useSettings';

const SingleImageTile = forwardRef(function SingleImageTile({
  image,
  aspectClass = 'square',
  thumbSrc,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onOpen,
  onImageLoad,
  onImageError,
  dateLabel, // Optional override for date label
  showDate = true, // Show date by default if available
  showCropBadge = false,
  imageFit = 'cover',
  placeholderDataUrl = null, // Use universal placeholder components instead
  eventUrl, // Required for useImageActions
  urlHelpers, // Required for useImageActions
  isHighlighted = false, // New prop for highlighting
  showFavoriteButton = true, // Control favorite button visibility
  showArchiveButton = true, // Control archive button visibility
  showCheckbox = true, // Control checkbox visibility
  showRepresentativeButton = false, // Control representative star button visibility
  isRepresentative = false, // Whether this is the current representative
  onSetRepresentative = null, // Callback to set as representative
  altText = null, // Optional alt text override (format: "Photo #{idx} in {context}{: description}")
  photoIndex = null, // Photo index for alt text generation
  contextType = null, // Context type for alt text (Person, Moment, Album, Upload, etc.)
  contextLabel = null, // Label for the context (e.g., group name, album name, etc.)
  onLongPressSelect = null, // Deprecated: Callback for long press on checkbox to start swipe selection
  startDrag = null // New: Direct start drag function from grid (simpler approach)
}, ref) {
  // Use the centralized ImageActions hook
  const imageActions = useImageActions({
    imageIds: image?.id,
    eventUrl,
    urlHelpers,
    placeholderDataUrl,
    onImageUpdated: () => {}, // Store handles updates automatically
    onAlbumAdded: () => {}
  });

  // Use the state from the hook
  const { isFavorite, isArchived, toggleFavorite, toggleArchive } = imageActions;
  
  // Get permissions
  const permissions = usePermissions();
  
  // RTL support
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  
  // Get zoom level and preference for hiding timestamps
  const imageSize = usePreference('general.size', 1.0);
  const hideTimestampsInGallery = usePreference('general.hideTimestampsInGallery', false);
  
  // Detect mobile vs desktop
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Determine if timestamp should be hidden based on zoom level
  // Mobile: hide below 42% (0.42), Desktop: hide below 51% (0.51)
  // If hideTimestampsInGallery is true, always hide (only affects above thresholds)
  const shouldHideTimestamp = hideTimestampsInGallery || 
    (isMobile ? imageSize <= 0.42 : imageSize <= 0.51);
  
  // Apply highlight styles - use class for shimmer effect
  const highlightClassName = isHighlighted ? 'image-highlight-shimmer' : '';
  
  // Generate alt text if not provided
  const generatedAltText = altText || (() => {
    if (photoIndex !== null && contextType) {
      const generated = generateImageAltText({
        photoIndex,
        contextType,
        contextLabel,
        description: image?.description
      });
      if (generated) return generated;
    }
    return image?.label || image?.id || 'Photo';
  })();
  
  // Handle keyboard events for accessibility
  const handleKeyDown = (e) => {
    // Allow checkbox to handle its own keyboard events
    if (e.target.closest('input[type="checkbox"]')) {
      return;
    }
    
    // Enter or Space to open image viewer
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen && onOpen();
    }
  };

  // Long press handler for checkbox to start swipe selection
  const longPressTimeoutRef = useRef(null);
  const isDraggingRef = useRef(false);

  const handleCheckboxTouchStart = (e) => {
    // Use startDrag if available (new simpler approach), otherwise fallback to onLongPressSelect
    const dragHandler = startDrag || (onLongPressSelect ? () => onLongPressSelect(image.id, true) : null);
    
    if (!dragHandler || e.touches.length > 1) return;
    
    // מונע התערבות של אירועי עכבר נוספים
    e.stopPropagation();
    
    isDraggingRef.current = false;
    longPressTimeoutRef.current = setTimeout(() => {
      if (!isDraggingRef.current) {
        // רטט קטן למשתמש כדי שיבין שנכנס למצב בחירה
        if (navigator.vibrate) navigator.vibrate(50);
        
        // התחלת swipe selection - הגריד יקבל פיקוד מכאן
        dragHandler();
      }
      longPressTimeoutRef.current = null;
    }, 500); // 500ms לחיצה ארוכה
  };

  const handleCheckboxTouchMove = (e) => {
    // אם האצבע זזה יותר מדי, זה לא long press
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    isDraggingRef.current = true;
  };

  const handleCheckboxTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    isDraggingRef.current = false;
  };
  
  return (
    <div 
      ref={ref}
      className={`relative group cursor-pointer h-full photo-card ${aspectClass} ${highlightClassName} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:border-4 focus-visible:border-primary-500 focus-visible:z-20`}
      onClick={(e) => {
        if (!e.target.closest('input[type="checkbox"]')) {
          onOpen && onOpen();
        }
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`View ${generatedAltText}`}
    >
      {showCheckbox && (
        <input
          type="checkbox"
          id={`image-checkbox-grid-${image.id}`}
          name={`image-checkbox-grid-${image.id}`}
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect && onToggleSelect(e);
          }}
          onTouchStart={handleCheckboxTouchStart}
          onTouchMove={handleCheckboxTouchMove}
          onTouchEnd={handleCheckboxTouchEnd}
          className={`absolute top-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
            isRTL ? 'right-2' : 'left-2'
          } ${
            selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      )}
      <div className="relative w-full h-full">
        {useImageComponent(thumbSrc, {
          width: 200,
          height: 200,
          className: `w-full h-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`,
          alt: generatedAltText,
          onLoad: onImageLoad,
          onError: onImageError
        })}

        {/* Action buttons - bottom-right in LTR, bottom-left in RTL */}
        {showArchiveButton && isArchived ? (
          <PermissionGate requires={["hasArchiveAlbum", "canEdit"]}>
            <button
              type="button"
              aria-pressed={isArchived}
              className={`absolute bottom-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 opacity-100 ${
                isRTL ? 'left-2' : 'right-2'
              }`}
              title={t('singleImageTile.removeFromArchive')}
              aria-label={t('singleImageTile.removeFromArchive')}
              onClick={(e) => {
                e.stopPropagation();
                toggleArchive();
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
          </PermissionGate>
        ) : (
          showFavoriteButton && (permissions.canEdit || isFavorite) && (
            <PermissionGate requires="hasFavoritesAlbum">
              <button
                type="button"
                aria-pressed={isFavorite}
                className={`absolute bottom-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                  isRTL ? 'left-2' : 'right-2'
                } ${
                  selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title={isFavorite ? t('singleImageTile.removeFromFavorites') : t('singleImageTile.addToFavorites')}
                aria-label={isFavorite ? t('singleImageTile.removeFromFavorites') : t('singleImageTile.addToFavorites')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite();
                }}
                disabled={!permissions.canEdit}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`w-5 h-5 ${isFavorite ? 'text-red-500' : 'text-white'}`}
                  fill={isFavorite ? 'currentColor' : 'none'}
                  stroke={isFavorite ? 'currentColor' : 'white'}
                  strokeWidth="2"
                  role="img"
                  focusable="false"
                  style={{ color: isFavorite ? '#ef4444' : '#ffffff' }}
                >
                  <title>Favorite</title>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </button>
            </PermissionGate>
          )
        )}

        {/* Heart icon appears second when image is archived */}
        {showFavoriteButton && showArchiveButton && isArchived && (permissions.canEdit || isFavorite) && (
          <PermissionGate requires="hasFavoritesAlbum">
            <button
              type="button"
              aria-pressed={isFavorite}
              className={`absolute bottom-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                isRTL ? 'left-10' : 'right-10'
              } ${
                selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              title={isFavorite ? t('singleImageTile.removeFromFavorites') : t('singleImageTile.addToFavorites')}
              aria-label={isFavorite ? t('singleImageTile.removeFromFavorites') : t('singleImageTile.addToFavorites')}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite();
              }}
              disabled={!permissions.canEdit}
            >
              <svg
                viewBox="0 0 24 24"
                className={`w-5 h-5 ${isFavorite ? 'text-red-500' : 'text-white'}`}
                fill={isFavorite ? 'currentColor' : 'none'}
                stroke={isFavorite ? 'currentColor' : 'white'}
                strokeWidth="2"
                role="img"
                focusable="false"
                style={{ color: isFavorite ? '#ef4444' : '#ffffff' }}
              >
                <title>Favorite</title>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Hover overlay - darkens image on hover */}
      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 pointer-events-none"></div>

      {/* Date overlay - bottom-left in LTR, bottom-right in RTL */}
      {showDate && (dateLabel || image?.date_taken) && !shouldHideTimestamp && (
        <div className={`absolute bottom-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 ${
          isRTL ? 'right-2' : 'left-2'
        }`}>
          {dateLabel || formatTime(image?.date_taken)}
        </div>
      )}

      {/* Crop indicator - top-right in LTR, top-left in RTL */}
      {showCropBadge && (
        <div className={`absolute top-2 bg-primary-600 text-white text-xs px-2 py-1 ${
          isRTL ? 'left-2' : 'right-2'
        }`}>
          {t('singleImageTile.crop')}
        </div>
      )}

      {/* Representative star button - positioned after heart and archive */}
      {showRepresentativeButton && (permissions.canEdit || isRepresentative) && (
        <LongPressHoverButton
          type="button"
          aria-pressed={isRepresentative}
          className={`absolute bottom-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
            (showArchiveButton && isArchived) || (showFavoriteButton && isFavorite)
              ? (isRTL ? 'left-20' : 'right-20') // Third position if archive or favorite is shown
              : (showArchiveButton || showFavoriteButton)
              ? (isRTL ? 'left-10' : 'right-10') // Second position if one button shown
              : (isRTL ? 'left-2' : 'right-2') // First position if no other buttons
          } ${
            isRepresentative ? 'opacity-100' : (selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }`}
          title={isRepresentative ? t('singleImageTile.currentRepresentative') : t('singleImageTile.setAsRepresentative')}
          aria-label={isRepresentative ? t('singleImageTile.currentRepresentative') : t('singleImageTile.setAsRepresentative')}
          onClick={(e) => {
            e.stopPropagation();
            onSetRepresentative && onSetRepresentative();
          }}
          disabled={!permissions.canEdit}
        >
          <svg
            viewBox="0 0 24 24"
            className={`w-5 h-5 ${isRepresentative ? 'text-orange-500' : 'text-white'}`}
            fill={isRepresentative ? 'currentColor' : 'none'}
            stroke={isRepresentative ? 'currentColor' : 'white'}
            strokeWidth="2"
            role="img"
            focusable="false"
            style={{ color: isRepresentative ? '#f97316' : '#ffffff' }}
          >
            <title>Representative</title>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </LongPressHoverButton>
      )}
    </div>
  );
});

// Memoize the component to prevent unnecessary re-renders
// Only re-render if props actually change
// Returns true if props are equal (skip re-render), false if different (re-render)
// Note: imageSize and hideTimestampsInGallery are accessed via hooks inside the component,
// so they don't need to be in the comparison - React will re-render when hooks change
const MemoizedSingleImageTile = memo(SingleImageTile, (prevProps, nextProps) => {
  // Compare all relevant props that affect rendering
  // Note: urlHelpers and onToggleSelect/onOpen/onImageLoad are function references
  // that may change but we compare by their effect (image id, selection state, etc.)
  const propsEqual = (
    prevProps.image?.id === nextProps.image?.id &&
    prevProps.aspectClass === nextProps.aspectClass &&
    prevProps.thumbSrc === nextProps.thumbSrc &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.showFavoriteButton === nextProps.showFavoriteButton &&
    prevProps.showArchiveButton === nextProps.showArchiveButton &&
    prevProps.showCheckbox === nextProps.showCheckbox &&
    prevProps.showRepresentativeButton === nextProps.showRepresentativeButton &&
    prevProps.isRepresentative === nextProps.isRepresentative &&
    prevProps.imageFit === nextProps.imageFit &&
    prevProps.eventUrl === nextProps.eventUrl &&
    prevProps.photoIndex === nextProps.photoIndex &&
    prevProps.contextType === nextProps.contextType &&
    prevProps.contextLabel === nextProps.contextLabel
  );
  
  // Return true if props are equal (skip re-render), false if different (re-render)
  return propsEqual;
});

export default MemoizedSingleImageTile;



