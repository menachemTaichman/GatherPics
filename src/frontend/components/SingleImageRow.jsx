import React from 'react';

export default function SingleImageRow({
  image,
  thumbSrc,
  isSelected = false,
  onToggleSelect,
  onOpen,
  rightContent,
  placeholderDataUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>'
}) {
  return (
    <div className="flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full">
      <input
        type="checkbox"
        id={`image-row-checkbox-${image.id}`}
        name={`image-row-checkbox-${image.id}`}
        checked={isSelected}
        onChange={() => {}}
        onClick={(e) => {
          onToggleSelect && onToggleSelect(e);
        }}
        className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
      />
      <div className="relative">
        <img
          src={thumbSrc || placeholderDataUrl}
          alt={image.label || image.id}
          className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
          loading="lazy"
          onClick={(e) => {
            if (!e.target.closest('input[type="checkbox"]')) {
              onOpen && onOpen();
            }
          }}
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = placeholderDataUrl;
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{image.label}</p>
        <p className="text-sm text-gray-500 truncate">{image.date_taken || 'Unknown date'}</p>
      </div>
      {rightContent}
    </div>
  );
}


