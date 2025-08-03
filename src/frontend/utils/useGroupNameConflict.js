import { useState } from 'react';
import { groupsAPI, handleAPIError } from './apiService';

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
      const result = await groupsAPI.checkName(name.trim(), currentGroup?.groupID);
      
      if (result.conflict) {
        setNameConflict(result.conflicting_group);
      } else {
        setNameConflict(null);
      }
    } catch (error) {
      console.error('Error checking name conflict:', error);
      const errorInfo = handleAPIError(error, 'Failed to check name conflict');
      console.error(errorInfo.message);
      // Don't set conflict state on error, let the user try again
      setNameConflict(null);
    }
  };

  const handleMergeGroups = async () => {
    try {
      // Use the API service for merging groups
      await groupsAPI.merge([currentGroup.groupID], conflictData.conflictingGroup.groupID);
      
      // The API service interceptor will automatically handle the state updates
      // No need for manual refresh or window.location.href
      
      // Close modal and let the parent component handle navigation
      setShowMergeModal(false);
      setConflictData(null);
      
      // Clear any name conflict state to prevent further name updates
      setNameConflict(null);
      
      // No need to call onRefreshGroups since dataManager handles all updates automatically
    } catch (error) {
      console.error('Error merging groups:', error);
      const errorInfo = handleAPIError(error, 'Failed to merge groups');
      alert(errorInfo.message);
    }
  };

  const handleMergeCancel = () => {
    setShowMergeModal(false);
    setConflictData(null);
  };

  const showMergeConflictModal = (newName, conflictingGroup = null) => {
    setConflictData({
      newName,
      currentGroup,
      conflictingGroup: conflictingGroup || nameConflict
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