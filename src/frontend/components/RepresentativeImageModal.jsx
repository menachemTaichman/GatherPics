import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../utils/useModalFocus';

function formatDateTime(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

export default function RepresentativeImageModal({ 
  isOpen, 
  onClose, 
  moment, 
  momentImagesMap, 
  onImageSelect 
}) {
  // Use modal focus hook with higher z-index
  const { modalRef } = useModalFocus(isOpen, onClose, {
    allowOutsideScroll: true
  });

  if (!isOpen || !moment) return null;

  const images = momentImagesMap[moment.momentID] || [];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80]">
        <motion.div 
          ref={modalRef}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[80vh] overflow-hidden flex flex-col"
          tabIndex={-1}
        >
          <div className="p-4 border-b">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold">Select Representative Photo</h4>
              <div className="flex space-x-2">
                {moment.representative_image && (
                  <button
                    onClick={() => {
                      onImageSelect('');
                      onClose();
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded transition-colors"
                  >
                    Remove Photo
                  </button>
                )}
                <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {images.map((img, index) => (
                <div
                  key={img.id || img.name || `image-${index}`}
                  onClick={() => {
                    onImageSelect(img.id);
                    onClose();
                  }}
                  className="cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors relative group"
                >
                  <img
                    src={img.urls.thumbnail}
                    alt={img.name}
                    className="w-full h-24 object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                    }}
                  />
                  <div className="p-2 text-xs text-gray-600 truncate">
                    {img.date_taken ? formatDateTime(img.date_taken) : img.name}
                  </div>
                  {(moment.representative_image === img.id || 
                    (moment.representative_image && moment.representative_image.includes && moment.representative_image.includes(`/${img.id}.webp`))) && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-1 py-0.5 rounded">
                      Current
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
