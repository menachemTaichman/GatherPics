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
  Key,
  MoreVertical,
  Plus
} from 'lucide-react';
import { AlbumQuickAddButton } from '../albums';
import useImageActions from '../images/ImageActions';
import { SelectFaceForRepModal } from '../groups';
import { ConfirmDelete } from '../modals';
import { ManageAccessModal } from '../profiles';
import { useDataStore } from '../../utils/dataManager';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PermissionGate, LongPressHoverButton } from '../common';
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAlbumDropdown, setShowAlbumDropdown] = useState(false);
  const [albumButtonPosition, setAlbumButtonPosition] = useState(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const permissions = usePermissions();
  const { t } = useTranslation();
  const { isRTL } = useRTL();

  // Calculate menu position for portal rendering
  const getMenuPosition = () => {
    if (!menuButtonRef.current) return {};
    const rect = menuButtonRef.current.getBoundingClientRect();
    return {
      position: 'fixed',
      ...(isRTL 
        ? { left: `${rect.left}px` }
        : { right: `${window.innerWidth - rect.right}px` }
      ),
      bottom: `${window.innerHeight - rect.top + 8}px`,
      zIndex: 10000,
    };
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!showMoreMenu) return;
      
      // Don't close if clicking inside the menu
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return;
      }
      
      // Don't close if clicking the menu button
      if (menuButtonRef.current && menuButtonRef.current.contains(event.target)) {
        return;
      }
      
      // Don't close if clicking inside the album dropdown (which is rendered via portal)
      // Check if the click target is inside an element with data-album-dropdown attribute
      let target = event.target;
      while (target && target !== document.body) {
        if (target.closest && target.closest('[data-album-dropdown="true"]')) {
          return; // Don't close menu if clicking inside album dropdown
        }
        target = target.parentElement;
      }
      
      // Close the menu
      setShowMoreMenu(false);
    };

    if (showMoreMenu) {
      // Use a slight delay to avoid catching the opening click
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside, true);
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [showMoreMenu, showAlbumDropdown]);

  // Close album dropdown when menu closes
  useEffect(() => {
    if (!showMoreMenu) {
      setShowAlbumDropdown(false);
      setAlbumButtonPosition(null);
    }
  }, [showMoreMenu]);

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

  // Check if there are any menu items to show (everything except favorites, archive, bucket)
  const hasMenuItems = (
    (showAlbum && permissions.canEdit) ||
    (showDelete && permissions.canUploadAndDeleteImages) ||
    (showManageAccess && permissions.isProfilesManager) ||
    (showSetRepresentative && !isUnassociatedGroup && (selectedImageActions.canSetRepresentative || canSetRepInFacesMode) && permissions.canEdit) ||
    (showTransferFaces && permissions.canEdit) ||
    (showRemoveFromMoment && permissions.canEdit) ||
    (showMoveToMoment && permissions.canEdit) ||
    (showRemoveFromAlbum && permissions.canEdit)
  );

  if (!selectionMode && selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-lg md:rounded-full px-2 py-2 md:px-4 flex items-center gap-1.5 md:gap-3 max-w-[calc(100vw-2rem)] md:max-w-none overflow-x-auto md:overflow-visible overflow-y-visible z-30" dir={isRTL ? 'rtl' : 'ltr'}>
        <span className="text-xs md:text-sm text-gray-700 whitespace-nowrap flex-shrink-0">{selectedCount} {t('floatingSelectionControls.selected')}</span>
      
      {/* Select all button - only visible when not all are selected */}
      {selectedCount < totalCount && (
        <>
          <span className="text-gray-300 flex-shrink-0 hidden md:inline">|</span>
          <LongPressHoverButton
            onClick={onSelectAll}
            className={`w-10 h-10 md:w-8 md:h-8 rounded-md transition-colors flex items-center justify-center flex-shrink-0 ${
              selectedCount > 0 
                ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 active:bg-yellow-300' 
                : 'hover:bg-gray-100 active:bg-gray-200 text-gray-700'
            }`}
            title={t('floatingSelectionControls.selectAllPhotos')}
            aria-label={t('floatingSelectionControls.selectAllPhotos')}
          >
            <CheckCheck className="w-5 h-5 md:w-4 md:h-4" />
          </LongPressHoverButton>
        </>
      )}
      
      {/* Clear selection - only show when there are selected items */}
      {selectedCount > 0 && (
        <LongPressHoverButton
          onClick={onClearSelection}
          className="w-10 h-10 md:w-8 md:h-8 rounded-md bg-red-100 text-red-700 hover:bg-red-200 active:bg-red-300 flex items-center justify-center flex-shrink-0"
          title={t('floatingSelectionControls.clearSelection')}
          aria-label={t('floatingSelectionControls.clearSelection')}
        >
          <X className="w-5 h-5 md:w-4 md:h-4" />
        </LongPressHoverButton>
      )}
      
      {/* Action buttons - only show when images are selected */}
      {selectedCount > 0 && (
        <>
          {/* Separator before action buttons - only if there are visible action buttons */}
          {hasActionButtons && <span className="text-gray-300 flex-shrink-0 hidden md:inline">|</span>}
          
          {/* Add to Favorites */}
          {showFavorites && (
            <PermissionGate requires={["canEdit", "hasFavoritesAlbum"]}>
              <LongPressHoverButton
                onClick={selectedImageActions.toggleFavorite}
                className={`w-10 h-10 md:w-8 md:h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                  shouldShowFavorited 
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 active:bg-red-300' 
                    : 'hover:bg-red-50 active:bg-red-100 text-red-600'
                }`}
                title={shouldShowFavorited ? t('floatingSelectionControls.removeFromFavorites') : t('floatingSelectionControls.addToFavorites')}
                aria-label={shouldShowFavorited ? t('floatingSelectionControls.removeFromFavorites') : t('floatingSelectionControls.addToFavorites')}
              >
                <HeartIcon className={`w-5 h-5 md:w-4 md:h-4 ${shouldShowFavorited ? 'fill-current' : ''}`} />
              </LongPressHoverButton>
            </PermissionGate>
          )}
          
          {/* Move to Archive */}
          {showArchive && (
            <PermissionGate requires={["canEdit", "hasArchiveAlbum"]}>
              <LongPressHoverButton
                onClick={selectedImageActions.toggleArchive}
                className={`w-10 h-10 md:w-8 md:h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                  shouldShowArchived 
                    ? 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400' 
                    : 'hover:bg-gray-100 active:bg-gray-200 text-gray-700'
                }`}
                title={shouldShowArchived ? t('floatingSelectionControls.removeFromArchive') : t('floatingSelectionControls.moveToArchive')}
                aria-label={shouldShowArchived ? t('floatingSelectionControls.removeFromArchive') : t('floatingSelectionControls.moveToArchive')}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 md:w-4 md:h-4" fill={shouldShowArchived ? '#d1d5db' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
                </svg>
              </LongPressHoverButton>
            </PermissionGate>
          )}
          
          {/* Add to Bucket */}
          {showBucket && (
            <LongPressHoverButton
              onClick={selectedImageActions.toggleBucket}
              className="w-10 h-10 md:w-8 md:h-8 rounded-md hover:bg-gray-100 active:bg-gray-200 flex items-center justify-center text-gray-700 flex-shrink-0"
              title={selectedImageActions.allInBucket ? t('floatingSelectionControls.removeFromBucket') : t('floatingSelectionControls.addToBucket')}
              aria-label={selectedImageActions.allInBucket ? t('floatingSelectionControls.removeFromBucket') : t('floatingSelectionControls.addToBucket')}
            >
              <ShoppingBag className={`w-5 h-5 md:w-4 md:h-4 ${selectedImageActions.allInBucket ? 'fill-blue-400' : ''}`} />
            </LongPressHoverButton>
          )}

          {/* Desktop: Show all other buttons */}
          {/* Mobile: Hide these and show in menu */}
          
          {/* Add to Album - Desktop only */}
          {showAlbum && permissions.canEdit && (
            <PermissionGate requires="canEdit">
              <div className="hidden md:block">
                <AlbumQuickAddButton 
                  selectedImages={Array.from(selectedImages)} 
                  eventUrl={eventUrl}
                  urlHelpers={urlHelpers}
                  placeholderDataUrl={placeholderDataUrl}
                  dropdownDirection="up"
                />
              </div>
            </PermissionGate>
          )}

          {/* Separator before management buttons - Desktop only */}
          {hasActionButtons && hasManagementButtons && <span className="text-gray-300 flex-shrink-0 hidden md:inline">|</span>}

          {/* Delete Images - Desktop only */}
          {showDelete && (
            <PermissionGate requires="canUploadAndDeleteImages">
              <LongPressHoverButton
                onClick={selectedImageActions.deleteImages}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-red-100 active:bg-red-200 items-center justify-center text-red-600 flex-shrink-0"
                title={t('floatingSelectionControls.deleteSelectedPhotos')}
                aria-label={t('floatingSelectionControls.deleteSelectedPhotos')}
              >
                <Trash2 className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}

          {/* Manage Access - Desktop only */}
          {showManageAccess && (
            <PermissionGate requires="isProfilesManager">
              <LongPressHoverButton
                onClick={() => setShowManageAccessModal(true)}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-blue-100 active:bg-blue-200 items-center justify-center text-blue-600 flex-shrink-0"
                title={t('floatingSelectionControls.manageProfileAccess')}
                aria-label={t('floatingSelectionControls.manageProfileAccess')}
              >
                <Key className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}

          {/* Separator before advanced buttons - Desktop only */}
          {hasManagementButtons && hasAdvancedButtons && <span className="text-gray-300 flex-shrink-0 hidden md:inline">|</span>}

          {/* Set as representative - Desktop only */}
          {showSetRepresentative && !isUnassociatedGroup && (selectedImageActions.canSetRepresentative || canSetRepInFacesMode) && (
            <PermissionGate requires="canEdit">
              <LongPressHoverButton
                onClick={() => {
                  if (isFacesMode && canSetRepInFacesMode && onSetRepresentative) {
                    const faceId = Array.from(selectedImages)[0];
                    onSetRepresentative(faceId);
                  } else {
                    selectedImageActions.setRepresentative();
                  }
                }}
                className={`hidden md:flex w-8 h-8 rounded-md hover:bg-yellow-100 active:bg-yellow-200 items-center justify-center flex-shrink-0 ${
                  selectedImageActions.isRepresentative
                    ? 'text-orange-600'
                    : 'text-yellow-600'
                }`}
                title={isFacesMode ? t('floatingSelectionControls.setAsRepresentative') : (selectedImageActions.isRepresentative ? t('floatingSelectionControls.currentRepresentative') : t('floatingSelectionControls.setAsRepresentative'))}
                aria-label={isFacesMode ? t('floatingSelectionControls.setAsRepresentative') : (selectedImageActions.isRepresentative ? t('floatingSelectionControls.currentRepresentative') : t('floatingSelectionControls.setAsRepresentative'))}
              >
                <Star className={`w-4 h-4 ${selectedImageActions.isRepresentative ? 'fill-current' : ''}`} />
              </LongPressHoverButton>
            </PermissionGate>
          )}

          {/* Transfer faces - Desktop only */}
          {showTransferFaces && (
            <PermissionGate requires="canEdit">
              <LongPressHoverButton
                onClick={onTransferFaces}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-orange-100 active:bg-orange-200 text-orange-700 items-center justify-center flex-shrink-0"
                title={t('floatingSelectionControls.transferFaces')}
                aria-label={t('floatingSelectionControls.transferFaces')}
              >
                <Users className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}
          
          {/* Remove from moment - Desktop only */}
          {showRemoveFromMoment && (
            <PermissionGate requires="canEdit">
              <LongPressHoverButton
                onClick={onRemoveFromMoment}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-red-100 active:bg-red-200 text-red-700 items-center justify-center flex-shrink-0"
                title={t('floatingSelectionControls.removeFromMoment')}
                aria-label={t('floatingSelectionControls.removeFromMoment')}
              >
                <Trash2 className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}
          
          {/* Move to moment - Desktop only */}
          {showMoveToMoment && (
            <PermissionGate requires="canEdit">
              <LongPressHoverButton
                onClick={onMoveToMoment}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-blue-100 active:bg-blue-200 text-blue-700 items-center justify-center flex-shrink-0"
                title={t('floatingSelectionControls.moveOrRemoveFromMoment')}
                aria-label={t('floatingSelectionControls.moveOrRemoveFromMoment')}
              >
                <Clock className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}
          
          {/* Remove from album - Desktop only */}
          {showRemoveFromAlbum && (
            <PermissionGate requires="canEdit">
              <LongPressHoverButton
                onClick={onRemoveFromAlbum}
                className="hidden md:flex w-8 h-8 rounded-md hover:bg-red-100 active:bg-red-200 text-red-700 items-center justify-center flex-shrink-0"
                title={t('floatingSelectionControls.removeFromAlbum')}
                aria-label={t('floatingSelectionControls.removeFromAlbum')}
              >
                <Minus className="w-4 h-4" />
              </LongPressHoverButton>
            </PermissionGate>
          )}

          {/* Mobile: More menu button */}
          {hasMenuItems && (
            <>
              <span className="text-gray-300 flex-shrink-0 md:hidden">|</span>
              <div className="relative md:hidden">
                <LongPressHoverButton
                  ref={menuButtonRef}
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="w-10 h-10 rounded-md hover:bg-gray-100 active:bg-gray-200 flex items-center justify-center text-gray-700 flex-shrink-0"
                  title={t('floatingSelectionControls.moreActions')}
                  aria-label={t('floatingSelectionControls.moreActions')}
                  aria-expanded={showMoreMenu}
                >
                  <MoreVertical className="w-5 h-5" />
                </LongPressHoverButton>
              </div>
            </>
          )}
        </>
      )}
      </div>
      
      {/* Mobile menu dropdown - rendered via portal (outside main container to escape overflow) */}
      {hasMenuItems && showMoreMenu && menuButtonRef.current && createPortal(
        <div
          ref={menuRef}
          style={getMenuPosition()}
          className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]"
          dir={isRTL ? 'rtl' : 'ltr'}
          onClick={(e) => e.stopPropagation()}
        >
                    {/* Add to Album */}
                    {showAlbum && permissions.canEdit && (
                      <PermissionGate requires="canEdit">
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setAlbumButtonPosition({
                                left: rect.left,
                                right: rect.right,
                                top: rect.top,
                                bottom: rect.bottom
                              });
                              setShowAlbumDropdown(true);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            <span>{t('albumQuickAdd.addToAlbum')}</span>
                          </button>
                          {showAlbumDropdown && (
                            <div className="fixed -z-50 opacity-0 pointer-events-none" style={{ left: '-9999px', top: '-9999px' }}>
                              <AlbumQuickAddButton 
                                selectedImages={Array.from(selectedImages)} 
                                eventUrl={eventUrl}
                                urlHelpers={urlHelpers}
                                placeholderDataUrl={placeholderDataUrl}
                                dropdownDirection="up"
                                open={true}
                                externalButtonPosition={albumButtonPosition}
                                onOpenChange={(isOpen) => {
                                  if (!isOpen) {
                                    setShowAlbumDropdown(false);
                                    setAlbumButtonPosition(null);
                                  }
                                }}
                              />
                            </div>
                          )}
                        </>
                      </PermissionGate>
                    )}

                    {/* Delete Images */}
                    {showDelete && (
                      <PermissionGate requires="canUploadAndDeleteImages">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            selectedImageActions.deleteImages();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.deleteSelectedPhotos')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Manage Access */}
                    {showManageAccess && (
                      <PermissionGate requires="isProfilesManager">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            setShowManageAccessModal(true);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                        >
                          <Key className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.manageProfileAccess')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Set as representative */}
                    {showSetRepresentative && !isUnassociatedGroup && (selectedImageActions.canSetRepresentative || canSetRepInFacesMode) && (
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            if (isFacesMode && canSetRepInFacesMode && onSetRepresentative) {
                              const faceId = Array.from(selectedImages)[0];
                              onSetRepresentative(faceId);
                            } else {
                              selectedImageActions.setRepresentative();
                            }
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-yellow-50 flex items-center gap-2 ${
                            selectedImageActions.isRepresentative ? 'text-orange-600' : 'text-yellow-600'
                          }`}
                        >
                          <Star className={`w-4 h-4 ${selectedImageActions.isRepresentative ? 'fill-current' : ''}`} />
                          <span>{t('floatingSelectionControls.setAsRepresentative')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Transfer faces */}
                    {showTransferFaces && (
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            onTransferFaces();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-orange-700 hover:bg-orange-50 flex items-center gap-2"
                        >
                          <Users className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.transferFaces')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Remove from moment */}
                    {showRemoveFromMoment && (
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            onRemoveFromMoment();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.removeFromMoment')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Move to moment */}
                    {showMoveToMoment && (
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            onMoveToMoment();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2"
                        >
                          <Clock className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.moveOrRemoveFromMoment')}</span>
                        </button>
                      </PermissionGate>
                    )}

                    {/* Remove from album */}
                    {showRemoveFromAlbum && (
                      <PermissionGate requires="canEdit">
                        <button
                          onClick={() => {
                            setShowMoreMenu(false);
                            onRemoveFromAlbum();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Minus className="w-4 h-4" />
                          <span>{t('floatingSelectionControls.removeFromAlbum')}</span>
                        </button>
                      </PermissionGate>
                    )}
        </div>,
        document.body
      )}

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



