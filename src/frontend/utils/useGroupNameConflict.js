import { useState } from 'react';
import { groupsAPI, handleAPIError } from './apiService';
import { useDataStore } from './dataManager';

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
      // The MergeConflictModal is already handling the transfer logic
      // We just need to close the modal and clear the state
      
      // Close modal and let the parent component handle navigation
      setShowMergeModal(false);
      setConflictData(null);
      
      // Clear any name conflict state to prevent further name updates
      setNameConflict(null);
      
      // No need to call onRefreshGroups since dataManager handles all updates automatically
    } catch (error) {
      console.error('Error in handleMergeGroups:', error);
      const errorInfo = handleAPIError(error, 'Failed to handle merge');
      alert(errorInfo.message);
    }
  };

  const handleMergeCancel = () => {
    setShowMergeModal(false);
    setConflictData(null);
  };

  const showMergeConflictModal = (newName, currentGroupOverride = null, conflictingGroup = null) => {
    // Ensure we have a valid conflicting group
    let validConflictingGroup = conflictingGroup || nameConflict;
    
    // If still no valid conflicting group, try to find it by name in the data store
    if (!validConflictingGroup && newName) {
      const groups = useDataStore.getState().groups;
      validConflictingGroup = groups.find(g => g.label === newName);
    }
    
    if (!validConflictingGroup) {
      console.error('No valid conflicting group found');
      return;
    }
    
    setConflictData({
      newName,
      currentGroup: currentGroupOverride || currentGroup,
      conflictingGroup: validConflictingGroup
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
    setShowMergeModal,
    setConflictData
  };
} 