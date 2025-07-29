import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

export function useGroupNameConflict(currentGroup, onRefreshGroups) {
  const [nameConflict, setNameConflict] = useState(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [conflictData, setConflictData] = useState(null);

  // Check for name conflicts when editing name
  const checkNameConflict = async (name) => {
    if (!name.trim()) {
      setNameConflict(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/groups/check-name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: name.trim(),
          exclude_group_id: currentGroup?.groupID
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.conflict) {
          setNameConflict(data.conflicting_group);
        } else {
          setNameConflict(null);
        }
      }
    } catch (error) {
      console.error('Error checking name conflict:', error);
    }
  };

  const handleMergeGroups = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/groups/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_group_id: conflictData.conflictingGroup.groupID,
          source_group_ids: [currentGroup.groupID]
        })
      });

      if (response.ok) {
        // Refresh groups data to update counts and grid
        if (onRefreshGroups) {
          await onRefreshGroups();
        }
        
        // Close modal and redirect to the main group
        window.location.href = `/${encodeURIComponent(conflictData.conflictingGroup.label)}`;
      } else {
        throw new Error('Failed to merge groups');
      }
    } catch (error) {
      console.error('Error merging groups:', error);
      alert('Failed to merge groups. Please try again.');
    }
  };

  const handleMergeCancel = () => {
    setShowMergeModal(false);
    setConflictData(null);
  };

  const showMergeConflictModal = (newName, editingName) => {
    setConflictData({
      newName,
      currentGroup,
      conflictingGroup: nameConflict
    });
    setShowMergeModal(true);
  };

  const clearConflict = () => {
    setNameConflict(null);
  };

  return {
    nameConflict,
    showMergeModal,
    conflictData,
    checkNameConflict,
    handleMergeGroups,
    handleMergeCancel,
    showMergeConflictModal,
    clearConflict,
    setShowMergeModal
  };
} 