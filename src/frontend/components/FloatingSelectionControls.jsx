import { Link } from 'react-router-dom';
import { 
  CheckCheck, 
  X, 
  ShoppingBag, 
  Heart as HeartIcon, 
  Users,
  Trash2,
  Clock,
  Star,
  Minus,
  Key
} from 'lucide-react';
import AlbumQuickAddButton from './AlbumQuickAddButton';
import useImageActions from './ImageActions';
import SelectFaceForRepModal from './SelectFaceForRepModal';
import ConfirmDelete from './ConfirmDelete';
import ManageAccessModal from './ManageAccessModal';
import { useDataStore } from '../utils/dataManager';
import { useState } from 'react';
import PermissionGate from './PermissionGate';
import { usePermissions } from '../utils/usePermissions';

export default function FloatingSelectionControls({
  selectedCount,
  totalCount,
  selectedImages,
  onSelectAll,
  onClearSelection,
  onTransferFaces,
  onRemoveFromMoment,
  onMoveToMoment,
  onRemoveFromAlbum,
  eventUrl,
  urlHelpers,
  placeholderDataUrl,
  showTransferFaces = false,
  showRemoveFromMoment = false,
  showMoveToMoment = false,
  showRemoveFromAlbum = false,
  showArchive = true,
  showFavorites = true,
  showBucket = true,
  showAlbum = true,
  selectionMode = false,
  entity = null,
  entityId = null
}) {  
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const permissions = usePermissions();

  // Use the centralized ImageActions hook for selected images
  const selectedImageActions = useImageActions({
    imageIds: Array.from(selectedImages),
    eventUrl,
    urlHelpers,
    placeholderDataUrl,
    onImageUpdated: () => {}, // Store handles updates automatically
    onAlbumAdded: () => {},
    entity,
    entityId
  });

  // Get state information for button styling
  const { allAreFavorited, allAreArchived, isFavorite, isArchived } = selectedImageActions;
  
  // For single image, use single state; for multiple, use all-are state
  const shouldShowFavorited = selectedCount === 1 ? isFavorite : allAreFavorited;
  const shouldShowArchived = selectedCount === 1 ? isArchived : allAreArchived;

  // Get entity label for modal
  const entityLabel = entity === 'group' 
    ? (useDataStore.getState().entities?.groups?.[entityId]?.label || 'person')
    : (useDataStore.getState().entities?.moments?.[entityId]?.label || 'moment');

  // Check if action buttons group has any visible buttons
  const hasActionButtons = (
    (showFavorites && permissions.canEdit && permissions.hasFavoritesAlbum) ||
    (showArchive && permissions.canEdit && permissions.hasArchiveAlbum) ||
    (showAlbum && permissions.canEdit) ||
    showBucket
  );

  // Check if management buttons group has any visible buttons
  const hasManagementButtons = (
    permissions.canUploadAndDeleteImages ||
    permissions.isProfilesManager
  );

  // Check if advanced buttons group has any visible buttons
  const hasAdvancedButtons = (
    (selectedImageActions.canSetRepresentative && permissions.canEdit) ||
    (showTransferFaces && permissions.canEdit) ||
    (showRemoveFromMoment && permissions.canEdit) ||
    (showMoveToMoment && permissions.canEdit) ||
    (showRemoveFromAlbum && permissions.canEdit)
  );

  if (!selectionMode && selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-full px-4 py-2 flex items-center space-x-3 z-30">
        <span className="text-sm text-gray-700">{selectedCount} selected</span>
      
      {/* Select all button - only visible when not all are selected */}
      {selectedCount < totalCount && (
        <>
          <span className="text-gray-300">|</span>
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
        </>
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
          {/* Separator before action buttons - only if there are visible action buttons */}
          {hasActionButtons && <span className="text-gray-300">|</span>}
          
          {/* Add to Favorites */}
          {showFavorites && (
            <PermissionGate requires={["canEdit", "hasFavoritesAlbum"]}>
              <button
                onClick={selectedImageActions.toggleFavorite}
                className={`w-8 h-8 rounded-md flex items-center justify-center ${
                  shouldShowFavorited 
                    ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                    : 'hover:bg-red-50 text-red-600'
                }`}
                title={shouldShowFavorited ? "Remove selected from favorites" : "Add selected to favorites"}
              >
                <HeartIcon className={`w-4 h-4 ${shouldShowFavorited ? 'fill-current' : ''}`} />
              </button>
            </PermissionGate>
          )}
          
          {/* Move to Archive */}
          {showArchive && (
            <PermissionGate requires={["canEdit", "hasArchiveAlbum"]}>
              <button
                onClick={selectedImageActions.toggleArchive}
                className={`w-8 h-8 rounded-md flex items-center justify-center ${
                  shouldShowArchived 
                    ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' 
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title={shouldShowArchived ? "Remove selected from archive" : "Move selected to archive"}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill={shouldShowArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
                </svg>
              </button>
            </PermissionGate>
          )}
          
          {/* Add to Album */}
          {showAlbum && (
            <PermissionGate requires="canEdit">
              <AlbumQuickAddButton 
                selectedImages={Array.from(selectedImages)} 
                eventUrl={eventUrl}
                urlHelpers={urlHelpers}
                placeholderDataUrl={placeholderDataUrl}
                dropdownDirection="up"
              />
            </PermissionGate>
          )}
          
          {/* Add to Bucket */}
          {showBucket && (
            <button
              onClick={selectedImageActions.toggleBucket}
              className={`w-8 h-8 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-700`}
              title={selectedImageActions.allInBucket ? "Remove selected from bucket" : "Add selected to bucket"}
            >
              <ShoppingBag className={`w-4 h-4 ${selectedImageActions.allInBucket ? 'fill-blue-400' : ''}`} />
            </button>
          )}

          {/* Separator before management buttons - only if action buttons exist AND management buttons exist */}
          {hasActionButtons && hasManagementButtons && <span className="text-gray-300">|</span>}

          {/* Delete Images */}
          <PermissionGate requires="canUploadAndDeleteImages">
            <button
              onClick={selectedImageActions.deleteImages}
              className="w-8 h-8 rounded-md hover:bg-red-100 flex items-center justify-center text-red-600"
              title="Delete selected photos"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </PermissionGate>

          {/* Manage Access */}
          <PermissionGate requires="isProfilesManager">
            <button
              onClick={() => setShowManageAccessModal(true)}
              className="w-8 h-8 rounded-md hover:bg-blue-100 flex items-center justify-center text-blue-600"
              title="Manage profile access"
            >
              <Key className="w-4 h-4" />
            </button>
          </PermissionGate>

          {/* Separator before advanced buttons - only if management buttons exist AND advanced buttons exist */}
          {hasManagementButtons && hasAdvancedButtons && <span className="text-gray-300">|</span>}

          {/* Set as representative - only for single image selection */}
          {selectedImageActions.canSetRepresentative && (
            <PermissionGate requires="canEdit">
              <button
                onClick={() => selectedImageActions.setRepresentative()}
                className={`w-8 h-8 rounded-md hover:bg-yellow-100 flex items-center justify-center ${
                  selectedImageActions.isRepresentative
                    ? 'text-orange-600'
                    : 'text-yellow-600'
                }`}
                title={selectedImageActions.representativeTooltip}
              >
                <Star className={`w-4 h-4 ${selectedImageActions.isRepresentative ? 'fill-current' : ''}`} />
              </button>
            </PermissionGate>
          )}

          {/* Transfer faces - only for group detail */}
          {showTransferFaces && (
            <PermissionGate requires="canEdit">
              <button
                onClick={onTransferFaces}
                className="w-8 h-8 rounded-md hover:bg-orange-100 text-orange-700 flex items-center justify-center"
                title="Transfer selected faces to different person"
              >
                <Users className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}
          
          {/* Remove from moment - only for moments */}
          {showRemoveFromMoment && (
            <PermissionGate requires="canEdit">
              <button
                onClick={onRemoveFromMoment}
                className="w-8 h-8 rounded-md hover:bg-red-100 text-red-700 flex items-center justify-center"
                title="Remove selected from moment"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}
          
          {/* Move to moment - only for moments */}
          {showMoveToMoment && (
            <PermissionGate requires="canEdit">
              <button
                onClick={onMoveToMoment}
                className="w-8 h-8 rounded-md hover:bg-blue-100 text-blue-700 flex items-center justify-center"
                title="Move or remove selected from moment"
              >
                <Clock className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}
          
          {/* Remove from album - only for custom albums */}
          {showRemoveFromAlbum && (
            <PermissionGate requires="canEdit">
              <button
                onClick={onRemoveFromAlbum}
                className="w-8 h-8 rounded-md hover:bg-red-100 text-red-700 flex items-center justify-center"
                title="Remove selected from album"
              >
                <Minus className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}
        </>
      )}
      </div>

      {/* Face selection modal for representative */}
      {selectedImageActions.showFaceSelectionModal && (
        <SelectFaceForRepModal
          isOpen={selectedImageActions.showFaceSelectionModal}
          onClose={selectedImageActions.onCloseFaceSelectionModal}
          faces={selectedImageActions.facesForSelection}
          urlHelpers={urlHelpers}
          groupLabel={entityLabel}
          onSelect={selectedImageActions.onFaceSelected}
        />
      )}

      {/* Delete confirmation modal */}
      {selectedImageActions.showDeleteConfirmModal && (
        <ConfirmDelete
          isOpen={selectedImageActions.showDeleteConfirmModal}
          onClose={selectedImageActions.onCancelDelete}
          onConfirm={selectedImageActions.onConfirmDelete}
          title="Delete Photos"
          message={`Are you sure you want to delete ${selectedImageActions.deleteCount} ${selectedImageActions.deleteCount === 1 ? 'photo' : 'photos'}?`}
          simpleMessage={true}
          images={selectedImageActions.deleteImagesList}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="image"
        entityIds={Array.from(selectedImages)}
        eventUrl={eventUrl}
      />
    </>
  );
}
