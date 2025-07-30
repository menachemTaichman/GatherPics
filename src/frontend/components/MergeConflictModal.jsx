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
  onCancel 
}) {
  const [loading, setLoading] = useState(false);

  const handleMerge = async () => {
    setLoading(true);
    try {
      // Use the API service for merging groups
      await groupsAPI.merge([currentGroup.groupID], conflictingGroup.groupID);
      
      // The API service interceptor will automatically handle the state updates
      if (onMerge) {
        await onMerge();
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
          className="modal-content max-w-2xl"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Group Name Conflict</h2>
                <p className="text-sm text-gray-600">
                  A group with the name "{newName}" already exists
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="space-y-6">
              {/* Current Group */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Current Group</h3>
                <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                  <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200">
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
                  <div>
                    <p className="font-medium text-gray-900">
                      {currentGroup?.label || `Person ${currentGroup?.groupID}`}
                    </p>
                    <p className="text-sm text-gray-500">
                      {currentGroup?.image_ids?.length || 0} photos
                    </p>
                  </div>
                </div>
              </div>

              {/* Merge Arrow */}
              <div className="flex items-center justify-center">
                <div className="flex items-center space-x-2 text-gray-400">
                  <span className="text-sm">Merge into</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>

              {/* Conflicting Group */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Existing Group</h3>
                <div className="flex items-center space-x-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200">
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
                  <div>
                    <p className="font-medium text-gray-900">
                      {conflictingGroup?.label || `Person ${conflictingGroup?.groupID}`}
                    </p>
                    <p className="text-sm text-gray-500">
                      {conflictingGroup?.image_ids?.length || 0} photos
                    </p>
                    <p className="text-xs text-blue-600 font-medium">
                      Will become the main group
                    </p>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium">
                      This action will merge the groups
                    </p>
                    <p className="text-sm text-yellow-700 mt-1">
                      All photos from the current group will be moved to the existing group, and the current group will be deleted.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
            <button
              onClick={handleCancel}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              className="btn-primary flex items-center space-x-2"
              disabled={loading}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Users className="w-4 h-4" />
              )}
              <span>{loading ? 'Merging...' : 'Merge Groups'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 