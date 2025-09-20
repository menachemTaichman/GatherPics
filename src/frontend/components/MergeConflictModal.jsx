import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import { useDataStore } from '../utils/dataManager';
import { useModalFocus } from '../utils/useModalFocus';




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
  onTransferComplete
}) {
  const { urlHelpers } = useEventUrls(eventUrl);
  const [loading, setLoading] = useState(false);
  const dataStore = useDataStore.getState;
  
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
    customKeyHandler: handleMergeModalKeys
  });



  const handleTransfer = async () => {
    setLoading(true);
    try {
      // Check if currentGroup exists before accessing its groupID
      if (!currentGroup || !currentGroup.groupID) {
        console.error('Current person is null or missing groupID');
        return;
      }
      
      // Check if conflictingGroup exists before accessing its groupID
      if (!conflictingGroup || !conflictingGroup.groupID) {
        console.error('Conflicting person is null or missing groupID');
        return;
      }
      
      // Collect all face IDs belonging to current person (robust approach)
      let allFaceIds = [];
      try {
        const facesResp = await groupsAPI.getFaces(currentGroup.groupID, eventUrl);
        const faces = facesResp?.faces || [];
        allFaceIds = faces.map(face => face.faceID).filter(Boolean);
      } catch (e) {
        // ignore and try fallback
      }
      if (!allFaceIds || allFaceIds.length === 0) {
        try {
          // Get images from the normalized store
          const state = dataStore();
          const imageIds = state.relations?.groupImages?.[currentGroup.id] || [];
          const imagesById = state.entities?.imagesById || {};
          
          const ids = new Set();
          imageIds.forEach(imageId => {
            const image = imagesById[imageId];
            if (image && image.representative_face) {
              // The representative_face is the faceID for the current group
              ids.add(image.representative_face);
            }
          });
          allFaceIds = Array.from(ids);
        } catch (e) {
          console.error('Error getting faces from store:', e);
        }
      }
      if (!allFaceIds || allFaceIds.length === 0) {
        // If no faces found, pass empty array instead of throwing error
        allFaceIds = [];
      }
      
      // Use transfer logic instead of merge
      
      const result = await groupsAPI.transferFaces(
        currentGroup.id || currentGroup.groupID,
        conflictingGroup.id || conflictingGroup.groupID,
        allFaceIds,
        eventUrl
      );
      
      // The API service interceptor will automatically handle state updates
      // No need for manual refresh or window.location.href
      
      // Call the parent's merge callback if provided
      if (onMerge) {
        await onMerge();
      }
      
      // Prefer centralized completion handler for consistent UI updates
      if (onTransferComplete) {
        await onTransferComplete(result);
      } else if (onNavigateToGroup) {
        onNavigateToGroup(conflictingGroup.groupID);
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

  const getRepresentativeImageSrc = (faceId) => {
    if (!faceId || !urlHelpers) return null;
    return urlHelpers.getFaceCropUrl(faceId);
  };

  const PLACEHOLDER_DATA_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  // Early return if modal is not open or required props are missing
  if (!isOpen || !conflictingGroup || !currentGroup) return null;

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
        >
          <div className="p-6">
            <div className="text-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Transfer to "{newName}"?
              </h2>
              <p className="text-sm text-gray-600">
                All images from the current person will be transferred to the existing person.
              </p>
            </div>

            <div className="flex items-center justify-center space-x-4 mb-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 mx-auto mb-2">
                  <img
                    src={getRepresentativeImageSrc(currentGroup?.representative_face) || PLACEHOLDER_DATA_URL}
                    alt="Current person"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500">Current</p>
              </div>

              <ArrowRight className="w-5 h-5 text-gray-400" />

              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 mx-auto mb-2">
                  <img
                    src={getRepresentativeImageSrc(conflictingGroup?.representative_face) || PLACEHOLDER_DATA_URL}
                    alt="Target person"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500">Target</p>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleCancel}
                className="btn-secondary flex-1"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                className="btn-primary flex-1 flex items-center justify-center space-x-2"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Users className="w-4 h-4" />
                )}
                <span>{loading ? 'Transferring...' : 'Transfer'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 