import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../utils/apiService';
import { useDataStore } from '../utils/dataManager';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

export default function MergeConflictModal({ 
  isOpen, 
  onClose, 
  newName, 
  currentGroup, 
  conflictingGroup, 
  onMerge, 
  onCancel,
  onNavigateToGroup,
  onTransferComplete
}) {
  const [loading, setLoading] = useState(false);
  const dataStore = useDataStore();

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCancel();
      } else if (event.key === 'Enter' && !loading) {
        handleTransfer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, loading]);

  const handleTransfer = async () => {
    setLoading(true);
    try {
      // Check if currentGroup exists before accessing its groupID
      if (!currentGroup || !currentGroup.groupID) {
        console.error('Current group is null or missing groupID');
        return;
      }
      
      // Check if conflictingGroup exists before accessing its groupID
      if (!conflictingGroup || !conflictingGroup.groupID) {
        console.error('Conflicting group is null or missing groupID');
        return;
      }
      
      // Collect all face IDs belonging to current group (robust approach)
      let allFaceIds = [];
      try {
        const cropsResp = await groupsAPI.getCrops(currentGroup.groupID);
        const cropMapping = cropsResp?.crop_mapping || {};
        allFaceIds = Object.values(cropMapping).filter(Boolean);
      } catch (e) {
        // ignore and try fallback
      }
      if (!allFaceIds || allFaceIds.length === 0) {
        try {
          const photosResp = await groupsAPI.getPhotosComplete(currentGroup.groupID);
          const photos = photosResp?.photos || [];
          const ids = new Set();
          photos.forEach((p) => {
            (p.faces || []).forEach((f) => {
              if (f.group_id === currentGroup.groupID && f.face_id) ids.add(f.face_id);
            });
          });
          allFaceIds = Array.from(ids);
        } catch (e) {
          // fall through
        }
      }
      if (!allFaceIds || allFaceIds.length === 0) {
        throw new Error('No faces found to transfer for this group.');
      }
      
      // Use transfer logic instead of merge
      const result = await groupsAPI.transferFaces(
        currentGroup.groupID,
        allFaceIds,
        conflictingGroup.groupID,
        null // No new group name since we're transferring to existing group
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
    if (!faceId) return null;
    return `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`;
  };

  const PLACEHOLDER_DATA_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  if (!isOpen || !conflictingGroup) return null;

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          className="modal-content max-w-md"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="text-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Transfer to "{newName}"?
              </h2>
              <p className="text-sm text-gray-600">
                All images from the current group will be transferred to the existing group.
              </p>
            </div>

            <div className="flex items-center justify-center space-x-4 mb-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 mx-auto mb-2">
                  <img
                    src={getRepresentativeImageSrc(currentGroup?.face_representive) || PLACEHOLDER_DATA_URL}
                    alt="Current group"
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
                    src={getRepresentativeImageSrc(conflictingGroup?.face_representive) || PLACEHOLDER_DATA_URL}
                    alt="Target group"
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