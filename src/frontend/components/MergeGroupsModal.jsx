import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Users, Info } from 'lucide-react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

export default function MergeGroupsModal({ groups, onClose, onMergeComplete }) {
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [targetGroup, setTargetGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  const handleGroupSelect = (groupId) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId);
      if (targetGroup === groupId) {
        setTargetGroup(null);
      }
    } else {
      newSelected.add(groupId);
      if (!targetGroup) {
        setTargetGroup(groupId);
      }
    }
    setSelectedGroups(newSelected);
  };

  const handleTargetGroupChange = (groupId) => {
    setTargetGroup(groupId);
  };

  const handleManualMerge = async () => {
    if (!targetGroup || selectedGroups.size < 2) {
      showToast('Please select a target group and at least one other group to merge.', 'error');
      return;
    }

    const groupsToMerge = Array.from(selectedGroups).filter(id => id !== targetGroup);
    if (groupsToMerge.length === 0) {
      showToast('Please select at least one group to merge into the target group.', 'error');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE}/api/groups/merge`, {
        target_group_id: targetGroup,
        source_group_ids: groupsToMerge
      });

      if (response.data.success) {
        showToast(`Successfully merged ${groupsToMerge.length} groups into group ${targetGroup}`, 'success');
        onMergeComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error merging groups:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to merge groups';
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const getGroupById = (id) => {
    return groups.find(g => g.id === id);
  };

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          className="modal-content max-w-4xl max-h-[90vh] overflow-y-auto"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Merge Face Groups
                </h2>
                <p className="text-sm text-gray-500">
                  Combine multiple groups into one
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
            {/* Manual Merge Mode */}
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-medium text-gray-900 mb-3">Select Groups to Merge</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                  {groups.map((group) => (
                    <div
                      key={group.groupID}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedGroups.has(group.groupID)
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                                              onClick={() => handleGroupSelect(group.groupID)}
                    >
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                                                  checked={selectedGroups.has(group.groupID)}
                        onChange={() => handleGroupSelect(group.groupID)}
                          className="rounded"
                        />
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          {/* Representative Photo */}
                          <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                                            <img
                  src={group.face_representive
                    ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${group.face_representive}.webp`
                    : PLACEHOLDER_DATA_URL}
                                                              alt={group.label || `Person ${group.groupID}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {group.label || `Person ${group.groupID}`}
                            </p>
                            <p className="text-sm text-gray-500">
                              {group.image_ids?.length || 0} photos
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedGroups.size > 0 && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Target Group (kept after merge)
                  </label>
                  <select
                    value={targetGroup || ''}
                    onChange={(e) => handleTargetGroupChange(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select target group...</option>
                    {Array.from(selectedGroups).map((groupId) => {
                      const group = getGroupById(groupId);
                      return (
                        <option key={groupId} value={groupId}>
                          {group?.label || `Person ${groupId}`} ({group?.image_ids?.length || 0} photos)
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-1">How Manual Merge Works</h4>
                    <p className="text-sm text-blue-700">
                      Select multiple groups and choose one as the target. All faces from the other groups 
                      will be moved to the target group, and the other groups will be deleted.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleManualMerge}
                disabled={loading || (!targetGroup || selectedGroups.size < 2)}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {loading && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                )}
                <span>Merge Groups</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast.show && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium ${
              toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
} 