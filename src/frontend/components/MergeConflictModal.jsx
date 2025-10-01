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
  
  // Resolve conflicting group ID to group object (if accessible)
  const conflictingGroupId = typeof conflictingGroup === 'string' ? conflictingGroup : conflictingGroup?.id;
  const conflictingGroupObject = useDataStore(state => 
    conflictingGroupId ? state.entities?.groups?.[conflictingGroupId] : null
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
    customKeyHandler: handleMergeModalKeys
  });



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
      
      // Call transfer faces API without face_ids for merge conflict case
      const result = await groupsAPI.transferFaces(
        currentGroup.id,
        conflictingGroupId,
        null, // No face_ids for merge conflict - transfer all faces
        eventUrl
      );
      
      // The API service interceptor will automatically handle state updates
      // No need for manual refresh or window.location.href
      
      // Call the appropriate completion handler
      if (onTransferComplete) {
        await onTransferComplete(result);
      } else if (onNavigateToGroup) {
        onNavigateToGroup(conflictingGroupId);
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
    return urlHelpers.getRepresentativeUrl('groups', group.id);
  };

  const isGroupAccessible = (group) => {
    return group && group.id;
  };

  const PLACEHOLDER_DATA_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

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
                    src={getRepresentativeImageSrc(currentGroup) || PLACEHOLDER_DATA_URL}
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
                    src={isGroupAccessible(conflictingGroupObject) 
                      ? (getRepresentativeImageSrc(conflictingGroupObject) || PLACEHOLDER_DATA_URL)
                      : PLACEHOLDER_DATA_URL}
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