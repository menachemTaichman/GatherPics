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
import { AlbumQuickAddButton } from '../albums';
import useImageActions from '../images/ImageActions';
import { SelectFaceForRepModal } from '../groups';
import { ConfirmDelete } from '../modals';
import { ManageAccessModal } from '../profiles';
import { useDataStore } from '../../utils/dataManager';
import { useState } from 'react';
import { PermissionGate } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { useEventId } from '../../utils/storeUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';

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
  onSetRepresentative,
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
  showDelete = true,
  showManageAccess = true,
  showSetRepresentative = true,
  selectionMode = false,
  entity = null,
  entityId = null,
  isFacesMode = false,
  isUnassociatedGroup = false
}) {  
  const eventId = useEventId(eventUrl);
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const permissions = usePermissions();
  const { t } = useTranslation();
  const { isRTL } = useRTL();

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
    ? (useDataStore.getState().entities?.[eventId]?.groups?.[entityId]?.label || 'person')
    : (useDataStore.getState().entities?.[eventId]?.moments?.[entityId]?.label || 'moment');

  // Check if action buttons group has any visible buttons
  const hasActionButtons = (
    (showFavorites && permissions.canEdit && permissions.hasFavoritesAlbum) ||
    (showArchive && permissions.canEdit && permissions.hasArchiveAlbum) ||
    (showAlbum && permissions.canEdit) ||
    showBucket
  );

  // Check if management buttons group has any visible buttons
  const hasManagementButtons = (
    (showDelete && permissions.canUploadAndDeleteImages) ||
    (showManageAccess && permissions.isProfilesManager)
  );

  // Check if we can set representative in faces mode
  const canSetRepInFacesMode = isFacesMode && selectedCount === 1 && permissions.canEdit && !isUnassociatedGroup;
  
  // Check if advanced buttons group has any visible buttons
  const hasAdvancedButtons = (
    (showSetRepresentative && !isUnassociatedGroup && (selectedImageActions.canSetRepresentative || canSetRepInFacesMode) && permissions.canEdit) ||
    (showTransferFaces && permissions.canEdit) ||
    (showRemoveFromMoment && permissions.canEdit) ||
    (showMoveToMoment && permissions.canEdit) ||
    (showRemoveFromAlbum && permissions.canEdit)
  );

  if (!selectionMode && selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-full px-4 py-2 flex items-center gap-3 z-30" dir={isRTL ? 'rtl' : 'ltr'}>
        <span className="text-sm text-gray-700">{selectedCount} {t('floatingSelectionControls.selected')}</span>
      
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
            title={t('floatingSelectionControls.selectAllPhotos')}
            aria-label={t('floatingSelectionControls.selectAllPhotos')}
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
          title={t('floatingSelectionControls.clearSelection')}
          aria-label={t('floatingSelectionControls.clearSelection')}
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
                title={shouldShowFavorited ? t('floatingSelectionControls.removeFromFavorites') : t('floatingSelectionControls.addToFavorites')}
                aria-label={shouldShowFavorited ? t('floatingSelectionControls.removeFromFavorites') : t('floatingSelectionControls.addToFavorites')}
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
                title={shouldShowArchived ? t('floatingSelectionControls.removeFromArchive') : t('floatingSelectionControls.moveToArchive')}
                aria-label={shouldShowArchived ? t('floatingSelectionControls.removeFromArchive') : t('floatingSelectionControls.moveToArchive')}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill={shouldShowArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
                </svg>
              </button>
            </PermissionGate>
          )}
          
          {/* Add to Album */}
          {showAlbum && permissions.canEdit && (
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
              title={selectedImageActions.allInBucket ? t('floatingSelectionControls.removeFromBucket') : t('floatingSelectionControls.addToBucket')}
              aria-label={selectedImageActions.allInBucket ? t('floatingSelectionControls.removeFromBucket') : t('floatingSelectionControls.addToBucket')}
            >
              <ShoppingBag className={`w-4 h-4 ${selectedImageActions.allInBucket ? 'fill-blue-400' : ''}`} />
            </button>
          )}

          {/* Separator before management buttons - only if action buttons exist AND management buttons exist */}
          {hasActionButtons && hasManagementButtons && <span className="text-gray-300">|</span>}

          {/* Delete Images */}
          {showDelete && (
            <PermissionGate requires="canUploadAndDeleteImages">
              <button
                onClick={selectedImageActions.deleteImages}
                className="w-8 h-8 rounded-md hover:bg-red-100 flex items-center justify-center text-red-600"
                title={t('floatingSelectionControls.deleteSelectedPhotos')}
                aria-label={t('floatingSelectionControls.deleteSelectedPhotos')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}

          {/* Manage Access */}
          {showManageAccess && (
            <PermissionGate requires="isProfilesManager">
              <button
                onClick={() => setShowManageAccessModal(true)}
                className="w-8 h-8 rounded-md hover:bg-blue-100 flex items-center justify-center text-blue-600"
                title={t('floatingSelectionControls.manageProfileAccess')}
                aria-label={t('floatingSelectionControls.manageProfileAccess')}
              >
                <Key className="w-4 h-4" />
              </button>
            </PermissionGate>
          )}

          {/* Separator before advanced buttons - only if management buttons exist AND advanced buttons exist */}
          {hasManagementButtons && hasAdvancedButtons && <span className="text-gray-300">|</span>}

          {/* Set as representative - for single image/face selection */}
          {showSetRepresentative && !isUnassociatedGroup && (selectedImageActions.canSetRepresentative || canSetRepInFacesMode) && (
            <PermissionGate requires="canEdit">
              <button
                onClick={() => {
                  if (isFacesMode && canSetRepInFacesMode && onSetRepresentative) {
                    // In faces mode, call the callback with the face ID
                    const faceId = Array.from(selectedImages)[0];
                    onSetRepresentative(faceId);
                  } else {
                    selectedImageActions.setRepresentative();
                  }
                }}
                className={`w-8 h-8 rounded-md hover:bg-yellow-100 flex items-center justify-center ${
                  selectedImageActions.isRepresentative
                    ? 'text-orange-600'
                    : 'text-yellow-600'
                }`}
                title={isFacesMode ? t('floatingSelectionControls.setAsRepresentative') : (selectedImageActions.isRepresentative ? t('floatingSelectionControls.currentRepresentative') : t('floatingSelectionControls.setAsRepresentative'))}
                aria-label={isFacesMode ? t('floatingSelectionControls.setAsRepresentative') : (selectedImageActions.isRepresentative ? t('floatingSelectionControls.currentRepresentative') : t('floatingSelectionControls.setAsRepresentative'))}
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
                title={t('floatingSelectionControls.transferFaces')}
                aria-label={t('floatingSelectionControls.transferFaces')}
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
                title={t('floatingSelectionControls.removeFromMoment')}
                aria-label={t('floatingSelectionControls.removeFromMoment')}
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
                title={t('floatingSelectionControls.moveOrRemoveFromMoment')}
                aria-label={t('floatingSelectionControls.moveOrRemoveFromMoment')}
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
                title={t('floatingSelectionControls.removeFromAlbum')}
                aria-label={t('floatingSelectionControls.removeFromAlbum')}
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
          title={t('floatingSelectionControls.deletePhotos')}
          message={`${t('floatingSelectionControls.deleteConfirmation', { count: selectedImageActions.deleteCount })} ${selectedImageActions.deleteCount === 1 ? t('floatingSelectionControls.photo') : t('floatingSelectionControls.photos')}?`}
          simpleMessage={true}
          images={selectedImageActions.deleteImagesList}
          confirmText={t('floatingSelectionControls.delete')}
          cancelText={t('floatingSelectionControls.cancel')}
          caption={t('floatingSelectionControls.cannotBeUndone')}
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



