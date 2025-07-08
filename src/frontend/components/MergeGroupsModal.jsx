import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Users, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

export default function MergeGroupsModal({ groups, onClose, onMergeComplete }) {
  const [mergeMode, setMergeMode] = useState('manual'); // 'manual' or 'auto'
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [targetGroup, setTargetGroup] = useState(null);
  const [mergeStrategy, setMergeStrategy] = useState('smallest_id');
  const [loading, setLoading] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  // Load duplicate faces on mount
  useEffect(() => {
    if (mergeMode === 'auto') {
      loadDuplicates();
    }
  }, [mergeMode]);

  const loadDuplicates = async () => {
    try {
      setDuplicatesLoading(true);
      const response = await axios.get(`${API_BASE}/api/groups/duplicates`);
      setDuplicates(response.data.duplicates || []);
    } catch (error) {
      console.error('Error loading duplicates:', error);
      // Show user-friendly error message
      const errorMessage = error.response?.data?.error || error.message || 'Failed to load duplicates';
      alert(`Error loading duplicates: ${errorMessage}`);
    } finally {
      setDuplicatesLoading(false);
    }
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
      alert('Please select a target group and at least one other group to merge.');
      return;
    }

    const groupsToMerge = Array.from(selectedGroups).filter(id => id !== targetGroup);
    if (groupsToMerge.length === 0) {
      alert('Please select at least one group to merge into the target group.');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE}/api/groups/merge`, {
        targetGroupId: targetGroup,
        groupIdsToMerge: groupsToMerge
      });

      if (response.data.success) {
        alert(`Successfully merged ${groupsToMerge.length} groups into group ${targetGroup}`);
        onMergeComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error merging groups:', error);
      alert(`Failed to merge groups: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoMerge = async () => {
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE}/api/groups/auto-merge`, {
        mergeStrategy: mergeStrategy
      });

      if (response.data.success) {
        const message = response.data.mergesPerformed 
          ? `Successfully performed ${response.data.mergesPerformed.length} merges`
          : 'No groups needed merging';
        alert(message);
        onMergeComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error auto-merging groups:', error);
      alert(`Failed to auto-merge groups: ${error.response?.data?.error || error.message}`);
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
            {/* Mode Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Merge Mode
              </label>
              <div className="flex space-x-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="manual"
                    checked={mergeMode === 'manual'}
                    onChange={(e) => setMergeMode(e.target.value)}
                    className="mr-2"
                  />
                  <span>Manual Merge</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="auto"
                    checked={mergeMode === 'auto'}
                    onChange={(e) => setMergeMode(e.target.value)}
                    className="mr-2"
                  />
                  <span>Auto-Merge Duplicates</span>
                </label>
              </div>
            </div>

            {mergeMode === 'manual' ? (
              /* Manual Merge Mode */
              <div>
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Select Groups to Merge</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                    {groups.map((group) => (
                      <div
                        key={group.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedGroups.has(group.id)
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleGroupSelect(group.id)}
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(group.id)}
                            onChange={() => handleGroupSelect(group.id)}
                            className="rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {group.label || `Person ${group.id}`}
                            </p>
                            <p className="text-sm text-gray-500">
                              {group.image_ids?.length || 0} photos
                            </p>
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
            ) : (
              /* Auto Merge Mode */
              <div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Merge Strategy
                  </label>
                  <select
                    value={mergeStrategy}
                    onChange={(e) => setMergeStrategy(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="smallest_id">Keep group with smallest ID</option>
                    <option value="largest_count">Keep group with most faces</option>
                  </select>
                </div>

                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Duplicate Faces Found</h3>
                  {duplicatesLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                      <p className="text-gray-500 mt-2">Loading duplicates...</p>
                    </div>
                  ) : duplicates.length > 0 ? (
                    <div className="max-h-64 overflow-y-auto">
                      {duplicates.map((duplicate, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-3 mb-3">
                          <div className="flex items-center space-x-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-yellow-600" />
                            <span className="font-medium text-gray-900">
                              Face {duplicate.face_id}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">
                            Appears in groups: {duplicate.group_ids.join(', ')}
                          </p>
                          <div className="text-xs text-gray-500">
                            {duplicate.details.map((detail, i) => (
                              <div key={i}>
                                Group {detail.group_id}: {detail.image_id} (crop: {detail.crop_filename})
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                      <p className="text-gray-500">No duplicate faces found</p>
                    </div>
                  )}
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-yellow-900 mb-1">Auto-Merge Warning</h4>
                      <p className="text-sm text-yellow-700">
                        This will automatically merge all groups that contain duplicate faces. 
                        The system will choose which group to keep based on your selected strategy.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                onClick={mergeMode === 'manual' ? handleManualMerge : handleAutoMerge}
                disabled={loading || (mergeMode === 'manual' && (!targetGroup || selectedGroups.size < 2))}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {loading && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                )}
                <span>{mergeMode === 'manual' ? 'Merge Groups' : 'Auto-Merge Duplicates'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 