import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ShoppingBag, Trash2, Key, Star, Edit, Edit2, Minus, User, 
  ChevronDown, ChevronUp, Eye, EyeOff
} from 'lucide-react';
import { PermissionGate } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import { useDataStore } from '../../utils/dataManager';
import { useRTL } from '../../hooks/useRTL';
import { formatDateTime } from '../../utils/dateUtils';
import { formatErrorMessage } from '../../utils/errorHandler';
import { eventsAPI, imagesAPI } from '../../utils/apiService';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { getPreference, setPreference } from '../../utils/settings';

// Imported components
import { SelectFaceForRepModal } from '../groups';
import { ConfirmDelete } from '../modals';
import { ManageAccessModal } from '../profiles';
import { AlbumQuickAddButton } from '../albums';

// ImageViewerActions component
export function ImageViewerActions({
  imageId,
  imageInfo,
  eventUrl,
  showToast,
  urlHelpers,
  onImageUpdated,
  entity,
  entityId,
  eventId,
  imageActions,
  isUnassociatedGroup = false,
  isMobile = false
}) {
  const { t } = useTranslation();
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [settingEventRepresentative, setSettingEventRepresentative] = useState(false);
  const permissions = usePermissions();
  
  const eventInfo = useDataStore(state => state.entities?.[eventId]?.event);

  const isEventRepresentative = Boolean(eventInfo && imageId && eventInfo.representative_image === imageId);
  const eventRepresentativeTooltip = isEventRepresentative
    ? t('imageViewer.currentEventCoverPhoto')
    : t('imageViewer.setAsEventCoverPhoto');

  const handleSetEventRepresentative = async () => {
    if (!imageId || !eventUrl || settingEventRepresentative || isEventRepresentative) {
      return;
    }
    try {
      setSettingEventRepresentative(true);
      await eventsAPI.update(eventUrl, { representative_image: imageId });
      showToast(t('imageViewer.eventCoverUpdated'), 'success');
    } catch (error) {
      showToast(formatErrorMessage('set event cover', error), 'error');
    } finally {
      setSettingEventRepresentative(false);
    }
  };

  const entityLabel = entity === 'group' 
    ? (useDataStore.getState().entities?.[eventId]?.groups?.[entityId]?.label || 'person')
    : (useDataStore.getState().entities?.[eventId]?.moments?.[entityId]?.label || 'moment');

  const hasActionButtons = true;
  const hasManagementButtons = (
    permissions.canUploadAndDeleteImages ||
    permissions.isProfilesManager
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Add to album */}
        {permissions.canEdit && (
          <PermissionGate requires="canEdit">
            <AlbumQuickAddButton {...imageActions.albumQuickAddProps} dropdownDirection="down" />
          </PermissionGate>
        )}
        
        {/* Add to bucket / Remove from bucket */}
        <button
          onClick={imageActions.toggleBucket}
          className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700`}
          title={imageActions.allInBucket ? t('imageViewer.removeFromBucket') : t('imageViewer.addToBucket')}
          aria-label={imageActions.allInBucket ? t('imageViewer.removeFromBucket') : t('imageViewer.addToBucket')}
        >
          <ShoppingBag className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${imageActions.allInBucket ? 'fill-blue-400' : ''}`} />
        </button>

        {hasActionButtons && hasManagementButtons && <span className="text-gray-300">|</span>}

        {/* Delete image */}
        <PermissionGate requires="canUploadAndDeleteImages">
          <button
            onClick={imageActions.deleteImages}
            className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-100 text-red-600`}
            title={t('imageViewer.deletePhoto')}
            aria-label={t('imageViewer.deletePhoto')}
          >
            <Trash2 className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
        </PermissionGate>

        {/* Manage Access */}
        <PermissionGate requires="isProfilesManager">
          <button
            onClick={() => setShowManageAccessModal(true)}
            className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-blue-100 text-blue-600`}
            title={t('imageViewer.manageProfileAccess')}
            aria-label={t('imageViewer.manageProfileAccess')}
          >
            <Key className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
        </PermissionGate>

        {hasManagementButtons && imageActions.canSetRepresentative && !isUnassociatedGroup && permissions.canEdit && (
          <span className="text-gray-300">|</span>
        )}

        {/* Set as representative */}
        {imageActions.canSetRepresentative && !isUnassociatedGroup && (
          <PermissionGate requires="canEdit">
            <button
              onClick={() => imageActions.setRepresentative()}
              className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-yellow-50 ${
                imageActions.isRepresentative
                  ? 'text-orange-600'
                  : 'text-yellow-600'
              }`}
              title={imageActions.representativeTooltip}
            >
              <Star className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${imageActions.isRepresentative ? 'fill-current' : ''}`} />
            </button>
          </PermissionGate>
        )}

        {/* Set as event representative */}
        {imageId && (
          <PermissionGate requires="canManageEvent">
            <button
              onClick={handleSetEventRepresentative}
              className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} border border-transparent rounded-md transition-colors flex items-center justify-center ${
                isEventRepresentative
                  ? 'bg-gradient-to-br from-red-500 to-rose-500 text-white hover:from-red-500 hover:to-rose-500'
                  : 'text-red-600 hover:bg-red-50'
              } ${settingEventRepresentative ? 'opacity-75 cursor-not-allowed' : ''}`}
              title={eventRepresentativeTooltip}
              aria-pressed={isEventRepresentative}
              disabled={settingEventRepresentative || isEventRepresentative}
            >
              <Star className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isEventRepresentative ? 'fill-current' : ''}`} />
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Face selection modal for representative */}
      {imageActions.showFaceSelectionModal && (
        <SelectFaceForRepModal
          isOpen={imageActions.showFaceSelectionModal}
          onClose={imageActions.onCloseFaceSelectionModal}
          faces={imageActions.facesForSelection}
          urlHelpers={urlHelpers}
          groupLabel={entityLabel}
          onSelect={imageActions.onFaceSelected}
        />
      )}

      {/* Delete confirmation modal */}
      {imageActions.showDeleteConfirmModal && (
        <ConfirmDelete
          isOpen={imageActions.showDeleteConfirmModal}
          onClose={imageActions.onCancelDelete}
          onConfirm={imageActions.onConfirmDelete}
          title={t('imageViewer.deletePhoto')}
          message={t('imageViewer.areYouSureYouWantToDeleteThisPhoto')}
          simpleMessage={true}
          images={imageActions.deleteImagesList}
          confirmText={t('imageViewer.delete')}
          cancelText={t('imageViewer.cancel')}
          caption={t('imageViewer.thisActionCannotBeUndone')}
        />
      )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType="image"
        entityIds={[imageId]}
        eventUrl={eventUrl}
      />
    </>
  );
}

