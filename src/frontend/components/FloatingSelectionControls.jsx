import { Link } from 'react-router-dom';
import { 
  CheckCheck, 
  X, 
  ShoppingBag, 
  Heart as HeartIcon, 
  Archive, 
  Users,
  Trash2,
  Move
} from 'lucide-react';
import AlbumQuickAddButton from './AlbumQuickAddButton';
import { albumsAPI } from '../utils/apiService';

export default function FloatingSelectionControls({
  selectedCount,
  totalCount,
  selectedImages,
  onSelectAll,
  onClearSelection,
  onAddToBucket,
  onToggleFavorites,
  onMoveToArchive,
  onTransferFaces,
  onRemoveFromMoment,
  onMoveToMoment,
  eventUrl,
  showToast,
  urlHelpers,
  placeholderDataUrl,
  showTransferFaces = false,
  showRemoveFromMoment = false,
  showMoveToMoment = false,
  showArchive = true,
  showFavorites = true,
  showBucket = true,
  showAlbum = true,
  selectionMode = false
}) {
  if (!selectionMode && selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-full px-4 py-2 flex items-center space-x-3 z-40">
      <span className="text-sm text-gray-700">{selectedCount} selected</span>
      
      {/* Select all button - only visible when not all are selected */}
      {selectedCount < totalCount && (
        <button
          onClick={onSelectAll}
          className={`w-8 h-8 rounded-md transition-colors flex items-center justify-center ${
            selectedCount > 0 
              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
              : 'hover:bg-gray-100 text-gray-700'
          }`}
          title="Select all photos (Ctrl+A)"
        >
          <CheckCheck className="w-4 h-4" />
        </button>
      )}
      
      {/* Clear selection - only show when there are selected items */}
      {selectedCount > 0 && (
        <button
          onClick={onClearSelection}
          className="w-8 h-8 rounded-md bg-red-100 text-red-700 hover:bg-red-200 flex items-center justify-center"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      
      {/* Action buttons - only show when images are selected */}
      {selectedCount > 0 && (
        <>
          {/* Transfer faces - only for group detail */}
          {showTransferFaces && (
            <button
              onClick={onTransferFaces}
              className="w-8 h-8 rounded-md hover:bg-orange-100 text-orange-700 flex items-center justify-center"
              title="Change group for selected faces"
            >
              <Users className="w-4 h-4" />
            </button>
          )}
          
          {/* Remove from moment - only for moments */}
          {showRemoveFromMoment && (
            <button
              onClick={onRemoveFromMoment}
              className="w-8 h-8 rounded-md hover:bg-red-100 text-red-700 flex items-center justify-center"
              title="Remove selected photos from moment"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          
          {/* Move to moment - only for moments */}
          {showMoveToMoment && (
            <button
              onClick={onMoveToMoment}
              className="w-8 h-8 rounded-md hover:bg-blue-100 text-blue-700 flex items-center justify-center"
              title="Move selected photos to another moment"
            >
              <Move className="w-4 h-4" />
            </button>
          )}
          
          {/* Add to Album */}
          {showAlbum && (
            <AlbumQuickAddButton 
              selectedImages={Array.from(selectedImages)} 
              eventUrl={eventUrl}
              showToast={showToast}
              urlHelpers={urlHelpers}
              placeholderDataUrl={placeholderDataUrl}
              dropdownDirection="up"
            />
          )}
          
          {/* Add to Favorites */}
          {showFavorites && (
            <button
              onClick={onToggleFavorites}
              className="w-8 h-8 rounded-md hover:bg-red-50 text-red-600 flex items-center justify-center"
              title="Add selected to favorites"
            >
              <HeartIcon className="w-4 h-4" />
            </button>
          )}
          
          {/* Move to Archive */}
          {showArchive && (
            <button
              onClick={onMoveToArchive}
              className="w-8 h-8 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center"
              title="Move selected to archive"
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
          
          {/* Add to Bucket */}
          {showBucket && (
            <button
              onClick={onAddToBucket}
              className="w-8 h-8 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center"
              title="Add selected photos to bucket"
            >
              <ShoppingBag className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
