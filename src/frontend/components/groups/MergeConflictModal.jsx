import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../../utils/apiService';
import { useDataStore } from '../../utils/dataManager';
import { useModalManager } from '../../utils/modalManager';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useImageComponent } from '../../hooks/useImage.jsx';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';




export default function MergeConflictModal({ 
  isOpen, 
  eventUrl,
  onClose, 
  newName, 
  currentGroup, 
  conflictingGroup, 
  onMerge, 
  onCancel,
  onNavigateToGroup,
  onTransferComplete,
  urlHelpers: injectedUrlHelpers,
  showCrops = false // Add showCrops prop to know current mode
}) {
  const eventId = useEventId(eventUrl);
  const urlHelpers = injectedUrlHelpers;
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const [loading, setLoading] = useState(false);
  const dataStore = useDataStore.getState;
  const { registerModal, unregisterModal } = useModalManager();
  const MODAL_ID = 'merge-conflict-modal';
  
  // Resolve conflicting group ID to group object (if accessible)
  const conflictingGroupId = typeof conflictingGroup === 'string' ? conflictingGroup : conflictingGroup?.id;
  const conflictingGroupObject = useDataStore(state => 
    conflictingGroupId ? state.entities?.[eventId]?.groups?.[conflictingGroupId] : null
  );
  
  // Custom keyboard handler for MergeConflictModal
  const handleMergeModalKeys = (e) => {
    if (e.key === 'Enter' && !loading) {
      handleTransfer();
      return true; // Mark as handled
    }
    return false; // Not handled
  };
  
  // Use modal focus hook
  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleMergeModalKeys,
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID
  });
  // Apply scope for all groups
  useApplyScopes(isOpen ? [{ entity: 'all', id: 'groups', eventId }] : []);

  // Register as popup modal
  useEffect(() => {
    if (isOpen) {
      try { registerModal({ id: MODAL_ID, type: 'popup', allowOutsideScroll: true }); } catch {}
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => { 
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);



  const handleTransfer = async () => {
    setLoading(true);
    try {
      // Check if currentGroup exists before accessing its id
      if (!currentGroup || !currentGroup.id) {
        console.error('Current person is null or missing id');
        return;
      }
      
      // Check if we have a valid conflicting group ID
      if (!conflictingGroupId) {
        console.error('Conflicting group ID is missing');
        return;
      }
      
      // Get all faces and images from the current group from store BEFORE transfer
      const store = useDataStore.getState();
      const currentGroupData = store.entities?.[eventId]?.groups?.[currentGroup.id];
      const groupFaces = currentGroupData?.[eventId]?.faces;
      const groupImages = currentGroupData?.[eventId]?.images;
      
      let faceIds = [];
      let imageIds = [];
      
      if (groupFaces instanceof Set) {
        faceIds = Array.from(groupFaces);
      } else if (Array.isArray(groupFaces)) {
        faceIds = groupFaces;
      }
      
      if (groupImages instanceof Set) {
        imageIds = Array.from(groupImages);
      } else if (Array.isArray(groupImages)) {
        imageIds = groupImages;
      }
      
      // Call transfer faces API with face_ids from store
      const result = await groupsAPI.transferFaces(
        conflictingGroupId,
        faceIds, // Pass all faces from current group
        eventUrl,
        null // No new_group_name for merge conflict
      );
      
      // The API service interceptor will automatically handle state updates
      // No need for manual refresh or window.location.href
      
      // Call the appropriate completion handler with IDs for highlighting
      // Pass face IDs if in faces mode, otherwise image IDs
      const idsForHighlighting = showCrops ? faceIds : imageIds;
      
      if (onTransferComplete) {
        await onTransferComplete(result, idsForHighlighting);
      } else if (onNavigateToGroup) {
        onNavigateToGroup(conflictingGroupId, idsForHighlighting);
      } else if (onMerge) {
        await onMerge();
      }
      onClose();
    } catch (error) {
      console.error('Error transferring faces:', error);
      const errorInfo = handleAPIError(error, 'Failed to transfer faces');
      alert(errorInfo.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  const getRepresentativeImageSrc = (group) => {
    if (!group || !group.id || !urlHelpers) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}`;
  };

  const isGroupAccessible = (group) => {
    return group && group.id;
  };

  // Use the centralized placeholder from urlHelpers

  // Early return if modal is not open or required props are missing
  if (!isOpen || !conflictingGroupId || !currentGroup) return null;

  return (
    <AnimatePresence>
      <div className="modal-overlay">
        <motion.div
          ref={modalRef}
          className="modal-content max-w-md"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className="p-6">
            <div className="text-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                {t('mergeConflict.transferTo', { name: newName })}
              </h2>
              <p className="text-sm text-gray-600">
                {t('mergeConflict.transferDescription')}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 mx-auto mb-2">
                  {useImageComponent(getRepresentativeImageSrc(currentGroup), {
                    width: 64,
                    height: 64,
                    className: 'w-full h-full object-cover',
                    alt: t('mergeConflict.currentPerson'),
                    iconType: 'person'
                  })}
                </div>
                <p className="text-xs text-gray-500">{t('mergeConflict.current')}</p>
              </div>

              <ArrowRight className="w-5 h-5 text-gray-400" />

              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 mx-auto mb-2">
                  {useImageComponent(
                    isGroupAccessible(conflictingGroupObject) 
                      ? getRepresentativeImageSrc(conflictingGroupObject)
                      : null,
                    {
                      width: 64,
                      height: 64,
                      className: 'w-full h-full object-cover',
                      alt: t('mergeConflict.targetPerson'),
                      iconType: 'person'
                    }
                  )}
                </div>
                <p className="text-xs text-gray-500">{t('mergeConflict.target')}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="btn-secondary flex-1"
                disabled={loading}
              >
                {t('mergeConflict.cancel')}
              </button>
              <button
                onClick={handleTransfer}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Users className="w-4 h-4" />
                )}
                <span>{loading ? t('mergeConflict.transferring') : t('mergeConflict.transfer')}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 