// Main ImageDetails component
export function ImageDetails({
  imageId,
  storeImageInfo,
  eventUrl,
  showToast,
  urlHelpers,
  onImageUpdated,
  entity,
  parent, // entityId
  eventId,
  imageActions,
  isUnassociatedGroup,
  isMobile,
  
  // Props for functionality moved from parent
  momentInfo,
  handleMomentLinkClick,
  setShowMoveToMomentModal,
  
  albumsList,
  handleRemoveFromAlbum,
  handleAlbumLinkClick,
  
  facesList,
  handleFaceClick,
  handlePersonLinkClick,
  showRectangles,
  setShowRectangles,
  selectedFaceIndex,
  setSelectedFaceIndex,
  
  // Permissions
  permissions,
  
  // Additional props
  imageMeta,
  children // For injecting the Action buttons or other content
}) {
  const { t } = useTranslation();
  const { me, ms } = useRTL();
  
  // Local state for description
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  
  // Local state for accordion
  const [albumsOpen, setAlbumsOpen] = useState(() => getPreference('ImageViewer.albumsOpen', false));
  const [facesOpen, setFacesOpen] = useState(() => getPreference('ImageViewer.facesOpen', false));
  const [albumsHeight, setAlbumsHeight] = useState(() => getPreference('ImageViewer.albumsHeight', 200));
  
  // Resizing logic
  const [isResizing, setIsResizing] = useState(false);
  const sectionsRef = useRef(null);
  const startResizeYRef = useRef(0);
  const startAlbumsHeightRef = useRef(0);

  // Sync description when image changes
  useEffect(() => {
    if (storeImageInfo) {
      setDescriptionValue(storeImageInfo.description || '');
      setIsEditingDescription(false);
    }
  }, [storeImageInfo?.description, imageId]);

  // Persist preferences
  const initialValuesRef = useRef({
    albumsOpen: getPreference('ImageViewer.albumsOpen', false),
    facesOpen: getPreference('ImageViewer.facesOpen', false),
    albumsHeight: getPreference('ImageViewer.albumsHeight', 200),
  });

  useEffect(() => {
    if (albumsOpen !== initialValuesRef.current.albumsOpen) {
      initialValuesRef.current.albumsOpen = albumsOpen;
      setPreference('ImageViewer.albumsOpen', albumsOpen);
    }
  }, [albumsOpen]);
  
  useEffect(() => {
    if (facesOpen !== initialValuesRef.current.facesOpen) {
      initialValuesRef.current.facesOpen = facesOpen;
      setPreference('ImageViewer.facesOpen', facesOpen);
    }
  }, [facesOpen]);
  
  useEffect(() => {
    if (albumsHeight !== initialValuesRef.current.albumsHeight) {
      initialValuesRef.current.albumsHeight = albumsHeight;
      setPreference('ImageViewer.albumsHeight', albumsHeight);
    }
  }, [albumsHeight]);

  // Resizing handlers
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !sectionsRef.current) return;
      const rect = sectionsRef.current.getBoundingClientRect();
      const delta = e.clientY - startResizeYRef.current;
      const minAlbum = 16;
      const minFaces = 100;
      const maxAlbum = Math.max(minAlbum, rect.height - minFaces);
      const proposed = startAlbumsHeightRef.current + delta;
      const next = Math.max(minAlbum, Math.min(proposed, maxAlbum));
      setAlbumsHeight(next);
    };
    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        try { document.body.style.cursor = ''; document.body.style.userSelect = ''; } catch {}
      }
    };
    if (isResizing) {
      try { document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; } catch {}
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try { document.body.style.cursor = ''; document.body.style.userSelect = ''; } catch {}
    };
  }, [isResizing]);

  const startResize = (e) => {
    startResizeYRef.current = e.clientY;
    startAlbumsHeightRef.current = albumsHeight;
    setIsResizing(true);
  };

  const handleDescriptionClick = () => {
    if (permissions.canEdit && !isEditingDescription) {
      setIsEditingDescription(true);
    }
  };

  const handleDescriptionSave = async () => {
    if (!imageId || !permissions.canEdit || isSavingDescription) return;
    
    try {
      setIsSavingDescription(true);
      const currentDescription = storeImageInfo?.description || '';
      const newDescription = descriptionValue.trim();
      
      // Only save if changed
      if (newDescription !== currentDescription) {
        await imagesAPI.update(imageId, { description: newDescription }, eventUrl);
        showToast(t('imageViewer.descriptionUpdated', { defaultValue: 'Description updated' }), 'success');
      }
      
      setIsEditingDescription(false);
    } catch (error) {
      showToast(formatErrorMessage('update description', error), 'error');
      setDescriptionValue(storeImageInfo?.description || '');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleDescriptionCancel = () => {
    setDescriptionValue(storeImageInfo?.description || '');
    setIsEditingDescription(false);
  };

  const handleDescriptionKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleDescriptionSave();
    } else if (e.key === 'Escape') {
      handleDescriptionCancel();
    }
  };

  const getGroupLabel = (face) => {
    if (face?.isPlaceholder) return '';
    const gid = face?.groupId || face?.group_id;
    if (!gid) return '';
    const group = useDataStore.getState().entities?.[eventId]?.groups?.[gid];
    return group?.label || '';
  };

  const getGroupRepresentativeFace = (face) => {
    const gid = face?.groupId || face?.group_id;
    if (!gid) return 'none';
    const group = useDataStore.getState().entities?.[eventId]?.groups?.[gid];
    return group?.representative_face || 'none';
  };

  return (
    <div className={`flex flex-col h-full min-h-0 ${isMobile ? 'p-4' : ''}`}>
      {/* Controls / Actions */}
      <div className={`${isMobile ? 'mb-4' : 'p-3 border-b border-gray-200'} image-viewer-controls flex-none relative`}>
        {children}
      </div>

      {/* Details Section */}
      <div className={`${isMobile ? '' : 'mt-3 pt-3'} flex-none`}>
        <h4 className="text-xs font-medium text-gray-700 mb-1">{t('imageViewer.photoDetails')}</h4>
        <div className="text-xs text-gray-500 space-y-0.5">
          <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.name')}</span> {storeImageInfo?.label || imageMeta?.label}</div>
          <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.date')}</span> <span dir="ltr">{formatDateTime(storeImageInfo?.date_taken)}</span></div>
          <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.originalSize')}</span> <span dir="ltr">{(() => {
            const size = storeImageInfo?.file_size;
            if (!size) return t('imageViewer.unknown');
            if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
            if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
            return (size / 1024).toFixed(1) + ' KB';
          })()}</span></div>
          <div><span className={`font-semibold ${me('2')}`}>{t('imageViewer.originalResolution')}</span> <span dir="ltr">{storeImageInfo?.width && storeImageInfo?.height ? `${storeImageInfo.width} x ${storeImageInfo.height}` : t('imageViewer.unknown')}</span></div>
          
          {/* Description */}
          <div className={`mt-2 transition-all duration-200 ${isEditingDescription ? 'p-2 bg-gray-50 rounded-lg border border-gray-200' : ''}`}>
            <div className="flex items-start">
              <span className={`font-semibold flex-shrink-0 ${me('2')}`}>{t('imageViewer.description')}</span>
              {isEditingDescription && permissions.canEdit ? (
                <div className="flex-1 min-w-0">
                  <textarea
                    value={descriptionValue}
                    onChange={(e) => setDescriptionValue(e.target.value)}
                    onBlur={handleDescriptionSave}
                    onKeyDown={handleDescriptionKeyDown}
                    className="w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none shadow-sm"
                    rows={4}
                    autoFocus
                    disabled={isSavingDescription}
                    style={{ minHeight: '4rem' }}
                  />
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                      onClick={handleDescriptionCancel}
                      className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      disabled={isSavingDescription}
                    >
                      {t('imageViewer.cancel')}
                    </button>
                    <button
                      onClick={handleDescriptionSave}
                      className="text-xs text-primary-600 hover:text-primary-800 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                      disabled={isSavingDescription}
                    >
                      {isSavingDescription ? t('imageViewer.saving') : t('imageViewer.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={handleDescriptionClick}
                  className={`flex-1 min-w-0 text-gray-500 ${permissions.canEdit ? 'cursor-text hover:text-gray-700' : ''} transition-colors`}
                  title={permissions.canEdit ? t('imageViewer.clickToEditDescription') : ''}
                >
                  {storeImageInfo?.description ? (
                    <span className="whitespace-pre-wrap break-words">{storeImageInfo.description}</span>
                  ) : (
                    <span className="text-gray-400 italic">{permissions.canEdit ? t('imageViewer.clickToAddDescription') : t('imageViewer.noDescription')}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Moment Information */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 flex-1 min-w-0">
              <span className={`font-semibold ${me('2')}`}>{t('imageViewer.moment')}</span>
              {momentInfo ? (
                <a
                  href={`/${eventUrl}/timeline?moment=${encodeURIComponent(momentInfo.label)}`}
                  onClick={handleMomentLinkClick}
                  className={`${ms('1')} text-primary-600 hover:text-primary-700 hover:underline cursor-pointer`}
                  title={t('imageViewer.jumpToMoment')}
                >
                  {momentInfo.label}
                </a>
              ) : (
                <span className={ms('1')}>{t('imageViewer.none')}</span>
              )}
            </div>
            <PermissionGate requires="canEdit">
              <button
                onClick={() => setShowMoveToMomentModal(true)}
                className={`w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center flex-shrink-0 ${ms('2')}`}
                title={t('imageViewer.editMoment')}
                aria-label={t('imageViewer.editMoment')}
              >
                <Edit2 className="w-3 h-3 text-gray-600" />
              </button>
            </PermissionGate>
          </div>
        </div>
      </div>

      {/* Albums and Faces Info with resizable split */}
      <div ref={sectionsRef} className={`flex flex-col flex-1 min-h-0 overflow-hidden gap-2 ${isMobile ? 'mt-4' : 'mt-2'}`}>
        {/* Albums Panel */}
        {(permissions.has_albums || permissions.canEdit) && albumsList && albumsList.length > 0 && (
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between px-0 pt-2">
              <h3 className="font-semibold text-gray-900">{t('imageViewer.albums')} ({albumsList.length})</h3>
              <button
                onClick={() => setAlbumsOpen(v => !v)}
                className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                title={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
                aria-label={albumsOpen ? t('imageViewer.hideAlbums') : t('imageViewer.showAlbums')}
              >
                {albumsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
            {albumsOpen && (
              <div
                className={`albums-list-container overflow-y-auto ${facesOpen ? '' : 'flex-1 min-h-0'}`}
                style={facesOpen ? { height: albumsHeight } : {}}
              >
                <div className="px-0 py-2">
                  {albumsList.map((album, index) => (
                    <div
                      key={album.id || `${album.label || 'album'}-${index}`}
                      className={`flex items-center p-2 rounded-lg bg-gray-50 ${album.isPlaceholder ? '' : 'hover:bg-gray-100'} transition-colors mb-1 last:mb-0`}
                    >
                      {album.isPlaceholder ? (
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {ImageComponent(null, {
                            width: 40,
                            height: 40,
                            className: 'w-10 h-10 object-cover rounded-lg flex-shrink-0',
                            alt: ''
                          })}
                          <span className="font-medium text-gray-900 truncate">\u00A0</span>
                        </div>
                      ) : (
                        <>
                          <a
                            href={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`}
                            onClick={(e) => handleAlbumLinkClick(e, album)}
                            className="flex items-center gap-3 flex-1 min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                            title={album.label}
                          >
                            {ImageComponent(
                              urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}` : null,
                              {
                                width: 40,
                                height: 40,
                                className: 'w-10 h-10 object-cover rounded-lg flex-shrink-0',
                                alt: ''
                              }
                            )}
                            <span className="font-medium text-gray-900 truncate">{album.label}</span>
                          </a>
                          <PermissionGate requires="canEdit">
                            <button
                              onClick={() => handleRemoveFromAlbum(album)}
                              className={`${ms('3')} p-1.5 hover:bg-red-100 rounded-lg transition-colors`}
                              title={t('imageViewer.removeFromAlbum', { album: album.label })}
                              aria-label={t('imageViewer.removeFromAlbum', { album: album.label })}
                            >
                              <Minus className="w-4 h-4 text-red-600" />
                            </button>
                          </PermissionGate>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Resizer */}
        {(permissions.has_albums || permissions.canEdit) && permissions.has_groups && albumsList && albumsList.length > 0 && albumsOpen && facesOpen && (
          <div
            className="h-2 bg-gray-100 hover:bg-gray-200 rounded cursor-row-resize mx-4 flex-shrink-0"
            onMouseDown={startResize}
            title="Drag to resize"
          />
        )}

        {/* Faces Panel */}
        {permissions.has_groups && (
          <div className="flex flex-col flex-1 min-h-0 image-viewer-faces">
            <div className="flex items-center justify-between px-0 pt-2 pb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{t('imageViewer.faces')} ({facesList.length})</h3>
                <button
                  onClick={() => {
                    if (showRectangles) {
                      setSelectedFaceIndex(null);
                    }
                    setShowRectangles(v => !v);
                  }}
                  className={`w-7 h-7 border border-transparent rounded-md transition-colors flex items-center justify-center ${showRectangles ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-700'}`}
                  title={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                  aria-label={showRectangles ? t('imageViewer.hideFaceTags') : t('imageViewer.showFaceTags')}
                >
                  {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={() => setFacesOpen(v => !v)}
                className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center"
                title={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
                aria-label={facesOpen ? t('imageViewer.hideFaces') : t('imageViewer.showFaces')}
              >
                {facesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
            {facesOpen && (
              <div className="faces-list-container overflow-y-auto">
                <div className="px-0">
                  {facesList.length === 0 ? (
                    <p className="text-gray-500 text-sm">{t('imageViewer.noFacesDetected')}</p>
                  ) : (
                    <div className="space-y-2">
                      {facesList.map((face, index) => (
                        <div
                          key={`face-list-${(face.id || face.face_id || `index-${index}`)}-${(face.groupId || face.group_id || 'unknown')}-${index}-${imageId}`}
                          className={`flex items-center gap-3 p-2 rounded-lg ${face.isPlaceholder ? '' : 'cursor-pointer'} transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                          onClick={face.isPlaceholder ? undefined : () => handleFaceClick(index)}
                        >
                          {ImageComponent(
                            face.isPlaceholder ? null : (urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('groups', face.groupId || face.group_id)}?v=${getGroupRepresentativeFace(face)}` : null),
                            {
                              width: 40,
                              height: 40,
                              className: 'w-10 h-10 object-cover rounded-full',
                              alt: getGroupLabel(face),
                              iconType: 'person'
                            }
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {getGroupLabel(face) || '\u00A0'}
                            </p>
                          </div>
                          {!face.isPlaceholder && (
                            <a
                              href={`/${eventUrl}/people/${encodeURIComponent(getGroupLabel(face))}`}
                              onClick={(e) => handlePersonLinkClick(e, face)}
                              className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                              title={t('imageViewer.goToPersonPage')}
                            >
                              <User className="w-4 h-4 text-gray-600" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
