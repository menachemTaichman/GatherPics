import React, { forwardRef } from 'react';
import useImageActions from './ImageActions';
import { useImageComponent } from '../utils/useImage.jsx';
import PermissionGate from './PermissionGate';
import { usePermissions } from '../utils/usePermissions';

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
  dateLabel,
  showDate = false,
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
  onSetRepresentative = null // Callback to set as representative
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
  
  // Apply highlight styles
  const highlightStyle = isHighlighted ? {
    animation: 'pulse-glow 1.5s ease-in-out infinite',
    border: '3px solid rgb(34, 197, 94)',
    borderRadius: '0.5rem'
  } : {};
  
  return (
    <div 
      ref={ref}
      className={`relative group cursor-pointer h-full photo-card ${aspectClass}`} 
      style={highlightStyle}
      onClick={(e) => {
        if (!e.target.closest('input[type="checkbox"]')) {
          onOpen && onOpen();
        }
      }}
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
          className={`absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500 transition-opacity ${
            selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      )}
      <div className="relative w-full h-full">
        {useImageComponent(thumbSrc, {
          width: 200,
          height: 200,
          className: `w-full h-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'} rounded-lg`,
          alt: image.label || image.id,
          onLoad: onImageLoad,
          onError: onImageError
        })}

        {/* Action buttons - bottom-left */}
        {showArchiveButton && isArchived ? (
          <PermissionGate requires={["hasArchiveAlbum", "canEdit"]}>
            <button
              type="button"
              aria-label="Remove from archive"
              aria-pressed={isArchived}
              className="absolute bottom-2 left-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 opacity-100"
              title="Remove from Archive"
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
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={isFavorite}
                className={`absolute bottom-2 left-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                  selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
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
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
              className={`absolute bottom-2 left-10 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
                selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
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

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
          <svg viewBox="0 0 24 24" className="w-8 h-8 mx-auto mb-1" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          <span className="text-sm">Click to view</span>
        </div>
      </div>

      {/* Date overlay */}
      {showDate && dateLabel && (
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
          {dateLabel}
        </div>
      )}

      {/* Crop indicator */}
      {showCropBadge && (
        <div className="absolute top-2 right-2 bg-primary-600 text-white text-xs px-2 py-1 rounded">
          Crop
        </div>
      )}

      {/* Representative star button - positioned after heart and archive */}
      {showRepresentativeButton && (permissions.canEdit || isRepresentative) && (
        <button
          type="button"
          aria-label={isRepresentative ? 'Current representative' : 'Set as representative'}
          aria-pressed={isRepresentative}
          className={`absolute bottom-2 z-10 transition-opacity bg-transparent p-0 appearance-none border-0 focus:outline-none focus:ring-0 ${
            (showArchiveButton && isArchived) || (showFavoriteButton && isFavorite)
              ? 'left-20' // Third position if archive or favorite is shown
              : (showArchiveButton || showFavoriteButton)
              ? 'left-10' // Second position if one button shown
              : 'left-2' // First position if no other buttons
          } ${
            isRepresentative ? 'opacity-100' : (selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }`}
          title={isRepresentative ? 'Current representative' : 'Set as representative'}
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
        </button>
      )}
    </div>
  );
});

export default SingleImageTile;
