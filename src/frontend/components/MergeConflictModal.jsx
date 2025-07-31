import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../utils/apiService';

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
  onNavigateToGroup
}) {
  const [loading, setLoading] = useState(false);

  const handleMerge = async () => {
    setLoading(true);
    try {
      await groupsAPI.merge([currentGroup.groupID], conflictingGroup.groupID);
      if (onMerge) {
        await onMerge();
      }
      if (onNavigateToGroup) {
        onNavigateToGroup(conflictingGroup.groupID);
      }
      onClose();
    } catch (error) {
      console.error('Error merging groups:', error);
      const errorInfo = handleAPIError(error, 'Failed to merge groups');
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

  if (!isOpen) return null;

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
                Merge "{newName}"?
              </h2>
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
                    alt="Conflicting group"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500">Existing</p>
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
                onClick={handleMerge}
                className="btn-primary flex-1 flex items-center justify-center space-x-2"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Users className="w-4 h-4" />
                )}
                <span>{loading ? 'Merging...' : 'Merge'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 