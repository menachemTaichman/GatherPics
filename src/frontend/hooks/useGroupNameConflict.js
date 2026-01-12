import { useState } from 'react';
import { groupsAPI, handleAPIError } from '../utils/apiService';
import { useDataStore } from '../utils/dataManager';

export function useGroupNameConflict(currentGroup, onRefreshGroups, eventUrl, eventId) {
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
      const result = await groupsAPI.checkName(name.trim(), currentGroup?.id, eventUrl);
      
      if (result.conflict) {
        // result.conflicting_group is just an ID, we need to get the full group object
        const store = useDataStore.getState();
        const conflictingGroup = store.entities?.[eventId]?.groups?.[result.conflicting_group];
        setNameConflict(conflictingGroup);
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
    // Pass the conflicting group ID directly - let MergeConflictModal handle accessibility
    const conflictingGroupId = conflictingGroup || nameConflict;
    
    if (!conflictingGroupId) {
      console.error('No conflicting group ID found');
      return;
    }
    
    setConflictData({
      newName,
      currentGroup: currentGroupOverride || currentGroup,
      conflictingGroup: conflictingGroupId // Pass ID directly
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


